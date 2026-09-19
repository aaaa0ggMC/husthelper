import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTables, extractTableStyle, findAncestorTable, summarizeTableStyle } from "../src/table-style.ts";
import { renderTemplate } from "../src/render.ts";
import type { TemplateInfo } from "../src/template.ts";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function parse(xml: string) {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  return new DOMParser().parseFromString(xml, "application/xml");
}

const SAMPLE_TABLE =
  `<w:tbl>` +
  `<w:tblPr><w:tblStyle w:val="12"/><w:tblW w:w="7920" w:type="dxa"/><w:jc w:val="center"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2160"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
  `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="12"/><w:bottom w:val="single" w:sz="4"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>` +
  `<w:p><w:bookmarkStart w:id="9" w:name="hrseg0009"/><w:pPr><w:jc w:val="center"/></w:pPr>` +
  `<w:r><w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="Times New Roman"/><w:sz w:val="21"/><w:color w:val="000000"/></w:rPr><w:t>×××</w:t></w:r>` +
  `<w:bookmarkEnd w:id="9"/></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>×××</w:t></w:r></w:p></w:tc>` +
  `</w:tr></w:tbl>`;

test("extractTableStyle：识别 tblStyle / 列宽 / 边框 / 单元格格式", () => {
  const doc = parse(`<w:document xmlns:w="${WORD_NS}"><w:body>${SAMPLE_TABLE}</w:body></w:document>`);
  const table = doc.getElementsByTagName("w:tbl")[0];

  const style = extractTableStyle(table as any);
  assert.equal(style.styleId, "12");
  assert.equal(style.rows, 1);
  assert.equal(style.columns, 2);
  assert.deepEqual(style.gridWidths, [1440, 2160]);
  assert.equal(style.tableAlign, "center");
  assert.equal(style.headerRepeat, true);
  assert.match(style.borders?.top ?? "", /single sz=12/);
  assert.match(style.borders?.bottom ?? "", /single sz=4/);
  assert.equal(style.cellFontEastAsia, "宋体");
  assert.equal(style.cellFontAscii, "Times New Roman");
  assert.equal(style.cellSize, "21");
  assert.equal(style.cellAlign, "center");
  assert.equal(style.verticalAlign, "center");

  const summary = summarizeTableStyle(style);
  assert.match(summary, /tblStyle=12/);
  assert.match(summary, /1行×2列/);
  assert.match(summary, /单元格字体/);
});

test("collectTables / findAncestorTable：分配 tblN 稳定 id", () => {
  const doc = parse(`<w:document xmlns:w="${WORD_NS}"><w:body>${SAMPLE_TABLE}</w:body></w:document>`);
  const mockDoc = { partsData: [{ path: "word/document.xml", xmlDocument: doc }] } as any;
  const tables = collectTables(mockDoc);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].id, "tbl1");
  assert.equal(tables[0].style.styleId, "12");

  const cellParagraph = doc.getElementsByTagName("w:p")[0];
  assert.equal(findAncestorTable(cellParagraph as any), doc.getElementsByTagName("w:tbl")[0]);
});

test("renderTemplate：table 规则带 styleAnchor 时复用文档表格样式", () => {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}"><w:body>` +
    `<w:p><w:bookmarkStart w:id="1" w:name="hrseg0001"/><w:r><w:t>插入点</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>` +
    SAMPLE_TABLE +
    `</w:body></w:document>`;
  const doc = parse(xml);
  const mockDoc = { partsData: [{ xmlDocument: doc, path: "word/document.xml" }], xmlDoc: doc };

  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "insert" },
      hrseg0009: { kind: "slot", inTable: true, tableRef: "tbl1" },
    },
    profiles: {
      default: {
        styles: {},
        rules: [
          { match: { type: "table" }, options: { styleAnchor: "hrseg0009" } },
          { match: { type: "paragraph" }, style: { inline: { paragraph: { styleId: "Normal" } } } },
        ],
      },
    },
  } as TemplateInfo;

  const md = ["| 模块 | 状态 |", "| :--- | :--- |", "| 内存池 | 正常 |", "{ref=hrseg0001}"].join("\n");
  const result = renderTemplate(mockDoc as any, info, md, { strip: false });
  assert.deepEqual(result.warnings, []);

  const tables = Array.from(doc.getElementsByTagName("w:tbl")) as any[];
  assert.equal(tables.length, 2);
  const generated = tables[0]; // 插在插入点段之后、样本表之前

  const tblStyle = generated.getElementsByTagName("w:tblStyle")[0];
  assert.equal(tblStyle.getAttribute("w:val"), "12");

  const tcBorders = generated.getElementsByTagName("w:tcBorders")[0];
  assert.ok(tcBorders);
  assert.equal(tcBorders.getElementsByTagName("w:top")[0].getAttribute("w:sz"), "12");

  const rFonts = generated.getElementsByTagName("w:rFonts")[0];
  assert.equal(rFonts.getAttribute("w:eastAsia"), "宋体");
  const sz = generated.getElementsByTagName("w:sz")[0];
  assert.equal(sz.getAttribute("w:val"), "21");
});
