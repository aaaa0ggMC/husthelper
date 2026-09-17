// 隐私模型（参考 mcps/ledger-mcp-termux 的做法）。
//
// husthelper 的数据敏感度在于「你是谁、花了什么钱、成绩如何、在哪上网」——
// 一卡通流水足以还原一个人的生活轨迹，profile 直接就是身份证级别的 PII。
// 而 MCP 的返回值会进模型上下文、会话日志，通常还会上云，所以默认视角不该是原文。
//
// 三个披露等级：
//   count    —— 只给数量与合计（"这个月花了多少 / 有几门课" 够用）
//   redacted —— 逐条返回，但姓名/学号/卡号/手机号/邮箱/商户名/IP 打码，原始对象与链接直接丢弃（默认）
//   raw      —— 完整原文，需要一把模型自己拿不到的钥匙
//
// 两道门是分开的：
//   * **访问门禁**：HTTP 会话必须带 `X-Hust-Key`（或 `Authorization: Bearer`），
//     没有/不对就直接拒绝整个会话；stdio 是本机进程，不做门禁。
//   * **披露上限**：由客户端配置写死（stdio 走 HUST_MAX_LEVEL，HTTP 走 `X-Hust-Level`），
//     默认 redacted。模型只能往下降级，不能往上提。
//
// 「钥匙模型自己拿不到」是这套设计的关键：raw 只认
//   * 进程环境变量 HUST_PRIVACY_KEY（与 data/privacy.key 匹配），或
//   * HTTP 请求头 `X-Hust-Key`，
// 它**不接受**任何工具参数 —— 参数会进模型上下文和调用日志，等于把钥匙一起交出去。

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LEVELS = ["count", "redacted", "raw"] as const;
export type Level = (typeof LEVELS)[number];

/** 等级从低到高：用来判断「请求的等级有没有超过本会话的上限」 */
export const LEVEL_RANK: Record<Level, number> = { count: 0, redacted: 1, raw: 2 };

export const DEFAULT_BUDGETS: Record<"raw" | "redacted", number> = {
  raw: 300,
  redacted: 2000,
};

export class PrivacyError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PrivacyError";
    this.code = code;
    this.details = details;
  }
}

function fail(code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new PrivacyError(code, message, details);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/* ------------------------------ 打码（确定性） ------------------------------ */

const DIGIT_RUN = /\d{3,}/g;

/** 确定性打码：同样的输入永远得到同样的输出，所以聚合、去重、排名依然成立 */
export function maskText(value: unknown, { keepHead = 2, keepTail = 1 } = {}): unknown {
  if (value === null || value === undefined) return value;
  const chars = [...String(value)];
  if (!chars.length) return value;
  if (chars.length <= 2) return "*".repeat(chars.length);
  if (chars.length <= 4) return `${chars[0]}${"*".repeat(chars.length - 1)}`;
  return `${chars.slice(0, keepHead).join("")}***${chars.slice(-keepTail).join("")}`;
}

/** 账号/卡号：长数字段只留末四位 */
export function maskAccount(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value);
  const masked = text.replace(
    DIGIT_RUN,
    (run) => `${"*".repeat(Math.max(1, run.length - 4))}${run.slice(-4)}`,
  );
  return masked !== text ? masked : maskText(text);
}

/** 学号/工号：保留首位与末三位，够用来区分同一个人，不够用来定位 */
export function maskId(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const chars = [...String(value)];
  if (chars.length <= 4) return maskText(value);
  return `${chars[0]}***${chars.slice(-3).join("")}`;
}

export function maskPhone(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value).trim();
  if (!text) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return maskText(text);
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function maskEmail(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value).trim();
  if (!text) return text;
  const at = text.lastIndexOf("@");
  if (at <= 0) return maskText(text);
  const local = text.slice(0, at);
  const domain = text.slice(at);
  return `${[...local][0] ?? "*"}***${domain}`;
}

/** IPv4 只留前两段；IPv6 只留第一组 */
export function maskIp(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value).trim();
  if (!text) return text;
  if (text.includes(":")) {
    const head = text.split(":")[0];
    return `${head}:****`;
  }
  const parts = text.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return maskText(text);
}

/* ------------------------------- 密钥与读取 ------------------------------- */

function readSecret(path: string): string | null {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeSecret(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* 某些文件系统不支持，忽略 */
  }
}

export function keyPath(dir: string): string {
  return join(dir, "privacy.key");
}

export function generateKey(): string {
  return randomBytes(32).toString("hex");
}

export function readStoredKey(dir: string): string | null {
  return readSecret(keyPath(dir));
}

export function storeKey(dir: string, key: string): string {
  writeSecret(keyPath(dir), key);
  return key;
}

