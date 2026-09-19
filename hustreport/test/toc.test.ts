import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate } from "../src/render.ts";
import type { TemplateInfo } from "../src/template.ts";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function parseDoc(xml: string) {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return { doc, mockDoc: { partsData: [{ xmlDocument: doc, path: "word/document.xml" }], xmlDoc: doc } };
}

function manualTocInfo(): TemplateInfo {
  return {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {},
    toc: {
      enabled: true,
      type: "manual",
      maxLevel: 2,
      levels: { "1": { pStyle: "31" }, "2": { pStyle: "31" } },
    },
    profiles: {
      default: {
        styles: { body: { inline: { paragraph: { styleId: "Normal" } } } },
        rules: [
          { match: { type: "heading", level: 1 }, style: { ooxmlStyleId: "Heading1" } },
          { match: { type: "heading", level: 2 }, style: { ooxmlStyleId: "Heading2" } },
          { match: { type: "paragraph" }, style: { inline: { paragraph: { styleId: "Normal" } } } },
        ],
      },
    },
  } as TemplateInfo;
}

test("renderTemplate: 手工目录（manual）按标题重建为可点击条目", () => {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p><w:r><w:t>目录</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="31"/></w:pPr><w:r><w:t>旧条目一</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="31"/></w:pPr><w:r><w:t>旧条目二</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>2</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
    `<w:bookmarkStart w:id="1" w:name="__RefHeading___Toc1"/>` +
    `<w:r><w:t>1 引言</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>` +
    `<w:bookmarkStart w:id="2" w:name="__RefHeading___Toc2"/>` +
    `<w:r><w:t>1.1 背景</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>` +
    `</w:body></w:document>`;
  const { doc, mockDoc } = parseDoc(xml);

  const result = renderTemplate(mockDoc as any, manualTocInfo(), "", { strip: false });
  assert.deepEqual(result.warnings, []);

  const paragraphs = Array.from(doc.getElementsByTagName("w:p")) as any[];
  const titleIndex = paragraphs.findIndex((p) => p.textContent?.trim() === "目录");
  assert.ok(titleIndex >= 0);
  const following = paragraphs.slice(titleIndex + 1);

  // 旧的占位条目已被替换
  assert.ok(!following.some((p) => /旧条目/.test(p.textContent ?? "")));

  // 生成了 2 条目录项，均带超链接锚点
  const entries = following.filter((p) => p.getElementsByTagName("w:hyperlink").length > 0);
  assert.equal(entries.length, 2);
  const anchors = entries.map((p) => p.getElementsByTagName("w:hyperlink")[0].getAttribute("w:anchor"));
  assert.deepEqual(anchors, ["__RefHeading___Toc1", "__RefHeading___Toc2"]);
  assert.match(entries[0].textContent ?? "", /1 引言/);
  assert.match(entries[1].textContent ?? "", /1\.1 背景/);
});

test("renderTemplate: 手工目录条目被清空后仍在“目录”标题下重建", () => {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p><w:r><w:t>目录</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>1 引言</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
    `<w:bookmarkStart w:id="1" w:name="__RefHeading___Toc1"/>` +
    `<w:r><w:t>1 引言</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>` +
    `</w:body></w:document>`;
  const { doc, mockDoc } = parseDoc(xml);

  renderTemplate(mockDoc as any, manualTocInfo(), "", { strip: false });

  const paragraphs = Array.from(doc.getElementsByTagName("w:p")) as any[];
  const titleIndex = paragraphs.findIndex((p) => p.textContent?.trim() === "目录");
  // “目录”标题后应生成了带超链接的目录项
  const after = paragraphs.slice(titleIndex + 1);
  const entries = after.filter((p) => p.getElementsByTagName("w:hyperlink").length > 0);
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].getElementsByTagName("w:hyperlink")[0].getAttribute("w:anchor"), "__RefHeading___Toc1");
});

test("renderTemplate: 未声明 manual 时不改动普通目录样式段落", () => {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p><w:r><w:t>目录</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>这是一段普通正文</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const { doc, mockDoc } = parseDoc(xml);
  const info = manualTocInfo();
  info.toc = { enabled: true, type: "sdt", maxLevel: 2 };

  renderTemplate(mockDoc as any, info, "", { strip: false });
  assert.ok(Array.from(doc.getElementsByTagName("w:p")).some((p: any) => p.textContent === "这是一段普通正文"));
});
