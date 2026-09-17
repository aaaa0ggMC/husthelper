import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Privacy, PrivacyError, ensureKey, maskAccount, maskEmail, maskIp, maskPhone, maskText } from "../privacy.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hust-mcp-privacy-"));
}

test("打码是确定性的", () => {
  assert.equal(maskText("杭州深度求索"), maskText("杭州深度求索"));
  assert.notEqual(maskText("杭州深度求索"), "杭州深度求索");
  assert.equal(maskAccount("6222021234567890123"), "***************0123");
  assert.equal(maskPhone("13812345678"), "138****5678");
  assert.equal(maskEmail("alice@hust.edu.cn"), "a***@hust.edu.cn");
  assert.equal(maskIp("192.168.1.100"), "192.168.*.*");
  assert.equal(maskIp("2001:db8::1"), "2001:****");
});

test("redacted 默认且 raw 需要密钥", () => {
  const dir = tempDir();
  const { key } = ensureKey(dir);

  const noKey = new Privacy({ dir, env: {}, transport: "stdio" });
  assert.equal(noKey.defaultLevel, "redacted");
  assert.equal(noKey.rawAllowed, false);
  assert.throws(() => noKey.resolveLevel("raw"), (error) => error instanceof PrivacyError && error.code === "RAW_NOT_ALLOWED");

  const withKey = new Privacy({ dir, env: {}, suppliedKey: key, transport: "stdio" });
  assert.equal(withKey.rawAllowed, true);
  assert.equal(withKey.resolveLevel("raw"), "raw");
});

test("等级上限只能降不能升", () => {
  const dir = tempDir();
  const { key } = ensureKey(dir);
  const privacy = new Privacy({
    dir,
    env: {},
    suppliedKey: key,
    maxLevel: "redacted",
    transport: "http",
  });
  assert.equal(privacy.resolveLevel(), "redacted");
  assert.equal(privacy.resolveLevel("count"), "count");
  assert.throws(
    () => privacy.resolveLevel("raw"),
    (error) => error instanceof PrivacyError && error.code === "LEVEL_NOT_ALLOWED",
  );
});

test("HTTP 不提供匿名访问", () => {
  const dir = tempDir();
  ensureKey(dir);
  const privacy = new Privacy({ dir, env: {}, transport: "http" });
  assert.throws(
    () => privacy.assertAccess(),
    (error) => error instanceof PrivacyError && error.code === "ACCESS_DENIED",
  );
});

test("密钥不一致直接拒绝", () => {
  const dir = tempDir();
  ensureKey(dir);
  const privacy = new Privacy({ dir, env: {}, suppliedKey: "wrong-key", transport: "http" });
  assert.throws(
    () => privacy.assertKeyConsistent(),
    (error) => error instanceof PrivacyError && error.code === "PRIVACY_KEY_MISMATCH",
  );
});

test("逐条披露预算会拦截遍历", () => {
  const dir = tempDir();
  const { key } = ensureKey(dir);
  const privacy = new Privacy({
    dir,
    env: { HUST_REVEAL_BUDGET: "2" },
    suppliedKey: key,
    maxLevel: "raw",
    defaultLevel: "raw",
    transport: "stdio",
  });
  privacy.consume("raw", 2);
  assert.throws(
    () => privacy.consume("raw", 1),
    (error) => error instanceof PrivacyError && error.code === "REVEAL_BUDGET_EXCEEDED",
  );
  // count 不消耗预算
  privacy.consume("count", 1000);
});
