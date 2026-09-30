import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { findConfigUpwards } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI 兼容的 chat 接口配置（与仓库其它模块的 openai 段一致）。 */
export interface ChatConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  /** 失败自动重试次数（默认 2，即最多尝试 3 次）。 */
  maxRetries?: number;
  /** 首次重试的基础延迟毫秒（默认 800，指数退避 + 抖动）。 */
  retryDelayMs?: number;
  /** 配置来源（文件路径或 "env"），仅用于日志展示。 */
  source?: string;
}

/** AI 配置文件名（按优先级，逐级向上查找第一个含 openai/ai 段的文件）。 */
export const AI_CONFIG_NAMES = ["hustreport.config.json", "config.json"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 可注入的对话函数，便于测试或替换成别的模型服务。 */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export const DEFAULT_MAX_TOKENS = 65536;
export const MIN_MAX_TOKENS = 256;
export const MAX_MAX_TOKENS = 262144;
export const DEFAULT_TIMEOUT_MS = 300000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 800;

/** 把用户给的 max_tokens 夹到合法区间；非法值回退默认。 */
export function clampMaxTokens(value: number | undefined): number {
  const tokens = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_MAX_TOKENS;
  if (tokens <= 0) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, tokens));
}

interface ResolveChatConfigOptions {
  /** 配置文件路径；默认从 cwd 向上查找 `hustreport.config.json` / `config.json`。 */
  configFile?: string;
  /** 工作目录，默认 `process.cwd()`。 */
  cwd?: string;
  /** 环境变量来源，默认 `process.env`（便于测试注入）。 */
  env?: Record<string, string | undefined>;
}

function positiveNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

/**
 * 从环境变量 + `config.json`（`openai` 或 `ai` 段）解析 AI 配置，环境变量优先。
 * 任一入口（CLI / MCP / 脚本）都复用这一份逻辑，避免重复实现。
 */
