import assert from "node:assert/strict";
import { test } from "node:test";
import { DOC_FORMAT_HINT, isDocFormat, openDocx } from "../src/docx.ts";

test("isDocFormat：按扩展名与 OLE2 头识别旧版 .doc", () => {
  assert.equal(isDocFormat("报告.doc"), true);
  assert.equal(isDocFormat("报告.DOC"), true);
  assert.equal(isDocFormat("报告.docx"), false);
  assert.equal(isDocFormat("报告.DOCX"), false);

  const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  assert.equal(isDocFormat(ole2), true);
  // 真实 .docx 是 zip（PK..）
  assert.equal(isDocFormat(Buffer.from("PK\u0003\u0004rest of zip")), false);
});

test("openDocx：旧版 .doc 抛出可操作错误（不触碰文件系统）", async () => {
  await assert.rejects(() => openDocx("/no/such/文件.doc"), (error: Error) => {
    assert.match(error.message, /只处理 \.docx/);
    assert.equal(error.message, DOC_FORMAT_HINT);
    return true;
  });
});
