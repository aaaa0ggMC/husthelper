// 从 JSON 文件加载配置（凭据 / OCR / 隐私 / 会话），映射成 HUST_* 环境变量。
//
// 用法：node index.ts credential.json
//       node index.ts --config credential.json --port 3000
//
// 文件里出现的字段会覆盖同名环境变量；文件没有的字段仍走环境变量。
// 兼容 husthelper examples 的 config.json 形状（un/pwd/account/openai）。

import { readFileSync } from "node:fs";

export type EnvOverlay = Record<string, string>;

function put(target: EnvOverlay, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "boolean") {
    target[key] = value ? "1" : "0";
    return;
  }
  if (typeof value === "object") return;
  target[key] = String(value);
}

function get(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== "") {
      return record[name];
    }
  }
  return undefined;
}

function section(raw: Record<string, unknown>, names: string[]): Record<string, unknown> {
  const value = get(raw, names);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 把文件里的字段映射为 HUST_* 环境变量覆盖 */
export function configToEnv(raw: Record<string, unknown>): EnvOverlay {
  const env: EnvOverlay = {};
  const privacy = section(raw, ["privacy"]);
  const ai = section(raw, ["openai", "ai"]);

  put(env, "HUST_USERNAME", get(raw, ["username", "user_name", "un", "HUST_USERNAME"]));
  put(env, "HUST_PASSWORD", get(raw, ["password", "pwd", "pass", "HUST_PASSWORD"]));
  put(env, "HUST_ACCOUNT", get(raw, ["account", "HUST_ACCOUNT"]));

  put(env, "HUST_OCR", get(raw, ["ocr", "HUST_OCR"]));
  put(env, "HUST_AI_BASE_URL", get(ai, ["baseURL", "base_url", "baseUrl"]) ?? get(raw, ["aiBaseURL", "ai_base_url"]));
  put(env, "HUST_AI_API_KEY", get(ai, ["apiKey", "api_key", "key"]) ?? get(raw, ["aiApiKey", "ai_api_key"]));
  put(env, "HUST_AI_MODEL", get(ai, ["model"]) ?? get(raw, ["aiModel", "ai_model"]));

  put(env, "HUST_SESSION_FILE", get(raw, ["sessionFile", "session_file", "HUST_SESSION_FILE"]));
  put(env, "HUST_SESSION_MAX_AGE_MS", get(raw, ["sessionMaxAgeMs", "session_max_age_ms", "HUST_SESSION_MAX_AGE_MS"]));
  put(env, "HUST_DATA_DIR", get(raw, ["dataDir", "data_dir", "HUST_DATA_DIR"]));
  put(env, "HUST_DEBUG", get(raw, ["debug", "HUST_DEBUG"]));

  put(env, "HUST_PRIVACY_KEY", get(raw, ["privacyKey", "privacy_key", "key"]) ?? get(privacy, ["key", "privacyKey", "privacy_key"]));
  put(env, "HUST_MAX_LEVEL", get(raw, ["maxLevel", "max_level", "HUST_MAX_LEVEL"]) ?? get(privacy, ["maxLevel", "max_level"]));
  put(env, "HUST_DEFAULT_LEVEL", get(raw, ["defaultLevel", "default_level", "HUST_DEFAULT_LEVEL"]) ?? get(privacy, ["defaultLevel", "default_level"]));
  put(env, "HUST_REVEAL_BUDGET", get(raw, ["revealBudget", "reveal_budget", "HUST_REVEAL_BUDGET"]) ?? get(privacy, ["revealBudget", "reveal_budget"]));
  put(env, "HUST_REDACTED_BUDGET", get(raw, ["redactedBudget", "redacted_budget", "HUST_REDACTED_BUDGET"]) ?? get(privacy, ["redactedBudget", "redacted_budget"]));
  put(env, "HUST_ALLOW_RAW", get(raw, ["allowRaw", "allow_raw", "HUST_ALLOW_RAW"]) ?? get(privacy, ["allowRaw", "allow_raw"]));
  put(env, "HUST_SHOW_SENSITIVE", get(raw, ["showSensitive", "show_sensitive", "HUST_SHOW_SENSITIVE"]) ?? get(privacy, ["showSensitive", "show_sensitive"]));
  put(env, "HUST_SESSION", get(raw, ["session", "HUST_SESSION"]));

  return env;
}

export function loadConfigFile(path: string): EnvOverlay {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`无法读取配置文件: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`配置文件不是合法 JSON: ${path}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`配置文件必须是 JSON 对象: ${path}`);
  }
  return configToEnv(raw as Record<string, unknown>);
}
