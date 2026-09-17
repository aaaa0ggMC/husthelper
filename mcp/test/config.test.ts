import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configToEnv, loadConfigFile } from "../config.ts";

test("examples 形状的 config.json 能映射成 HUST_*", () => {
  const env = configToEnv({
    un: "U2025xxxxx",
    pwd: "secret",
    account: "123456",
    openai: { baseURL: "http://127.0.0.1:1145/v1", apiKey: "sk-x", model: "gpt-4o-mini" },
  });
  assert.equal(env.HUST_USERNAME, "U2025xxxxx");
  assert.equal(env.HUST_PASSWORD, "secret");
  assert.equal(env.HUST_ACCOUNT, "123456");
  assert.equal(env.HUST_AI_BASE_URL, "http://127.0.0.1:1145/v1");
  assert.equal(env.HUST_AI_API_KEY, "sk-x");
  assert.equal(env.HUST_AI_MODEL, "gpt-4o-mini");
});

test("嵌套 privacy 段与布尔值映射", () => {
  const env = configToEnv({
    username: "u",
    password: "p",
    privacy: { key: "abc", maxLevel: "raw", defaultLevel: "count", revealBudget: 10 },
    allowRaw: true,
    debug: false,
  });
  assert.equal(env.HUST_PRIVACY_KEY, "abc");
  assert.equal(env.HUST_MAX_LEVEL, "raw");
  assert.equal(env.HUST_DEFAULT_LEVEL, "count");
  assert.equal(env.HUST_REVEAL_BUDGET, "10");
  assert.equal(env.HUST_ALLOW_RAW, "1");
  assert.equal(env.HUST_DEBUG, "0");
});

test("loadConfigFile 读取文件并对非法内容报错", () => {
  const dir = mkdtempSync(join(tmpdir(), "hust-mcp-config-"));
  const file = join(dir, "credential.json");
  writeFileSync(file, JSON.stringify({ un: "U1", pwd: "P1" }));
  assert.equal(loadConfigFile(file).HUST_USERNAME, "U1");

  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.throws(() => loadConfigFile(bad), /不是合法 JSON/);
});