/** 没有密钥就生成一把，保证本机始终有一条可用的原文钥匙 */
export function ensureKey(dir: string): { key: string; created: boolean } {
  const existing = readStoredKey(dir);
  if (existing) return { key: existing, created: false };
  const key = generateKey();
  storeKey(dir, key);
  return { key, created: true };
}

function sameSecret(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseBool(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function parseBudget(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["off", "none", "unlimited", "-1"].includes(text)) return Infinity;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/* --------------------------------- Privacy -------------------------------- */

export interface PrivacyOptions {
  dir: string;
  env?: NodeJS.ProcessEnv;
  /** 会话携带的密钥：stdio 来自 HUST_PRIVACY_KEY，HTTP 来自 X-Hust-Key */
  suppliedKey?: string | null;
  /** 本会话的等级上限：stdio 来自 HUST_MAX_LEVEL，HTTP 来自 X-Hust-Level */
  maxLevel?: string | null;
  /** 本会话未显式请求等级时的默认等级 */
  defaultLevel?: string | null;
  /** 传输方式，决定 maxLevel 的默认值 */
  transport?: "stdio" | "http";
  sessionId?: string;
}

/**
 * 一次会话的隐私上下文。MCP 进程 = 一个会话（HTTP 每个会话单独一个 server 实例），
 * 所以预算天然按会话隔离。
 */
export class Privacy {
  readonly dir: string;
  readonly sessionId: string;
  readonly transport: "stdio" | "http";
  readonly maxLevel: Level;
  readonly defaultLevel: Level;
  readonly storedKey: string | null;
  readonly suppliedKey: string | null;
  readonly allowRawEnv: boolean;
  readonly rawAllowed: boolean;
  readonly keyMismatch: boolean;
  readonly requireAccess: boolean;
  readonly budgets: Record<"raw" | "redacted", number>;
  readonly used: Record<Level, number> = { raw: 0, redacted: 0, count: 0 };
  readonly allowSensitiveEnv: boolean | null;

  constructor(options: PrivacyOptions) {
    const env = options.env ?? process.env;
    this.dir = options.dir;
    this.transport = options.transport ?? "stdio";
    this.sessionId = options.sessionId ?? env.HUST_SESSION ?? `pid-${process.pid}`;
    this.requireAccess = this.transport === "http";

    const fallbackMax = this.transport === "http" ? "redacted" : "raw";
    const rawMax = options.maxLevel ?? env.HUST_MAX_LEVEL ?? fallbackMax;
    this.maxLevel = isLevel(rawMax) ? rawMax : "redacted";

    this.storedKey = readStoredKey(this.dir);
    this.suppliedKey = options.suppliedKey ?? env.HUST_PRIVACY_KEY ?? null;
    this.allowRawEnv = parseBool(env.HUST_ALLOW_RAW);
    this.keyMismatch = Boolean(
      this.storedKey && this.suppliedKey && !sameSecret(this.storedKey, this.suppliedKey),
    );
    this.rawAllowed =
      (Boolean(this.storedKey) && sameSecret(this.storedKey, this.suppliedKey)) || this.allowRawEnv;

    // 默认等级：显式配置优先，否则 redacted；必须收在上限之内，且不能超过实际权限
    // （例如 stdio 上限虽是 raw，但没给密钥时默认只能是 redacted，否则每次都会报错）。
    const rawDefault = options.defaultLevel ?? env.HUST_DEFAULT_LEVEL ?? "redacted";
    let chosen: Level = isLevel(rawDefault) ? rawDefault : "redacted";
    if (LEVEL_RANK[chosen] > LEVEL_RANK[this.maxLevel]) chosen = this.maxLevel;
    while (!this.levelAllowed(chosen) && LEVEL_RANK[chosen] > 0) {
      chosen = LEVELS[LEVEL_RANK[chosen] - 1];
    }
    this.defaultLevel = chosen;

    this.budgets = {
      raw: parseBudget(env.HUST_REVEAL_BUDGET, DEFAULT_BUDGETS.raw),
      redacted: parseBudget(env.HUST_REDACTED_BUDGET, DEFAULT_BUDGETS.redacted),
    };

    this.allowSensitiveEnv =
      env.HUST_SHOW_SENSITIVE !== undefined ? parseBool(env.HUST_SHOW_SENSITIVE) : null;
  }

  /** HTTP 门禁：没有密钥直接拒绝整个会话 */
  assertAccess(): void {
    if (this.requireAccess && !this.suppliedKey) {
      fail("ACCESS_DENIED", "缺少 X-Hust-Key，拒绝建立会话（本服务不提供匿名访问）");
    }
  }

  /** 启动自检：密钥对不上就早点喊，别让调用方以为看到的是原文 */
  assertKeyConsistent(): void {
    if (this.keyMismatch) {
      fail(
        "PRIVACY_KEY_MISMATCH",
        "提供的隐私密钥与 data/privacy.key 不一致，已拒绝会话（避免以为有原文权限其实没有）",
      );
    }
  }

  levelAllowed(level: Level): boolean {
    if (level === "raw") return this.rawAllowed;
    return true;
  }

  /** 定下请求的等级；不够权限就报错，而不是悄悄降级（静默降级会误导调用方） */
  resolveLevel(requested?: unknown): Level {
    const level = requested ? String(requested) : this.defaultLevel;
    if (!isLevel(level)) {
      fail("INVALID_LEVEL", `隐私等级只能是 ${LEVELS.join(" / ")}，收到 ${String(requested)}`);
    }
    if (LEVEL_RANK[level] > LEVEL_RANK[this.maxLevel]) {
      fail(
        "LEVEL_NOT_ALLOWED",
        `本会话的等级上限是 ${this.maxLevel}，拿不到 ${level}。` +
          "想让这条连接能看原文，需要由本人在客户端配置里把等级上限设为 raw" +
          "（HTTP 场景是请求头 X-Hust-Level: raw），模型自己改不了。",
        { requested: level, max_level: this.maxLevel },
      );
    }
    if (!this.levelAllowed(level)) {
      fail(
        "RAW_NOT_ALLOWED",
        "当前会话没有原文（raw）权限：模型无法自己获得它。请在启动服务时提供 " +
          "HUST_PRIVACY_KEY（HTTP 场景用请求头 X-Hust-Key），或继续使用 redacted 等级。",
        { requested: level },
      );
    }
    return level;
  }

  /** 逐条披露才走预算；count / 聚合不消耗（它们本来就不吐出条目） */
  consume(level: Level, rows: number): void {
    if (level === "count" || rows <= 0) return;
    const budget = this.budgets[level];
    if (budget === undefined || budget === Infinity) return;
    const next = this.used[level] + rows;
    if (next > budget) {
      fail(
        "REVEAL_BUDGET_EXCEEDED",
        `本次会话的 ${level} 披露预算只剩 ${Math.max(0, budget - this.used[level])} 条，` +
          `本次请求要 ${rows} 条。请改用 count 等级或先做聚合分析。`,
        { level, budget, used: this.used[level], requested: rows },
      );
    }
    this.used[level] = next;
  }

  /** 敏感条目（医疗等）默认只在 raw 下可见，且需要显式 includeSensitive */
  allowSensitive(level: Level, includeSensitive: boolean): boolean {
    if (!includeSensitive) return false;
    if (this.allowSensitiveEnv !== null) {
      if (!this.allowSensitiveEnv) {
        fail("SENSITIVE_NOT_ALLOWED", "当前会话被 HUST_SHOW_SENSITIVE 明确禁止访问敏感条目");
      }
      return true;
    }
    if (level !== "raw") {
      fail(
        "SENSITIVE_REQUIRES_RAW",
        "敏感条目默认只在 raw 等级下可见；如需在 redacted 下查看，请由本人设置 HUST_SHOW_SENSITIVE=1",
      );
    }
    this.resolveLevel("raw");
    return true;
  }

  policy(): Record<string, unknown> {
    const budget = (level: "raw" | "redacted") => {
      const limit = this.budgets[level];
      return {
        limit: limit === Infinity ? "off" : limit,
        used: this.used[level],
        remaining: limit === Infinity ? "off" : Math.max(0, limit - this.used[level]),
      };
    };
    return {
      session: this.sessionId,
      transport: this.transport,
      default_level: this.defaultLevel,
      max_level: this.maxLevel,
      raw_allowed: this.rawAllowed,
      raw_gate: this.allowRawEnv
        ? "environment HUST_ALLOW_RAW=1"
        : this.storedKey
          ? "data/privacy.key（stdio 用 HUST_PRIVACY_KEY，HTTP 用 X-Hust-Key）"
          : "未配置密钥",
      levels: {
        count: "只返回数量与合计，不返回任何条目",
        redacted:
          "逐条返回，但姓名/学号/卡号/手机号/邮箱/商户名/IP 打码；原始对象与 SSO/VIEW 链接不返回",
        raw: "完整原文，需要密钥",
      },
      budgets: { raw: budget("raw"), redacted: budget("redacted") },
      sensitive_rule: "命中医疗等关键词的流水默认只在 raw + includeSensitive 时可见",
      level_rule: `本会话的等级上限是 ${this.maxLevel}，只能往下降，不能往上提`,
      audit_rule: "每次读取都会写审计（动作、等级、条数、参数摘要，不记录内容）",
    };
  }
}
