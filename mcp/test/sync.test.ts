import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectLedger,
  ecardToLedgerEntry,
  enumerateMonths,
  occTimeToIso,
  parseSince,
  splitCommand,
  toCompact,
} from "../sync.ts";

test("splitCommand 支持引号包裹的路径", () => {
  assert.deepEqual(splitCommand("ledger"), ["ledger"]);
  assert.deepEqual(splitCommand("node /a/b/bin/ledger.js"), ["node", "/a/b/bin/ledger.js"]);
  assert.deepEqual(splitCommand('node "/path with space/ledger.js"'), [
    "node",
    "/path with space/ledger.js",
  ]);
  assert.throws(() => splitCommand('node "oops'));
});

test("detectLedger 能识别存在与不存在", () => {
  const ok = detectLedger({ HUST_LEDGER_CMD: process.execPath } as NodeJS.ProcessEnv);
  assert.equal(ok.available, true);

  const missing = detectLedger({
    HUST_LEDGER_CMD: "definitely-not-a-real-hust-ledger-cmd",
  } as NodeJS.ProcessEnv);
  assert.equal(missing.available, false);
  assert.match(missing.reason ?? "", /找不到命令/);
});

test("occTimeToIso 只接受 14 位时间", () => {
  assert.equal(occTimeToIso("20260918170100"), "2026-09-18 17:01:00");
  assert.equal(occTimeToIso("2026-09-18"), undefined);
  assert.equal(occTimeToIso(undefined), undefined);
});

test("ecardToLedgerEntry 映射金额、方向、来源与敏感标记", () => {
  const spend = ecardToLedgerEntry({
    mercname: "后勤开水机",
    tranname: "卡账户消费",
    sign_tranamt: "-15",
    occtime: "20260918170100",
    remark: "posno:3100",
  });
  assert.equal(spend?.occurredAt, "2026-09-18 17:01:00");
  assert.equal(spend?.amount, "0.15");
  assert.equal(spend?.direction, "expense");
  assert.equal(spend?.source, "ecard");
  assert.equal(spend?.method, "校园卡");
  assert.equal(spend?.sensitive, false);

  const topup = ecardToLedgerEntry({
    mercname: "一卡通充值",
    tranname: "银行转账",
    sign_tranamt: "10000",
    occtime: "20260918090000",
  });
  assert.equal(topup?.amount, "100.00");
  assert.equal(topup?.direction, "income");

  const medical = ecardToLedgerEntry({
    mercname: "校医院",
    tranname: "卡账户消费",
    sign_tranamt: "-2000",
    occtime: "20260918090000",
  });
  assert.equal(medical?.sensitive, true);

  assert.equal(ecardToLedgerEntry({ sign_tranamt: "0", occtime: "20260918090000" }), null);
  assert.equal(ecardToLedgerEntry({ sign_tranamt: "-1", occtime: "bad" }), null);
});

test("parseSince / toCompact / enumerateMonths", () => {
  const date = parseSince("2026-09-18 17:01:00");
  assert.equal(toCompact(date), "20260918170100");
  assert.equal(toCompact(parseSince("2026-09-01")), "20260901000000");
  assert.throws(() => parseSince("not-a-date"));

  assert.deepEqual(enumerateMonths(parseSince("2025-11-15"), parseSince("2026-02-01")), [
    "2025-11-01",
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
  ]);
  assert.deepEqual(enumerateMonths(parseSince("2026-02-01"), parseSince("2026-02-28")), [
    "2026-02-01",
  ]);
});
