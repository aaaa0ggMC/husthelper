import assert from "node:assert/strict";
import test from "node:test";
import { fitFontSize, lineWidthEm } from "../src/code-fit.ts";
import { resolveCodeSettings } from "../src/settings.ts";

test("lineWidthEm：西文 0.6em，中文 1em", () => {
  assert.equal(lineWidthEm(""), 0);
  assert.ok(Math.abs(lineWidthEm("abcde") - 3) < 1e-9);
  assert.equal(lineWidthEm("中文"), 2);
  assert.ok(Math.abs(lineWidthEm("a中") - 1.6) < 1e-9);
});

test("fitFontSize：短行不变，长行按比例缩小并取整半磅", () => {
  const base = { fontSize: 21, codeWidthTwips: 8000, minFontSize: 14 }; // 可用 (8000-230)/20 = 388.5pt
  const short = fitFontSize(["int main() { return 0; }"], base);
  assert.deepEqual([short.fontSize, short.shrunk, short.overflow], [21, false, false]);

  // 80 个西文 = 48em；10.5pt 时 504pt > 388.5pt，需缩到 floor(388.5/48*2) = 16 半磅
  const long = fitFontSize(["x".repeat(80)], base);
  assert.equal(long.fontSize, 16);
  assert.equal(long.shrunk, true);
  assert.equal(long.overflow, false);
});

test("fitFontSize：缩到下限仍放不下则给出 overflow 并停在下限", () => {
  const r = fitFontSize(["x".repeat(200)], { fontSize: 21, codeWidthTwips: 8000, minFontSize: 14 });
  assert.equal(r.fontSize, 14);
  assert.equal(r.shrunk, true);
  assert.equal(r.overflow, true);
  // 空输入、字号已低于下限都不出错
  assert.equal(fitFontSize([], { fontSize: 21, codeWidthTwips: 8000, minFontSize: 14 }).shrunk, false);
  assert.equal(fitFontSize(["x".repeat(200)], { fontSize: 12, codeWidthTwips: 8000, minFontSize: 14 }).fontSize, 12);
});

test("resolveCodeSettings：fit 默认开启，块属性/使用者可关闭", () => {
  const base = { rule: null, hasDocumentStyle: false } as const;
  assert.equal(resolveCodeSettings({ attrs: {}, user: undefined, ...base }).fit.value, true);
  assert.equal(resolveCodeSettings({ attrs: { fit: "false" }, user: undefined, ...base }).fit.value, false);
  assert.equal(resolveCodeSettings({ attrs: {}, user: { fit: false }, ...base }).fit.value, false);
  assert.equal(resolveCodeSettings({ attrs: { fit: "true" }, user: { fit: false }, ...base }).fit.value, true); // 块属性优先
  assert.equal(resolveCodeSettings({ attrs: {}, user: { minFontSize: 12 }, ...base }).minFontSize, 12);
  assert.equal(resolveCodeSettings({ attrs: {}, user: undefined, ...base }).minFontSize, 14);
});
