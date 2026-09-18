// 一卡通流水 -> 本地 ledger 账本的增量同步。
//
// 设计要点：**模型能触发同步，但看不到任何一条明细**。
// 整个流程都在 MCP 进程内完成——读 ecard、写 ledger——模型只拿到最后的汇总数字
// （同步了多少条、支出/收入合计多少）。凭据、商户名、卡号、备注都不会进模型上下文。
//
// ledger 是否可用在 MCP 启动时探测：命令默认为 `ledger`（PATH 上），可用
// HUST_LEDGER_CMD 覆盖（例如 "node /path/to/ledger-mcp-termux/bin/ledger.js"）。
// 检测不到就不注册这个工具。

import { spawnSync } from "node:child_process";
import {
  formatErrorResponse,
  formatToolResponse,
  getClient,
  getEnv,
  type ToolResponse,
} from "./context.ts";
import { appendAudit } from "./audit.ts";
import type { Privacy } from "./privacy.ts";
import type { Transaction } from "../src/ecard.ts";

/** ledger 中没有 ecard 记录时的默认回溯天数（可用 HUST_LEDGER_SYNC_SINCE 覆盖起始日期） */
const DEFAULT_LOOKBACK_DAYS = 365;
const LEDGER_TIMEOUT_MS = 300_000;
const LEDGER_MAX_BUFFER = 64 * 1024 * 1024;
/** 单次同步最多拉取的流水条数，防呆（超出请用 since 缩小范围） */
const MAX_RECORDS = 20_000;

/** 明显属于医疗/私人事务的商户：同步进账本时标为敏感，MCP 侧后续默认不可见 */
const SENSITIVE_HINTS = [
  "医院",
  "药店",
  "药房",
  "诊所",
  "医疗",
  "体检",
  "挂号",
  "卫生服务",
  "保险",
  "精神",
  "心理",
  "疾控",
  "血液",
  "妇幼",
  "口腔",
  "眼科",
];

/* ------------------------------ ledger 命令 ------------------------------ */

export interface LedgerCommand {
  bin: string;
  /** 命令前缀参数（HUST_LEDGER_CMD 里 bin 之后的部分） */
  prefix: string[];
  /** 原始配置串，用于日志与缓存 key */
  display: string;
}

/** 极简 shell 风格分词：支持双引号/单引号包裹的路径，其余按空白分割 */
export function splitCommand(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || current) {
        out.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error(`HUST_LEDGER_CMD 的引号没有闭合: ${text}`);
  if (has || current) out.push(current);
  return out;
}

export function resolveLedgerCommand(env: NodeJS.ProcessEnv = getEnv()): LedgerCommand {
  const display = (env.HUST_LEDGER_CMD ?? "ledger").trim() || "ledger";
  const parts = splitCommand(display);
  const [bin, ...prefix] = parts;
  if (!bin) throw new Error("HUST_LEDGER_CMD 为空");
  return { bin, prefix, display };
}

export interface LedgerDetection {
  available: boolean;
  command: string;
  reason?: string;
}

let detectionCache: LedgerDetection | null = null;

