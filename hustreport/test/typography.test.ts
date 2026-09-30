import assert from "node:assert/strict";
import test from "node:test";
import { applySpacingToBlocks, parseDocument } from "../src/render.ts";
import { formatCjkSpacing, parseSpaceAction, resolveCjkSpacing } from "../src/typography.ts";

const S = "你好，我是 Claude Code 助理。";

test("四种组合：lspace / rspace 各自 add|remove", () => {
  const f = (l: string, r: string) => formatCjkSpacing(S, resolveCjkSpacing({ lspace: l, rspace: r }));
  assert.equal(f("remove", "remove"), "你好，我是Claude Code助理。");
  assert.equal(f("add", "remove"), "你好，我是 Claude Code助理。");
  assert.equal(f("remove", "add"), "你好，我是Claude Code 助理。");
  assert.equal(f("add", "add"), "你好，我是 Claude Code 助理。");
});

test("预设 space / tight / keep，lspace/rspace 覆盖预设", () => {
  assert.equal(formatCjkSpacing("我是Claude助理", resolveCjkSpacing({ cjkSpacing: "space" })), "我是 Claude 助理");
  assert.equal(formatCjkSpacing(S, resolveCjkSpacing({ cjkSpacing: "tight" })), "你好，我是Claude Code助理。");
  assert.equal(formatCjkSpacing(S, resolveCjkSpacing({ cjkSpacing: "keep" })), S);
  assert.equal(formatCjkSpacing("我是Claude助理", resolveCjkSpacing({ cjkSpacing: "space", rspace: "remove" })), "我是 Claude助理");
});

test("数字与西文同等对待；全角标点与西文之间不动", () => {
  const sp = resolveCjkSpacing({ cjkSpacing: "space" });
  assert.equal(formatCjkSpacing("共3360个用例", sp), "共 3360 个用例");
  assert.equal(formatCjkSpacing("共 3360 个用例", resolveCjkSpacing({ cjkSpacing: "tight" })), "共3360个用例");
  assert.equal(formatCjkSpacing("结果：PASS，通过", sp), "结果：PASS，通过");
  assert.equal(formatCjkSpacing("多个   空格Abc", sp), "多个 空格 Abc".replace("多个 空格 Abc", "多个   空格 Abc"));
});

test("行内代码在边界上按西文处理，代码内部、链接目标、URL、块属性不动", () => {
  const sp = resolveCjkSpacing({ cjkSpacing: "space" });
  assert.equal(formatCjkSpacing("调用`strlen`函数", sp), "调用 `strlen` 函数");
  assert.equal(formatCjkSpacing("调用 `strlen` 函数", resolveCjkSpacing({ cjkSpacing: "tight" })), "调用`strlen`函数");
  assert.equal(formatCjkSpacing("`中文abc`", sp), "`中文abc`");
  assert.equal(formatCjkSpacing("见[文档](http://a.com/中文abc)说明", sp), "见[文档](http://a.com/中文abc)说明");
  assert.equal(formatCjkSpacing("图注abc {ref:x1}", sp), "图注 abc {ref:x1}");
});

test("代码围栏与 ```text 展开的纯文本段落不被格式化，正常段落/表格/列表会", () => {
  const md = [
    "正文abc中文",
    "",
    "| 列 | 说明 |",
    "| :-- | :-- |",
    "| a中文b | 值1个 |",
    "",
    "- 项目3个",
    "",
    "```text",
    "[1] 作者abc. 中文标题Title, 2020.",
    "```",
    "",
    "```console",
    "输出abc 中文",
    "```",
  ].join("\n");
  const parsed = parseDocument(md);
  applySpacingToBlocks(parsed.blocks, resolveCjkSpacing({ cjkSpacing: "space" }));
  const para = parsed.blocks.find((b) => b.type === "paragraph" && b.text.startsWith("正文"));
  assert.equal(para?.text, "正文 abc 中文");
  const table = parsed.blocks.find((b) => b.type === "table");
  assert.deepEqual(table?.rows?.[1], ["a 中文 b", "值 1 个"]);
  const list = parsed.blocks.find((b) => b.type === "list");
  assert.equal(list?.items?.[0].text, "项目 3 个");
  const verbatim = parsed.blocks.find((b) => b.type === "paragraph" && b.rawRuns);
  assert.equal(verbatim?.text, "[1] 作者abc. 中文标题Title, 2020.");
  const code = parsed.blocks.find((b) => b.type === "code");
  assert.equal(code?.text, "输出abc 中文");
});

test("非法取值直接报错，空值视为未设置", () => {
  assert.throws(() => resolveCjkSpacing({ lspace: "maybe" }), /add \| remove \| keep/);
  assert.equal(parseSpaceAction("", "x"), undefined);
  assert.deepEqual(resolveCjkSpacing({}), { lspace: "keep", rspace: "keep" });
});
