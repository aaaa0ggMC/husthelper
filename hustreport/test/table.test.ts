import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument, renderTemplate } from "../src/render.ts";
import type { TemplateInfo } from "../src/template.ts";

function createMockDoc() {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p>` +
    `<w:bookmarkStart w:id="0" w:name="hrseg0001"/>` +
    `<w:r><w:t>正文锚点</w:t></w:r>` +
    `<w:bookmarkEnd w:id="0"/>` +
    `</w:p>` +
    `</w:body></w:document>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return {
    partsData: [{ xmlDocument: doc, path: "word/document.xml" }],
    xmlDoc: doc,
  };
}

test("parseDocument: 表格解析、列对齐与属性提取", () => {
  const md = `
| 编号 | 名称 | 结果 | 耗时 |
| :--- | :---: | ---: | --- |
| 1 | 测试用例 A | 通过 | 12ms |
| 2 | 测试用例 B | 失败 | 35ms |
{theme=grid header=true}
`;
  const parsed = parseDocument(md);
  const tableBlock = parsed.blocks.find((b) => b.type === "table");
  assert.ok(tableBlock);
  assert.equal(tableBlock.rows?.length, 3);
  assert.deepEqual(tableBlock.alignments, ["left", "center", "right", "left"]);
  assert.equal(tableBlock.attrs?.theme, "grid");
  assert.equal(tableBlock.attrs?.header, "true");
});

test("renderTemplate: 表格渲染 (academic 三线表 & 首行表头)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" } },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" } },
        rules: [
          { match: { type: "paragraph" }, style: { recipe: "body" } },
          { match: { type: "table" }, options: { theme: "academic" } },
        ],
      },
    },
  };

  const md = `
---
profile: default
---

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| x | int | 坐标值 |
| y | int | 坐标值 |
{ref=hrseg0001}
`;

  const result = renderTemplate(mockDoc as any, info, md);
  assert.equal(result.inserted, 1);

  const body = mockDoc.xmlDoc.getElementsByTagName("w:body")[0];
  const tables = body.getElementsByTagName("w:tbl");
  assert.equal(tables.length, 1);

  const tbl = tables[0];
  const rows = tbl.getElementsByTagName("w:tr");
  assert.equal(rows.length, 3);

  // 首行应包含 w:tblHeader
  const headerRow = rows[0];
  const tblHeaders = headerRow.getElementsByTagName("w:tblHeader");
  assert.equal(tblHeaders.length, 1);

  // 三线表表头单元格应有下划线 (sz=6)
  const headerCells = headerRow.getElementsByTagName("w:tc");
  const bottomBorders = headerCells[0].getElementsByTagName("w:bottom");
  assert.equal(bottomBorders.length, 1);
  assert.equal(bottomBorders[0].getAttribute("w:sz"), "6");
});

test("renderTemplate: 表格渲染 (header=false 无表头)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" } },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" } },
        rules: [
          { match: { type: "table" }, options: { theme: "grid", header: false } },
        ],
      },
    },
  };

  const md = `
---
profile: default
---

| 数据1 | 数据2 |
| --- | --- |
| 数据3 | 数据4 |
{ref=hrseg0001 header=false}
`;

  const result = renderTemplate(mockDoc as any, info, md);
  assert.equal(result.inserted, 1);

  const body = mockDoc.xmlDoc.getElementsByTagName("w:body")[0];
  const rows = body.getElementsByTagName("w:tr");
  // header=false 时，不应包含 w:tblHeader
  for (let i = 0; i < rows.length; i += 1) {
    const tblHeaders = rows[i].getElementsByTagName("w:tblHeader");
    assert.equal(tblHeaders.length, 0);
  }
});

test("renderTemplate: 表格斑马纹主题 (striped)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" } },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" } },
        rules: [{ match: { type: "table" }, options: { theme: "striped" } }],
      },
    },
  };

  const md = `
---
profile: default
---

| 列A | 列B |
| --- | --- |
| 行1 | 值1 |
| 行2 | 值2 |
{ref=hrseg0001}
`;

  renderTemplate(mockDoc as any, info, md);
  const body = mockDoc.xmlDoc.getElementsByTagName("w:body")[0];
  const shdList = body.getElementsByTagName("w:shd");
  assert.ok(shdList.length >= 1);
});
