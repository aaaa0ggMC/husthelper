import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyNormalization, type TemplateEdit } from "../src/template-ai.ts";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function parseDoc(xml: string) {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return { doc, mockDoc: { partsData: [{ xmlDocument: doc, path: "word/document.xml" }], xmlDoc: doc } } as any;
}

/** 一张 1 行 2 列、内容为示范占位符的表格。 */
function tableDoc(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p><w:r><w:t>表3-1 示范</w:t></w:r></w:p>` +
    `<w:tbl><w:tr>` +
    `<w:tc><w:p><w:bookmarkStart w:id="1" w:name="hrseg0001"/><w:r><w:t>×××</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:tc>` +
    `<w:tc><w:p><w:bookmarkStart w:id="2" w:name="hrseg0002"/><w:r><w:t>×××</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p></w:tc>` +
    `</w:tr></w:tbl>` +
    `</w:body></w:document>`
  );
}

test("applyNormalization: 删光表格单元格后自动移除空表格框架", () => {
  const { doc, mockDoc } = parseDoc(tableDoc());
  const warnings: string[] = [];
  const edits: TemplateEdit[] = [
    { op: "delete", ref: "hrseg0001", as: "paragraph" },
    { op: "delete", ref: "hrseg0002", as: "paragraph" },
  ];

  const result = applyNormalization(mockDoc, edits, warnings);
  assert.equal(result.deleted, 3);
  assert.equal((doc.getElementsByTagName("w:tbl") as any).length, 0);
  assert.ok(warnings.some((w) => w.includes("空表格框架")));
});

test("applyNormalization: 显式 target:table 删除整表", () => {
  const { doc, mockDoc } = parseDoc(tableDoc());
  const warnings: string[] = [];
  const result = applyNormalization(mockDoc, [{ op: "delete", target: "table", ref: "hrseg0001" }], warnings);

  assert.equal(result.deleted, 1);
  assert.equal((doc.getElementsByTagName("w:tbl") as any).length, 0);
  assert.deepEqual(warnings, []);
});

test("applyNormalization: 表格未被删空时保留，且补回空单元格段落", () => {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:tbl><w:tr>` +
    `<w:tc><w:p><w:bookmarkStart w:id="1" w:name="hrseg0001"/><w:r><w:t>保留内容</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:tc>` +
    `<w:tc><w:p><w:bookmarkStart w:id="2" w:name="hrseg0002"/><w:r><w:t>×××</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p></w:tc>` +
    `</w:tr></w:tbl>` +
    `</w:body></w:document>`;
  const { doc, mockDoc } = parseDoc(xml);
  const warnings: string[] = [];

  applyNormalization(mockDoc, [{ op: "delete", ref: "hrseg0002", as: "paragraph" }], warnings);

  const tables = Array.from(doc.getElementsByTagName("w:tbl")) as any[];
  assert.equal(tables.length, 1);
  // 被删空的单元格补回了空段落，OOXML 结构保持合法
  const cells = Array.from(tables[0].getElementsByTagName("w:tc")) as any[];
  assert.ok(cells.every((c) => c.getElementsByTagName("w:p").length > 0));
});
