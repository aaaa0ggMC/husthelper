import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { test } from "node:test";
import { displayWidth, padToWidth, parseDocument, parseInline, parseSkeleton, renderTemplate } from "../src/render.ts";

test("解析 [文字](ref:锚点) 与 frontmatter profile", () => {
  const markdown = [
    "---",
    "profile: hust-official",
    "---",
    "",
    "封面信息：",
    "[计算机科学与技术学院](ref:hrseg0017)",
    "[U202612345](ref:hrseg0021)",
    "",
  ].join("\n");

  const parsed = parseSkeleton(markdown);
  assert.equal(parsed.profile, "hust-official");
  assert.deepEqual(parsed.fills, [
    { ref: "hrseg0017", text: "计算机科学与技术学院", profile: "hust-official" },
    { ref: "hrseg0021", text: "U202612345", profile: "hust-official" },
  ]);
});

test("无 frontmatter、去重、宽松空格、HTML 实体", () => {
  const parsed = parseSkeleton("[A &amp; B](ref:x)\n[b](ref:x)\n[c]( ref : y )");
  assert.equal(parsed.profile, undefined);
  assert.deepEqual(parsed.fills, [
    { ref: "x", text: "A & B" },
    { ref: "y", text: "c" },
  ]);
});

test("options.profile 覆盖 frontmatter", () => {
  const parsed = parseSkeleton("---\nprofile: a\n---\n", { profile: "b" });
  assert.equal(parsed.profile, "b");
  assert.deepEqual(parsed.fills, []);
});

test("profile 可中途切换：文档级 -> 章节级 -> 块级", () => {
  const markdown = [
    "---",
    "profile: doc",
    "---",
    "# 一、封面 {profile: official}",
    "[A](ref:x)",
    "<!-- profile: compact -->",
    "[B](ref:y)",
    "[C](ref:z | profile=mini)",
  ].join("\n");

  const parsed = parseSkeleton(markdown);
  assert.equal(parsed.profile, "doc");
  assert.deepEqual(parsed.fills, [
    { ref: "x", text: "A", profile: "official" },
    { ref: "y", text: "B", profile: "compact" },
    { ref: "z", text: "C", profile: "mini" },
  ]);
});

test("没有 profile 时 fills 不带 profile 字段（文档级生效）", () => {
  const parsed = parseSkeleton("---\nprofile: doc\n---\n[a](ref:x)");
  assert.deepEqual(parsed.fills, [{ ref: "x", text: "a", profile: "doc" }]);
});

test("parseInline：粗体 / 斜体 / 粗斜 / 删除线 / 行内代码", () => {
  assert.deepEqual(parseInline("普通**粗体**和*斜体*"), [
    { text: "普通" },
    { text: "粗体", bold: true },
    { text: "和" },
    { text: "斜体", italic: true },
  ]);
  assert.deepEqual(parseInline("***粗斜***"), [{ text: "粗斜", bold: true, italic: true }]);
  assert.deepEqual(parseInline("~~删~~"), [{ text: "删", strike: true }]);
  // 行内代码去掉反引号、标成 code
  assert.deepEqual(parseInline("看 `code` 吧"), [
    { text: "看 " },
    { text: "code", code: true },
    { text: " 吧" },
  ]);
});

test("parseInline：链接（外部 URL 与内部书签）", () => {
  assert.deepEqual(parseInline("见[官网](https://example.com)"), [
    { text: "见" },
    { text: "官网", link: "https://example.com" },
  ]);
  assert.deepEqual(parseInline("[跳转](#hrseg0001)"), [{ text: "跳转", link: "#hrseg0001" }]);
  // ref: 链接属于填空，按普通文本处理
  assert.deepEqual(parseInline("[张三](ref:hrseg0001)"), [{ text: "张三" }]);
});

test("parseInline：链接文字内的强调会展开成多个带 link 的 run", () => {
  assert.deepEqual(parseInline("[**粗**链接](https://example.com)"), [
    { text: "粗", bold: true, link: "https://example.com" },
    { text: "链接", link: "https://example.com" },
  ]);
});

