import assert from "node:assert/strict";
import { test } from "node:test";
import { displayWidth, padToWidth, parseDocument, parseInline, parseSkeleton } from "../src/render.ts";

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
