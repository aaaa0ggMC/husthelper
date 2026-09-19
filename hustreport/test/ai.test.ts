import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  clampMaxTokens,
  DEFAULT_MAX_TOKENS,
  extractCode,
  extractJson,
  isRetriableError,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  resolveChatConfig,
} from "../src/ai.ts";

test("clampMaxTokens：非法值回退默认，过小/过大夹到区间", () => {
  assert.equal(clampMaxTokens(undefined), DEFAULT_MAX_TOKENS);
  assert.equal(clampMaxTokens(0), DEFAULT_MAX_TOKENS);
  assert.equal(clampMaxTokens(-100), DEFAULT_MAX_TOKENS);
  assert.equal(clampMaxTokens(Number.NaN), DEFAULT_MAX_TOKENS);
  assert.equal(clampMaxTokens(10), MIN_MAX_TOKENS);
  assert.equal(clampMaxTokens(1_000_000), MAX_MAX_TOKENS);
  assert.equal(clampMaxTokens(4096.9), 4096);
});

test("isRetriableError：限流/超时/5xx/网络错误可重试，4xx 不可", () => {
  assert.equal(isRetriableError({ status: 429 }), true);
  assert.equal(isRetriableError({ status: 500 }), true);
  assert.equal(isRetriableError({ statusCode: 503 }), true);
  assert.equal(isRetriableError({ status: 400 }), false);
  assert.equal(isRetriableError({ status: 401 }), false);
  assert.equal(isRetriableError({ name: "APIConnectionError", message: "fetch failed" }), true);
  assert.equal(isRetriableError({ message: "socket hang up" }), true);
  assert.equal(isRetriableError({ message: "invalid request" }), false);
});

test("resolveChatConfig：环境变量优先，其次 config.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hust-ai-"));
  try {
    const configFile = path.join(dir, "config.json");
    writeFileSync(
      configFile,
      JSON.stringify({
        openai: { baseURL: "http://file/v1", apiKey: "file-key", model: "file-model", maxTokens: 1234, timeout: 5000 },
      }),
      "utf-8",
    );

    // 只用文件
    const fromFile = resolveChatConfig({ configFile, env: {} });
    assert.equal(fromFile.baseURL, "http://file/v1");
    assert.equal(fromFile.apiKey, "file-key");
    assert.equal(fromFile.model, "file-model");
    assert.equal(fromFile.maxTokens, 1234);
    assert.equal(fromFile.timeout, 5000);

    // 环境变量覆盖文件
    const fromEnv = resolveChatConfig({
      configFile,
      env: {
        HUST_AI_BASE_URL: "http://env/v1",
        HUST_AI_API_KEY: "env-key",
        HUST_AI_MODEL: "env-model",
        HUST_AI_MAX_TOKENS: "8192",
      },
    });
    assert.equal(fromEnv.baseURL, "http://env/v1");
    assert.equal(fromEnv.apiKey, "env-key");
    assert.equal(fromEnv.model, "env-model");
    assert.equal(fromEnv.maxTokens, 8192);
    // 文件里的 timeout 仍然生效（环境变量没覆盖）
    assert.equal(fromEnv.timeout, 5000);

    // 环境变量里的 timeout
    const withTimeout = resolveChatConfig({
      configFile,
      env: { HUST_AI_TIMEOUT: "90000" },
    });
    assert.equal(withTimeout.timeout, 90000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveChatConfig：配置缺失时报错；ai 段亦可作为别名", () => {
  assert.throws(() => resolveChatConfig({ cwd: "/definitely/not/here", env: {} }), /缺少 AI 配置/);

  const dir = mkdtempSync(path.join(tmpdir(), "hust-ai-alias-"));
  try {
    const configFile = path.join(dir, "config.json");
    writeFileSync(
      configFile,
      JSON.stringify({ ai: { baseURL: "http://alias/v1", apiKey: "k", model: "m" } }),
      "utf-8",
    );
    const resolved = resolveChatConfig({ configFile, env: {} });
    assert.equal(resolved.baseURL, "http://alias/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractJson：直接 JSON / 围栏 / 前后夹带说明", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('好的，结果如下：\n{"a": {"b": "}{"}}\n希望有帮助'), { a: { b: "}{" } });
  assert.equal(extractJson("完全不是 JSON"), null);
});

test("extractCode：优先围栏代码块", () => {
  assert.equal(extractCode("```js\nconst a = 1;\n```"), "const a = 1;");
  assert.equal(extractCode("const a = 1;"), "const a = 1;");
});
