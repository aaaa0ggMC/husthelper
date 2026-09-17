import assert from "node:assert/strict";
import { test } from "node:test";
import { isSensitiveTransaction, shapeResource } from "../shape.ts";

const transactions = {
  records: [
    {
      mercname: "后勤开水机",
      mercacc: "2000205",
      account: "6222021234567890123",
      sign_tranamt: "-570",
      tranamt: "570",
      occtime: "20260916220800",
      cardbal: "48580",
      remark: "posno:3100, 位置信息",
    },
    {
      mercname: "校医院药房",
      sign_tranamt: "-1200",
      tranamt: "1200",
      occtime: "20260917090000",
    },
  ],
  total: 2,
  pageSize: 10,
  nextPage: null,
  sources: ["ecard.transactions"],
};

test("redacted 流水：商户打码、卡号打码、备注丢弃", () => {
  const shaped = shapeResource("transactions", transactions, "redacted", {});
  const records = (shaped.value as { records: Record<string, unknown>[] }).records;
  assert.equal(records.length, 1, "医疗敏感条默认隐藏");
  assert.equal(shaped.hiddenSensitive, 1);
  assert.ok(!String(records[0].mercname).includes("开水机"));
  assert.ok(!String(records[0].account).includes("6222021234567890123"));
  assert.ok(records[0].account && String(records[0].account).endsWith("0123"));
  assert.equal(records[0].remark, undefined);
  assert.equal(records[0].sign_tranamt, "-570");
});

test("count 流水：只给数量与合计", () => {
  const shaped = shapeResource("transactions", transactions, "count", {});
  const value = shaped.value as Record<string, unknown>;
  assert.equal(value.count, 1);
  assert.equal(value.sum, -5.7);
  assert.equal((value as { records?: unknown }).records, undefined);
});

test("raw + includeSensitive 才看得到敏感条与原文", () => {
  const shaped = shapeResource("transactions", transactions, "raw", { includeSensitive: true });
  const records = (shaped.value as { records: Record<string, unknown>[] }).records;
  assert.equal(records.length, 2);
  assert.equal(shaped.hiddenSensitive, 0);
  assert.equal(records[0].mercname, "后勤开水机");
  assert.equal(records[0].remark, "posno:3100, 位置信息");
});

test("敏感判定命中医疗关键词", () => {
  assert.equal(isSensitiveTransaction({ mercname: "校医院药房" }), true);
  assert.equal(isSensitiveTransaction({ mercname: "后勤开水机" }), false);
});

test("me：身份字段打码且丢掉 raw", () => {
  const me = {
    name: "张三",
    studentId: "U202512345",
    department: "计算机学院",
    identity: "本科生",
    mobile: "13812345678",
    email: "alice@hust.edu.cn",
    cardAccount: "6222021234567890123",
    sources: ["one.myInfo"],
    raw: { USER_NAME: "张三", PASSWORD: "should-not-leak" },
  };
  const shaped = shapeResource("me", me, "redacted", {}).value as Record<string, unknown>;
  assert.ok(!String(shaped.name).includes("张三"));
  assert.ok(!String(shaped.studentId).includes("U202512345"));
  assert.equal(shaped.mobile, "138****5678");
  assert.equal(shaped.email, "a***@hust.edu.cn");
  assert.ok(String(shaped.cardAccount).endsWith("0123"));
  assert.equal(shaped.raw, undefined);
  assert.equal(shaped.department, "计算机学院");
});

test("devices：IP 打码", () => {
  const devices = {
    devices: [{ userIpv4: "192.168.1.100", userIpv6: ["2001:db8::1"], onlineTime: "2026-09-17" }],
    sources: ["hkwxy.onlineDevices"],
    raw: {},
  };
  const shaped = shapeResource("devices", devices, "redacted", {}).value as {
    devices: Record<string, unknown>[];
  };
  assert.equal(shaped.devices[0].userIpv4, "192.168.*.*");
  assert.equal(shaped.devices[0].userIpv6, "2001:****");
  assert.equal(shaped.devices[0].onlineTime, "2026-09-17");
});

test("count 概览只给数量", () => {
  const overview = {
    me: { name: "张三", sources: ["one.myInfo"], raw: {} },
    balance: { schoolCard: "48.58", sources: ["one.balance"], raw: {} },
    notifications: [{ title: "通知一", raw: {} }, { title: "通知二", raw: {} }],
    devices: [{ userIpv4: "10.0.0.1", raw: {} }],
    sources: ["me", "notifications"],
    errors: [],
  };
  const shaped = shapeResource("overview", overview, "count", {}).value as Record<string, unknown>;
  assert.deepEqual(shaped.me, { present: true, sources: ["one.myInfo"] });
  assert.deepEqual(shaped.notifications, { count: 2 });
  assert.deepEqual(shaped.devices, { count: 1 });
});
