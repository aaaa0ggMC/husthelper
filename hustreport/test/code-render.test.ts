import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplate } from "../src/render.ts";
import type { TemplateInfo } from "../src/template.ts";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function createMockDoc() {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    "<w:document xmlns:w=\"" + WORD_NS + "\">" +
    "<w:body>" +
    "<w:p>" +
    "<w:bookmarkStart w:id=\"0\" w:name=\"hrseg0001\"/>" +
    "<w:r><w:t>正文段落</w:t></w:r>" +
    "<w:bookmarkEnd w:id=\"0\"/>" +
    "</w:p>" +
    "<w:p>" +
    "<w:pPr><w:pStyle w:val=\"24\"/></w:pPr>" +
    "<w:bookmarkStart w:id=\"1\" w:name=\"hrseg0002\"/>" +
    "<w:r><w:rPr><w:rFonts w:ascii=\"Consolas\"/><w:sz w:val=\"18\"/></w:rPr><w:t>代码样板</w:t></w:r>" +
    "<w:bookmarkEnd w:id=\"1\"/>" +
    "</w:p>" +
    "<w:sectPr/>" +
    "</w:body></w:document>";
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return {
    partsData: [{ xmlDocument: doc, partUri: "word/document.xml" }],
    xmlDoc: doc,
  };
}

test("代码块渲染 (模式 B：默认生成 CodeInWord 风格表格)", () => {
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
        rules: [{ match: { type: "paragraph" }, style: { recipe: "body" } }],
      },
    },
  };

  const md = ["[正文更新](ref:hrseg0001)", "", "```python {ref: hrseg0001}", "def hello(name):", "    # say hi", "    return \"Hello \" + name", "```"].join("\n");

  const result = renderTemplate(mockDoc as any, info, md, { strip: false });
  assert.equal(result.filled, 1);
  assert.equal(result.inserted, 1);

  const body = mockDoc.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
  const tables = body.getElementsByTagNameNS(WORD_NS, "tbl");
  assert.equal(tables.length, 1, "应该插入一个表格代码块");

  const tbl = tables[0];
  const tcList = tbl.getElementsByTagNameNS(WORD_NS, "tc");
  assert.ok(tcList.length >= 6, "3行代码应该有 6 个单元格 (3 gutter + 3 code)");

  const borders = tbl.getElementsByTagNameNS(WORD_NS, "tcBorders");
  assert.ok(borders.length > 0);
  const rightBorder = borders[0].getElementsByTagNameNS(WORD_NS, "right")[0];
  assert.equal(rightBorder.getAttribute("w:color"), "52C41A");

  const colors = tbl.getElementsByTagNameNS(WORD_NS, "color");
  const colorVals = Array.from(colors).map((c: any) => c.getAttribute("w:val"));
  assert.ok(colorVals.includes("D73A49"), "应该包含关键字颜色 D73A49");
  assert.ok(colorVals.includes("6A737D"), "应该包含注释颜色 6A737D");
});

test("代码块渲染 (模式 A：原文档有代码样式且 lint: true)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "slot" },
      hrseg0002: { kind: "slot" },
    },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" }, code: { anchor: "hrseg0002" } },
        rules: [
          { match: { type: "paragraph" }, style: { recipe: "body" } },
          { match: { type: "code" }, style: { anchor: "hrseg0002" }, lint: true },
        ],
      },
    },
  };

  const md = ["[正文更新](ref:hrseg0001)", "", "```python {ref: hrseg0001}", "def foo():", "    return 1", "```"].join("\n");

  const result = renderTemplate(mockDoc as any, info, md, { strip: false });
  assert.equal(result.inserted, 2, "2行代码插入为2个段落");

  const body = mockDoc.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
  const tables = body.getElementsByTagNameNS(WORD_NS, "tbl");
  assert.equal(tables.length, 0, "模式 A 应该生成段落而不是表格");

  const pStyles = body.getElementsByTagNameNS(WORD_NS, "pStyle");
  const styleVals = Array.from(pStyles).map((p: any) => p.getAttribute("w:val"));
  assert.ok(styleVals.includes("24"), "应该复用模板原有的 XML Style ID 24");

  const colors = body.getElementsByTagNameNS(WORD_NS, "color");
  const colorVals = Array.from(colors).map((c: any) => c.getAttribute("w:val"));
  assert.ok(colorVals.includes("006699"), "模式 A 的 lint: true 应该应用标准关键字颜色 006699");
});

test("代码块渲染 (通过 markdown 显式指定 theme: dark)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "slot" },
      hrseg0002: { kind: "slot" },
    },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" }, code: { anchor: "hrseg0002" } },
        rules: [{ match: { type: "code" }, style: { anchor: "hrseg0002" } }],
      },
    },
  };

  const md = ["[正文更新](ref:hrseg0001)", "", "```python {ref: hrseg0001, theme: dark}", "x = 42", "```"].join("\n");

  renderTemplate(mockDoc as any, info, md, { strip: false });
  const body = mockDoc.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
  const tables = body.getElementsByTagNameNS(WORD_NS, "tbl");
  assert.equal(tables.length, 1, "显式指定 theme: dark 应该生成表格");

  const shdList = tables[0].getElementsByTagNameNS(WORD_NS, "shd");
  const fillVals = Array.from(shdList).map((s: any) => s.getAttribute("w:fill"));
  assert.ok(fillVals.includes("1E1E1E"), "代码列底色应该是深色 1E1E1E");
  assert.ok(fillVals.includes("252526"), "行号列底色应该是 252526");
});

test("代码块渲染 (隐藏行号 showLineNumbers: false)", () => {
  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" } },
    profiles: { default: { styles: { body: { anchor: "hrseg0001" } }, rules: [] } },
  };

  const md = ["[正文更新](ref:hrseg0001)", "", "```python {ref: hrseg0001}", "a = 1", "```"].join("\n");

  renderTemplate(mockDoc as any, info, md, { showLineNumbers: false, strip: false });
  const body = mockDoc.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
  const tables = body.getElementsByTagNameNS(WORD_NS, "tbl");
  assert.equal(tables.length, 1);
  const tcList = tables[0].getElementsByTagNameNS(WORD_NS, "tc");
  assert.equal(tcList.length, 1, "隐藏行号时只有 1 列代码单元格");
});