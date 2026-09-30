import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderTemplate } from "../src/render.ts";
import { resolveCodeSettings, resolveImageSettings, resolveTableSettings } from "../src/settings.ts";
import { findConfigUpwards, resolveReportConfigSync } from "../src/config.ts";
import { resolveChatConfig } from "../src/ai.ts";
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


function nativeInfo(): TemplateInfo {
  return {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" }, hrseg0002: { kind: "slot" } },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" }, code: { anchor: "hrseg0002" } },
        rules: [
          { match: { type: "paragraph" }, style: { recipe: "body" } },
          { match: { type: "heading" }, style: { recipe: "body" } },
          { match: { type: "code" }, style: { anchor: "hrseg0002" } },
        ],
      },
    },
  };
}

const bodyOf = (mock: ReturnType<typeof createMockDoc>) => mock.xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];

test("覆盖准则：block > user > template > default", () => {
  const rule = { match: { type: "code" }, theme: "eclipse" } as any;
  const fromTemplate = resolveCodeSettings({ attrs: {}, rule, user: {}, hasDocumentStyle: true });
  assert.deepEqual(fromTemplate.theme, { value: "eclipse", from: "template" });
  assert.equal(fromTemplate.mode.value, "card", "规则指定主题 → 模板层决定卡片");

  const fromUser = resolveCodeSettings({ attrs: {}, rule, user: { template: "dark", mode: "native" }, hasDocumentStyle: true });
  assert.deepEqual(fromUser.theme, { value: "dark", from: "user" });
  assert.deepEqual(fromUser.mode, { value: "native", from: "user" });

  const fromBlock = resolveCodeSettings({ attrs: { mode: "card", line: "false" }, rule, user: { mode: "native", lineNumbers: true }, hasDocumentStyle: true });
  assert.deepEqual(fromBlock.mode, { value: "card", from: "block" });
  assert.deepEqual(fromBlock.lineNumbers, { value: false, from: "block" });

  const fallback = resolveCodeSettings({ attrs: { mode: "native" }, rule: null, user: {}, hasDocumentStyle: false });
  assert.equal(fallback.mode.value, "card");
  assert.ok(fallback.note);

  const image = resolveImageSettings({ attrs: {}, rule: { match: { type: "image" }, options: { align: "left" } } as any, user: { align: "right" } });
  assert.deepEqual(image.align, { value: "right", from: "user" });

  const table = resolveTableSettings({ attrs: {}, rule: { match: { type: "table" }, options: { styleAnchor: "hrseg0001" } } as any, user: {} });
  assert.equal(table.styleAnchor, "hrseg0001", "未显式指定主题时沿用模板样板表");
  const tableUser = resolveTableSettings({ attrs: { theme: "grid" }, rule: { match: { type: "table" }, options: { styleAnchor: "hrseg0001" } } as any, user: {} });
  assert.equal(tableUser.styleAnchor, undefined, "块指定主题后不再克隆样板表");
});

test("--code-template 只换配色，不再强制卡片；--code-mode card 才强制", () => {
  const mock = createMockDoc();
  const md = ["```c {ref: hrseg0001}", "int main() {", "  return 0;", "}", "```"].join("\n");
  const result = renderTemplate(mock as any, nativeInfo(), md, { strip: false, config: {}, codeTemplate: "dark" });
  assert.equal(bodyOf(mock).getElementsByTagNameNS(WORD_NS, "tbl").length, 0);
  assert.equal(result.trace[0].mode, "native");
  assert.equal(result.stats.codeNative, 1);

  const mock2 = createMockDoc();
  const result2 = renderTemplate(mock2 as any, nativeInfo(), md, { strip: false, config: {}, codeMode: "card", codeTemplate: "dark" });
  assert.equal(bodyOf(mock2).getElementsByTagNameNS(WORD_NS, "tbl").length, 1);
  assert.equal(result2.trace[0].mode, "card");
  assert.equal(result2.trace[0].theme, "dark");
});

test("缺图默认占位 + 警告，--strict 报错", () => {
  const md = ["段落 {ref:hrseg0001}", "", "![运行结果](./not-exist.png)"].join("\n");
  const mock = createMockDoc();
  const result = renderTemplate(mock as any, nativeInfo(), md, { strip: false, config: {} });
  assert.deepEqual(result.stats.missingImages, ["./not-exist.png"]);
  assert.ok(result.warnings.some((w) => w.includes("not-exist.png")));
  assert.ok(bodyOf(mock).textContent.includes("【缺图：./not-exist.png】 运行结果"));

  assert.throws(() => renderTemplate(createMockDoc() as any, nativeInfo(), md, { strip: false, config: {}, strict: true }), /图片文件未找到/);
});

test("表格单元格支持行内 Markdown", () => {
  const mock = createMockDoc();
  const md = ["| 函数 | 说明 |", "| --- | --- |", "| `absVal` | **绝对值** |", "{ref:hrseg0001}"].join("\n");
  const result = renderTemplate(mock as any, nativeInfo(), md, { strip: false, config: {} });
  assert.equal(result.stats.tables, 1);
  const tbl = bodyOf(mock).getElementsByTagNameNS(WORD_NS, "tbl")[0];
  assert.ok(!tbl.textContent.includes("`"), "反引号不应进入 docx");
  assert.ok(!tbl.textContent.includes("**"));
  const fonts = Array.from(tbl.getElementsByTagNameNS(WORD_NS, "rFonts")).map((f: any) => f.getAttribute("w:ascii"));
  assert.ok(fonts.includes("Consolas"), "行内代码使用等宽字体");
});

test("无目录模板不生成 _Toc_hr 书签；trace 统计插入块", () => {
  const mock = createMockDoc();
  const md = ["## 一、实验目的 {ref:hrseg0001}", "", "正文一段。", "", "- 列表项"].join("\n");
  const result = renderTemplate(mock as any, nativeInfo(), md, { strip: false, config: {} });
  const names = Array.from(bodyOf(mock).getElementsByTagNameNS(WORD_NS, "bookmarkStart")).map((b: any) => b.getAttribute("w:name"));
  assert.ok(!names.some((n) => String(n).startsWith("_Toc_hr")));
  assert.equal(result.stats.headings, 1);
  assert.equal(result.stats.paragraphs, 1);
  assert.equal(result.stats.lists, 1);
  assert.equal(result.stats.skipped, 0);
});

test("配置文件：向上回溯查找；显式 --config 不存在时报错", () => {
  const root = mkdtempSync(path.join(tmpdir(), "hust-cfg-"));
  try {
    const nested = path.join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(root, "config.json"), JSON.stringify({ openai: { baseURL: "http://x/v1", apiKey: "k", model: "m" } }));
    writeFileSync(path.join(root, "a", "hustreport.config.json"), JSON.stringify({ code: { mode: "card" } }));

    const ai = resolveChatConfig({ cwd: nested, env: {} });
    assert.equal(ai.model, "m");
    assert.equal(ai.source, path.join(root, "config.json"), "跳过不含 openai 段的 hustreport.config.json，继续向上");

    const report = resolveReportConfigSync({ cwd: nested });
    assert.equal(report.code?.mode, "card");
    assert.equal(report.source, path.join(root, "a", "hustreport.config.json"));
    assert.equal(findConfigUpwards(["nope.json"], nested), undefined);

    assert.throws(() => resolveChatConfig({ cwd: nested, configFile: "missing.json", env: {} }), /配置文件不存在/);
    assert.throws(() => resolveReportConfigSync({ cwd: nested, configFile: "missing.json" }), /配置文件不存在/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