export function resolveChatConfig(options: ResolveChatConfigOptions = {}): ChatConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  let raw: { openai?: Partial<ChatConfig>; ai?: Partial<ChatConfig> } = {};
  let source: string | undefined;
  if (options.configFile) {
    // 显式指定的配置文件必须存在且可解析，避免“以为生效其实没读到”
    source = path.resolve(cwd, options.configFile);
    if (!existsSync(source)) throw new Error(`配置文件不存在：${source}`);
    try {
      raw = JSON.parse(readFileSync(source, "utf-8"));
    } catch (error) {
      throw new Error(`配置文件解析失败：${source}：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // 从 cwd 向上回溯，找第一个含 openai / ai 段的配置文件
    source = findConfigUpwards(AI_CONFIG_NAMES, cwd, (json) => isObject(json.openai) || isObject(json.ai));
    if (source) {
      try {
        raw = JSON.parse(readFileSync(source, "utf-8"));
      } catch {
        source = undefined;
      }
    }
  }

  const ai = raw.openai ?? raw.ai ?? {};
  const baseURL = env.HUST_AI_BASE_URL ?? ai.baseURL;
  const apiKey = env.HUST_AI_API_KEY ?? ai.apiKey;
  const model = env.HUST_AI_MODEL ?? ai.model;
  const maxTokens = positiveNumber(env.HUST_AI_MAX_TOKENS) ?? positiveNumber(ai.maxTokens);
  const timeout = positiveNumber(env.HUST_AI_TIMEOUT) ?? positiveNumber(ai.timeout);

  if (!baseURL || !apiKey || !model) {
    throw new Error(
      "缺少 AI 配置：请在 hustreport.config.json / config.json（当前目录或任一父目录）的 openai 段、" +
        "--config 指定的文件，或环境变量 HUST_AI_BASE_URL / HUST_AI_API_KEY / HUST_AI_MODEL 中提供" +
        (source ? `（已读取 ${source}，但字段不全）` : ""),
    );
  }

  return {
    baseURL,
    apiKey,
    model,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    source: env.HUST_AI_BASE_URL && env.HUST_AI_API_KEY && env.HUST_AI_MODEL ? "env" : (source ?? "env"),
  };
}

/** 判断错误是否值得重试（限流 / 超时 / 5xx / 网络抖动）。 */
export function isRetriableError(error: unknown): boolean {
  const err = error as { status?: unknown; statusCode?: unknown; name?: unknown; message?: unknown } | null;
  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : undefined;
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  const text = `${err?.name ?? ""} ${err?.message ?? ""}`;
  return /APIConnection|Timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 构造一个调用 OpenAI 兼容 `/chat/completions` 的 `ChatFn`（带重试与截断检测）。 */
export function chatCompletion(config: ChatConfig): ChatFn {
  const maxTokens = clampMaxTokens(config.maxTokens);
  const maxRetries = Math.max(0, Math.floor(config.maxRetries ?? DEFAULT_MAX_RETRIES));
  const retryDelayMs = Math.max(0, config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const client = new OpenAI({
    baseURL: config.baseURL.replace(/\/+$/, ""),
    apiKey: config.apiKey,
    timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
    // 由本函数自行控制重试，关闭 SDK 内建重试，避免叠加放大。
    maxRetries: 0,
  });

  return async (messages) => {
    let completion;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        completion = await client.chat.completions.create({
          model: config.model,
          temperature: config.temperature ?? 0.2,
          max_tokens: maxTokens,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries || !isRetriableError(error)) break;
        const jitter = Math.floor(Math.random() * 200);
        await sleep(retryDelayMs * 2 ** attempt + jitter);
      }
    }

    if (!completion) {
      const error = lastError as { status?: number; statusCode?: number; message?: string } | undefined;
      const status = error?.status ?? error?.statusCode ?? "无响应";
      const message = error?.message ?? String(lastError);
      throw new Error(
        `OpenAI 接口请求失败 (${status}) model=${config.model} url=${config.baseURL}: ${message.slice(0, 800)}` +
          apiErrorHint(status),
      );
    }

    const choice = completion.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (!content) {
      const reasoning = (choice?.message as { reasoning_content?: string } | undefined)?.reasoning_content;
      console.error("AI 响应异常：", JSON.stringify(choice, null, 2));
      throw new Error(
        `AI 返回为空 (finish_reason=${choice?.finish_reason}, reasoning_length=${reasoning?.length ?? 0})`,
      );
    }
    if (choice?.finish_reason === "length") {
      throw new Error(
        `AI 输出被 max_tokens=${maxTokens} 截断（finish_reason=length）。` +
          `请提高 HUST_AI_MAX_TOKENS / config.json 的 maxTokens，或缩小输入（如 --max-anchors）。`,
      );
    }
    return content;
  };
}

/**
 * 从模型输出里提取 JSON：兼容 ```json 围栏、前后解释文字。
 * 找不到合法 JSON 时返回 null（调用方自行决定降级策略）。
 */
export function extractJson<T = unknown>(text: string): T | null {
  const trimmed = text.trim();
  // 先直接当 JSON 解析：内容里（例如 skeleton 字符串）可能包含 ``` 代码围栏，不能被误当成外层围栏。
  const direct = tryParse<T>(trimmed);
  if (direct !== null) return direct;

  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  return tryParse<T>(candidate) ?? tryParse<T>(sliceBalanced(candidate));
}

/** 从模型输出里提取代码：优先取围栏代码块，否则整段当代码。 */
export function extractCode(text: string): string {
  const fenced = /```(?:js|javascript|ts|typescript)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function tryParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** 截取第一个 `{`/`[` 到对应配对的结尾，容忍模型在 JSON 前后加话。 */
function sliceBalanced(text: string): string {
  const start = text.search(/[[{]/);
  if (start < 0) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** 按 HTTP 状态码给出下一步该做什么（是重试还是充值/改配置），并提示可用 --from-response 复用旧结果。 */
export function apiErrorHint(status: number | string): string {
  const reuse = "；已有 ai-response.txt 时可用 --from-response 不调模型直接重新合并";
  switch (Number(status)) {
    case 401:
    case 403:
      return `\n  提示：鉴权失败，请检查 apiKey 是否正确、是否有该模型的权限（配置来源见上方“AI 配置来源”）${reuse}`;
    case 402:
      return `\n  提示：服务方报告余额不足，充值后直接重跑即可（重试无效）${reuse}`;
    case 404:
      return "\n  提示：地址或模型名不存在，请检查 baseURL（通常需以 /v1 结尾）与 model";
    case 429:
      return "\n  提示：触发限流，稍等片刻重试（已自动退避重试仍失败时，可降低并发或换模型）";
    default:
      return "";
  }
}
