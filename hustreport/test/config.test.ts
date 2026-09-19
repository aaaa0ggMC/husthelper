import assert from "node:assert/strict";
import test from "node:test";
import { mergeConfig, parseExtraConfig, resolveReportConfigSync } from "../src/config.ts";

test("parseExtraConfig: 支持 JSON 格式与 key=val 格式", () => {
  const fromJson = parseExtraConfig(`{"code": {"template": "dark", "lineNumbers": false}}`);
  assert.equal(fromJson.code?.template, "dark");
  assert.equal(fromJson.code?.lineNumbers, false);

  const fromFlat = parseExtraConfig("code.template=classic, code.fontFamily=inherit, code.lineNumbers=false, code.fontSize=10pt");
  assert.equal(fromFlat.code?.template, "classic");
  assert.equal(fromFlat.code?.fontFamily, "inherit");
  assert.equal(fromFlat.code?.lineNumbers, false);
  assert.equal(fromFlat.code?.fontSize, "10pt");
});

test("mergeConfig: 深度合并", () => {
  const base = { code: { template: "default", lineNumbers: true, tabSize: 4 } };
  const override = { code: { template: "dark" } };
  const merged = mergeConfig(base, override);
  assert.equal(merged.code.template, "dark");
  assert.equal(merged.code.lineNumbers, true);
  assert.equal(merged.code.tabSize, 4);
});

test("resolveReportConfigSync: 空参数回退默认配置", () => {
  const conf = resolveReportConfigSync();
  assert.equal(conf.code?.template, "default");
  assert.equal(conf.code?.lineNumbers, true);
});
