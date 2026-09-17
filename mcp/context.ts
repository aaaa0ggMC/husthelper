// 运行时上下文：环境变量解析、HustClient 单例、MCP 响应格式化。
//
// stdio 模式下 stdout 是传输通道，任何日志都必须走 stderr，
// 否则会污染协议流。

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import hust, { type HustClient, type Logger } from "../index.ts";

export const MCP_DIR = fileURLToPath(new URL(".", import.meta.url));

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HUST_DATA_DIR ? env.HUST_DATA_DIR : join(MCP_DIR, "data");
}

function envFirst(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function buildLogger(env: NodeJS.ProcessEnv): Logger {
  const debug = ["1", "true", "yes", "on"].includes(
    String(env.HUST_DEBUG ?? "").toLowerCase(),
  );
  const write = (level: string, message: string): void => {
    process.stderr.write(`[hust-mcp] ${level} ${message}\n`);
  };
  return {
    debug: (message) => {
      if (debug) write("debug", message);
    },
    info: (message) => {
      if (debug) write("info", message);
    },
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}

export interface Credentials {
  username: string;
  password: string;
  account?: string;
}

export function readCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const username = envFirst(env, ["HUST_USERNAME", "HUST_UN"]);
  const password = envFirst(env, ["HUST_PASSWORD", "HUST_PWD"]);
  const account = envFirst(env, ["HUST_ACCOUNT"]);
  if (!username || !password) {
    throw new Error(
      "缺少登录凭据：请在环境变量里提供 HUST_USERNAME / HUST_PASSWORD（或 HUST_UN / HUST_PWD）",
    );
  }
  return { username, password, account };
}

let client: HustClient | undefined;

/** 惰性创建并复用 HustClient；凭据只来自进程环境变量，绝不来自工具参数 */
export function getClient(env: NodeJS.ProcessEnv = process.env): HustClient {
  if (client) return client;

  const credentials = readCredentials(env);
  const instance = hust
    .auth({
      user_name: credentials.username,
      password: credentials.password,
      account: credentials.account,
    })
    .withLogger(buildLogger(env));

  const aiBase = envFirst(env, [
    "HUST_AI_BASE_URL",
    "HUST_OPENAI_BASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
  ]);
  const aiKey = envFirst(env, ["HUST_AI_API_KEY", "HUST_OPENAI_API_KEY", "OPENAI_API_KEY"]);
  const aiModel = envFirst(env, ["HUST_AI_MODEL", "HUST_OPENAI_MODEL", "OPENAI_MODEL"]);
  const ocr = (env.HUST_OCR ?? "").toLowerCase();

  if (ocr === "stdchar") {
    instance.withStdChar();
  } else if (ocr === "ai") {
    if (!aiBase || !aiKey) {
      throw new Error("HUST_OCR=ai，但缺少 HUST_AI_BASE_URL / HUST_AI_API_KEY");
    }
    instance.withAiOcr({ baseURL: aiBase, apiKey: aiKey, model: aiModel ?? "gpt-4o-mini" });
  } else if (aiBase && aiKey) {
    instance.withAiOcr({ baseURL: aiBase, apiKey: aiKey, model: aiModel ?? "gpt-4o-mini" });
  } else {
    instance.withStdChar();
  }

  const sessionEnv = env.HUST_SESSION_FILE;
  if (sessionEnv !== "off" && sessionEnv !== "none") {
    const maxAge = Number(env.HUST_SESSION_MAX_AGE_MS);
    instance.persistent(sessionEnv || join(dataDir(env), "session.json"), {
      maxAgeMs: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : undefined,
    });
  }

  client = instance;
  return client;
}

/* ------------------------------ 响应格式化 ------------------------------ */

export interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function formatToolResponse(data: unknown): ToolResponse {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function formatErrorResponse(error: unknown): ToolResponse {
  if (error && typeof error === "object" && "code" in error && "details" in error) {
    const privacy = error as { code: string; message: string; details: Record<string, unknown> };
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: privacy.code, message: privacy.message, details: privacy.details },
            null,
            2,
          ),
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}