/** 探测 ledger 是否存在（默认命令 `ledger`）。结果按命令缓存，避免每个 HTTP 会话都 spawn。 */
export function detectLedger(env: NodeJS.ProcessEnv = getEnv()): LedgerDetection {
  let command: LedgerCommand;
  try {
    command = resolveLedgerCommand(env);
  } catch (error) {
    return {
      available: false,
      command: String(env.HUST_LEDGER_CMD ?? "ledger"),
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (detectionCache && detectionCache.command === command.display) return detectionCache;

  let available = false;
  let reason: string | undefined;
  try {
    const result = spawnSync(command.bin, [...command.prefix, "--help"], {
      timeout: 10_000,
      encoding: "utf8",
      env,
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reason = `PATH 上找不到命令「${command.bin}」`;
      } else if (code === "ETIMEDOUT") {
        // 命令存在但不响应 --help（例如被配置成了常驻服务）：仍视为可用
        available = true;
      } else {
        reason = `执行「${command.display}」失败：${result.error.message}`;
      }
    } else {
      available = true;
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }

  detectionCache = { available, command: command.display, reason };
  return detectionCache;
}

interface LedgerRun {
  ok: boolean;
  data?: unknown;
  stderr: string;
  error?: string;
}

function runLedger(
  env: NodeJS.ProcessEnv,
  argv: string[],
  input?: string,
): LedgerRun {
  const command = resolveLedgerCommand(env);
  const result = spawnSync(command.bin, [...command.prefix, ...argv], {
    input,
    encoding: "utf8",
    timeout: LEDGER_TIMEOUT_MS,
    maxBuffer: LEDGER_MAX_BUFFER,
    env,
  });
  const stderr = result.stderr ?? "";

  if (result.error) {
    return { ok: false, stderr, error: (result.error as NodeJS.ErrnoException).message };
  }
  if (result.status !== 0) {
    const detail = stderr.trim().split("\n").slice(-3).join(" / ");
    return { ok: false, stderr, error: `ledger 退出码 ${result.status}${detail ? `：${detail}` : ""}` };
  }

  const stdout = (result.stdout ?? "").trim();
  if (!stdout) return { ok: true, stderr };
  try {
    return { ok: true, data: JSON.parse(stdout), stderr };
  } catch {
    return { ok: false, stderr, error: "ledger 未返回可解析的 JSON" };
  }
}

/** 读取账本里最新一条 ecard 流水的时间（YYYY-MM-DD HH:MM:SS）；没有则 undefined */
export function readLatestEcardTime(env: NodeJS.ProcessEnv = getEnv()): string | undefined {
  const result = runLedger(env, [
    "list",
    "--source",
    "ecard",
    "--order",
    "desc",
    "--limit",
    "1",
    "--include-sensitive",
    "--json",
  ]);
  if (!result.ok || !result.data || typeof result.data !== "object") return undefined;
  const entries = (result.data as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  const occurred = (entries[0] as { occurred_at?: unknown }).occurred_at;
  return typeof occurred === "string" && occurred.trim() ? occurred.trim() : undefined;
}

/* --------------------------- ecard -> ledger 映射 --------------------------- */

const COMPACT = /^\d{14}$/;

/** `YYYYMMDDHHmmss` -> `YYYY-MM-DD HH:MM:SS` */
export function occTimeToIso(occtime: unknown): string | undefined {
  const text = String(occtime ?? "").trim();
  if (!COMPACT.test(text)) return undefined;
  return (
    `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ` +
    `${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`
  );
}

export interface LedgerEntryInput {
  occurredAt: string;
  amount: string;
  direction: "income" | "expense";
  currency: "CNY";
  counterparty?: string;
  item?: string;
  method: string;
  source: "ecard";
  sensitive: boolean;
}

function textField(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

/** 把一条一卡通流水映射成 ledger 条目；金额为 0 或时间非法时返回 null */
export function ecardToLedgerEntry(tx: Transaction): LedgerEntryInput | null {
  const occurredAt = occTimeToIso(tx?.occtime);
  if (!occurredAt) return null;

  const signedCents = Number(tx?.sign_tranamt);
  if (!Number.isFinite(signedCents) || signedCents === 0) return null;

  const counterparty = textField(tx?.mercname);
  const item = textField(tx?.tranname);
  const haystack = [counterparty, item, tx?.remark].filter(Boolean).join(" ");

  return {
    occurredAt,
    amount: (Math.abs(signedCents) / 100).toFixed(2),
    direction: signedCents < 0 ? "expense" : "income",
    currency: "CNY",
    counterparty,
    item,
    method: "校园卡",
    source: "ecard",
    sensitive: SENSITIVE_HINTS.some((hint) => haystack.includes(hint)),
  };
}

/* ------------------------------- 时间窗口 ------------------------------- */

/** 解析用户/账本给出的时间，返回本地时间 Date；非法则抛错 */
export function parseSince(value: string): Date {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) throw new Error(`时间格式应为 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS'，收到「${value}」`);
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  if (Number.isNaN(date.getTime())) throw new Error(`无法解析时间「${value}」`);
  return date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地 Date -> `YYYYMMDDHHmmss`，用于和 ecard 的 occtime 做字典序比较 */
export function toCompact(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function toDisplay(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 从 from 所在月枚举到 to 所在月，元素形如 `YYYY-MM-01`（ecard 的 dateStatus） */
export function enumerateMonths(from: Date, to: Date): string[] {
  const out: string[] = [];
  let year = from.getFullYear();
  let month = from.getMonth();
  const endYear = to.getFullYear();
  const endMonth = to.getMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${pad(month + 1)}-01`);
    if (++month > 11) {
      month = 0;
      year += 1;
    }
    if (out.length > 600) break; // 50 年上限，纯防呆
  }
  return out;
}

export function defaultSinceDate(env: NodeJS.ProcessEnv = getEnv()): Date {
  const configured = env.HUST_LEDGER_SYNC_SINCE;
  if (configured && configured.trim()) return parseSince(configured);
  const date = new Date();
  date.setDate(date.getDate() - DEFAULT_LOOKBACK_DAYS);
  return date;
}

/* --------------------------------- 同步 --------------------------------- */

export interface SyncOptions {
  dryRun?: boolean;
  since?: string;
}

interface SyncSummary {
  ok: true;
  backend: string;
  dry_run: boolean;
  window: { since: string; until: string; months: number };
  scanned: number;
  synced: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  amount: { currency: "CNY"; expense: string; income: string; net: string };
  ledger_revision: number | null;
  message: string;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 只回命令的「名字」，不要把完整路径（含本机用户名）带进模型上下文 */
function backendLabel(command: LedgerCommand): string {
  const tokens = [command.bin, ...command.prefix];
  const script = tokens.find((token) => /\.(?:m?js|cjs)$/i.test(token));
  const target = script ?? command.bin;
  return target.split(/[\\/]/).filter(Boolean).pop() || "ledger";
}

/** 按时间倒序逐页抓某个月的流水；因为服务端按时间倒序，遇到早于 since 的即可停 */
async function collectMonth(
  client: ReturnType<typeof getClient>,
  month: string,
  sinceCompact: string,
): Promise<Transaction[]> {
  const out: Transaction[] = [];
  let page: number | null = 1;
  while (page !== null) {
    const result = await client.ecard.getTransactions({ page, dateStatus: month });
    if (!result.records.length) break;

    let reachedOlder = false;
    for (const tx of result.records) {
      const occtime = String(tx?.occtime ?? "");
      if (!COMPACT.test(occtime)) continue;
      if (occtime < sinceCompact) {
        reachedOlder = true;
        break;
      }
      out.push(tx);
    }
    if (reachedOlder) break;
    page = result.nextPage;
  }
  return out;
}

async function runSync(env: NodeJS.ProcessEnv, options: SyncOptions): Promise<SyncSummary> {
  const client = getClient(env);

  const latest = readLatestEcardTime(env);
  const sinceDate = options.since ? parseSince(options.since) : latest ? parseSince(latest) : defaultSinceDate(env);
  const untilDate = new Date();
  const sinceCompact = toCompact(sinceDate);

  const records: Transaction[] = [];
  const months = enumerateMonths(sinceDate, untilDate);
  for (const month of months) {
    const got = await collectMonth(client, month, sinceCompact);
    records.push(...got);
    if (records.length > MAX_RECORDS) {
      throw new Error(
        `本次要同步的流水超过 ${MAX_RECORDS} 条，请用 since 参数缩小范围（如 since: "${toDisplay(sinceDate).slice(0, 10)}"）后分批同步`,
      );
    }
  }

  const entries: LedgerEntryInput[] = [];
  let expenseCents = 0;
  let incomeCents = 0;
  for (const tx of records) {
    const entry = ecardToLedgerEntry(tx);
    if (!entry) continue;
    entries.push(entry);
    const cents = Math.round(Number(entry.amount) * 100);
    if (entry.direction === "expense") expenseCents += cents;
    else incomeCents += cents;
  }

  const base: Omit<SyncSummary, "synced" | "inserted" | "updated" | "unchanged" | "skipped" | "ledger_revision" | "message"> = {
    ok: true,
    backend: backendLabel(resolveLedgerCommand(env)),
    dry_run: Boolean(options.dryRun),
    window: { since: toDisplay(sinceDate), until: toDisplay(untilDate), months: months.length },
    scanned: records.length,
    amount: {
      currency: "CNY",
      expense: money(expenseCents),
      income: money(incomeCents),
      net: money(expenseCents - incomeCents),
    },
  };

  if (entries.length === 0) {
    return {
      ...base,
      synced: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      ledger_revision: null,
      message: "没有新的流水需要同步",
    };
  }

  const argv = ["add", "--input", "-", "--json"];
  if (options.dryRun) argv.push("--dry-run");
  const result = runLedger(env, argv, JSON.stringify(entries));
  if (!result.ok || !result.data || typeof result.data !== "object") {
    throw new Error(`写入 ledger 失败：${result.error ?? "未知错误"}`);
  }

  const data = result.data as {
    inserted?: number;
    updated?: number;
    unchanged?: number;
    skipped_duplicates?: number;
    revision?: number;
  };
  const inserted = Number(data.inserted ?? 0);
  const updated = Number(data.updated ?? 0);
  const unchanged = Number(data.unchanged ?? 0);
  const skipped = Number(data.skipped_duplicates ?? 0);
  const synced = inserted + updated;

  // 边界那条（与账本最新时间相同）会被重复扫描但不会真正新增；synced=0 时把金额归零，
  // 避免出现「同步 0 条却显示 ¥0.15」这种误导。
  const amount =
    synced > 0
      ? base.amount
      : { currency: "CNY" as const, expense: "0.00", income: "0.00", net: "0.00" };

  return {
    ...base,
    amount,
    synced,
    inserted,
    updated,
    unchanged,
    skipped,
    ledger_revision: Number.isFinite(data.revision) ? Number(data.revision) : null,
    message:
      synced > 0
        ? options.dryRun
          ? `预览：将同步 ${synced} 条（新增 ${inserted} / 更新 ${updated}）`
          : `已同步 ${synced} 条（新增 ${inserted} / 更新 ${updated}）`
        : "没有新的流水需要同步",
  };
}

/**
 * MCP 工具：把一卡通流水增量同步到本地 ledger。
 *
 * 返回值刻意只包含汇总（条数 / 金额 / 时间窗），不含任何明细——模型的上下文里
 * 不会出现商户名、卡号、备注等。真正的条目由 MCP 进程直接写进 ledger。
 */
export async function syncEcardToLedger(
  privacy: Privacy,
  options: SyncOptions = {},
): Promise<ToolResponse> {
  const env = getEnv();
  const detection = detectLedger(env);
  if (!detection.available) {
    return formatErrorResponse(
      new Error(
        `未检测到 ledger（命令「${detection.command}」不可用）：${detection.reason ?? "未知原因"}。` +
          "请安装 ledger-mcp-termux 并把它放到 PATH，或设置 HUST_LEDGER_CMD 指向可执行文件。",
      ),
    );
  }

  try {
    const summary = await runSync(env, options);
    appendAudit(privacy.dir, {
      session: privacy.sessionId,
      tool: "hust_sync_ledger",
      resource: "ledger",
      level: "count",
      count: summary.synced,
      args: {
        dryRun: summary.dry_run,
        backend: summary.backend,
        window: summary.window,
      },
    });
    return formatToolResponse(summary);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