test("解析 fill 的 use: 样式覆盖", () => {
  const parsed = parseSkeleton("[正文内容](ref:hrseg0092 | use:body)");
  assert.deepEqual(parsed.fills, [{ ref: "hrseg0092", text: "正文内容", use: "body" }]);
});

test("解析 fill 的 padding 分组与 align", () => {
  const parsed = parseSkeleton("[张三](ref:a | padding=0 align=center)\n[李四](ref:b | padding=0)");
  assert.deepEqual(parsed.fills, [
    { ref: "a", text: "张三", padding: "0", align: "center" },
    { ref: "b", text: "李四", padding: "0" },
  ]);
});

test("displayWidth / padToWidth：CJK 算 2 宽，同组等宽", () => {
  assert.equal(displayWidth("张三"), 4);
  assert.equal(displayWidth("U2026"), 5);
  assert.equal(padToWidth("张三", 10, "left"), "张三" + " ".repeat(6));
  assert.equal(padToWidth("张三", 10, "right"), " ".repeat(6) + "张三");
  assert.equal(padToWidth("张三", 10, "center"), " ".repeat(3) + "张三" + " ".repeat(3));
  // 两个不同内容补齐到同一目标后，显示宽度相同
  assert.equal(displayWidth(padToWidth("U202612345", 10)), displayWidth(padToWidth("张三", 10)));
});

test("parseInline：同格式相邻片段合并、空文本兜底", () => {
  assert.deepEqual(parseInline("**a****b**"), [{ text: "ab", bold: true }]);
  assert.deepEqual(parseInline(""), [{ text: "" }]);
});

test("解析嵌套列表与任务列表", () => {
  const { blocks } = parseDocument("- a\n  - b\n    - c\n- [x] done\n- [ ] todo");
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, "list");
  assert.deepEqual(
    (list.items ?? []).map((item) => ({ text: item.text, level: item.level, checked: item.checked, ordered: item.ordered })),
    [
      { text: "a", level: 0, checked: undefined, ordered: false },
      { text: "b", level: 1, checked: undefined, ordered: false },
      { text: "c", level: 2, checked: undefined, ordered: false },
      { text: "done", level: 0, checked: true, ordered: false },
      { text: "todo", level: 0, checked: false, ordered: false },
    ],
  );
});

test("解析有序列表层级", () => {
  const { blocks } = parseDocument("1. 一\n2. 二\n   1. 二点一");
  const items = blocks[0].items ?? [];
  assert.deepEqual(items.map((i) => [i.text, i.level, i.ordered]), [
    ["一", 0, true],
    ["二", 0, true],
    ["二点一", 1, true],
  ]);
});

test("renderTemplate: 同一段落黏连的多个标题能自动切分，避免标题重复与错位", () => {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p>` +
    `<w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:bookmarkStart w:id="1" w:name="hrseg0001"/>` +
    `<w:r><w:t>实验6 指针程序设计实验</w:t></w:r>` +
    `<w:bookmarkEnd w:id="1"/>` +
    `<w:bookmarkStart w:id="2" w:name="hrseg0002"/>` +
    `<w:r><w:t>1.1 程序改错与跟踪调试</w:t></w:r>` +
    `<w:bookmarkEnd w:id="2"/>` +
    `</w:p>` +
    `</w:body></w:document>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const mockDoc = {
    partsData: [{ xmlDocument: doc, path: "word/document.xml" }],
    xmlDoc: doc,
  };

  const info: any = {
    version: 2,
    kind: "hustreport/template",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "insert", label: "章标题", tags: ["heading1"] },
      hrseg0002: { kind: "insert", label: "节标题", tags: ["heading2"] },
    },
    profiles: {
      default: {
        styles: {
          body: { inline: { paragraph: { styleId: "Normal" } } },
        },
        rules: [
          { match: { type: "heading", level: 1 }, style: { anchor: "hrseg0001" } },
          { match: { type: "heading", level: 2 }, style: { anchor: "hrseg0002" } },
          { match: { type: "paragraph" }, style: { anchor: "hrseg0001" } },
        ],
      },
    },
  };

  const md = [
    "# 实验6 指针程序设计实验 {ref:hrseg0001}",
    "",
    "## 1.1 程序改错与跟踪调试 {ref:hrseg0002}",
    "",
    "正文调试记录分析。",
  ].join("\n");

  const result = renderTemplate(mockDoc as any, info, md, { strip: false });
  assert.equal(result.warnings.length, 0);

  const body = doc.getElementsByTagName("w:body")[0];
  const paragraphs = Array.from(body.getElementsByTagName("w:p")) as any[];

  // 应该有两个标题段落 + 一个正文段落 = 3 个段落，且没有重复标题
  assert.equal(paragraphs.length, 3);
  assert.equal(paragraphs[0].textContent, "实验6 指针程序设计实验");
  assert.equal(paragraphs[1].textContent, "1.1 程序改错与跟踪调试");
  assert.equal(paragraphs[2].textContent, "正文调试记录分析。");
});

test("renderTemplate: 动态根据渲染标题生成目录 TOC 与 PAGEREF 书签引用", () => {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:sdt>` +
    `<w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr>` +
    `<w:sdtContent>` +
    `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>旧目录项1</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="TOC2"/></w:pPr><w:r><w:t>旧目录项2</w:t></w:r></w:p>` +
    `</w:sdtContent>` +
    `</w:sdt>` +
    `<w:p>` +
    `<w:bookmarkStart w:id="1" w:name="hrseg0001"/>` +
    `<w:r><w:t>旧标题</w:t></w:r>` +
    `<w:bookmarkEnd w:id="1"/>` +
    `</w:p>` +
    `</w:body></w:document>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const mockDoc = {
    partsData: [{ xmlDocument: doc, path: "word/document.xml" }],
    xmlDoc: doc,
  };

  const info: any = {
    version: 2,
    kind: "hustreport/template",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "insert", label: "标题", tags: ["heading1"] },
    },
    toc: {
      enabled: true,
      type: "sdt",
      maxLevel: 2,
      levels: {
        "1": { pStyle: "TOC1" },
        "2": { pStyle: "TOC2" },
      },
    },
    profiles: {
      default: {
        styles: {
          body: { inline: { paragraph: { styleId: "Normal" } } },
        },
        rules: [
          { match: { type: "heading", level: 1 }, style: { anchor: "hrseg0001" } },
          { match: { type: "heading", level: 2 }, style: { anchor: "hrseg0001" } },
          { match: { type: "paragraph" }, style: { anchor: "hrseg0001" } },
        ],
      },
    },
  };

  const md = [
    "# 一、实验目的 {ref:hrseg0001}",
    "",
    "## 1.1 背景与环境",
    "",
    "正文内容...",
  ].join("\n");

  const result = renderTemplate(mockDoc as any, info, md, { strip: false });
  assert.equal(result.warnings.length, 0);

  const sdtContent = doc.getElementsByTagName("w:sdtContent")[0];
  const tocPs = Array.from(sdtContent.getElementsByTagName("w:p")) as any[];

  // 渲染后 TOC 应该有两项：一、实验目的 与 1.1 背景与环境
  assert.equal(tocPs.length, 2);

  // 首段应包含 TOC 字段声明
  const instrText = tocPs[0].getElementsByTagName("w:instrText")[0];
  assert.ok(instrText);
  assert.match(instrText.textContent, /TOC/);

  // 末段应包含 end 字段
  const fldChars = Array.from(tocPs[1].getElementsByTagName("w:fldChar")) as any[];
  assert.ok(fldChars.some((fc) => fc.getAttribute("w:fldCharType") === "end"));

  // 每一项应包含超链接、文字、Tab 与页码
  const hl1 = tocPs[0].getElementsByTagName("w:hyperlink")[0];
  assert.ok(hl1);
  const bookmark1 = hl1.getAttribute("w:anchor");
  assert.ok(bookmark1);
  assert.match(hl1.textContent, /一、实验目的/);

  const tabs1 = Array.from(hl1.getElementsByTagName("w:tab")) as any[];
  assert.ok(tabs1.length > 0);

  // 正文对应的标题段落应该注入了对应的 bookmarkStart
  const bodyStarts = Array.from(doc.getElementsByTagName("w:bookmarkStart")) as any[];
  assert.ok(bodyStarts.some((bs) => bs.getAttribute("w:name") === bookmark1));
});


