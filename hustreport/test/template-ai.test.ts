import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplateAiMessages, mergeTemplateAiResponse } from "../src/template-ai.ts";
import { TEMPLATE_KIND, TEMPLATE_VERSION, type TemplateInfo } from "../src/template.ts";

function fakeInfo(): TemplateInfo {
  return {
    version: TEMPLATE_VERSION,
    kind: TEMPLATE_KIND,
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    anchors: {
      hrseg0001: { kind: "slot", label: " ", styleId: 8, style: { anchor: "hrseg0001" } },
      hrseg0002: { kind: "insert", label: "五、源码", styleId: 26, style: { anchor: "hrseg0002" } },
      hrseg0003: { kind: "insert", label: "正文", styleId: 12, style: { anchor: "hrseg0003" } },
    },
    defaultProfile: "default",
    profiles: { default: { styles: { body: { anchor: "hrseg0003" } }, rules: [{ match: { type: "paragraph" }, style: { anchor: "hrseg0003" } }] } },
  };
}

test("mergeTemplateAiResponse：校验规则/锚点/skeleton 并合并", () => {
  const info = fakeInfo();
  const ai = JSON.stringify({
    rules: [
      { match: { type: "heading", level: 1 }, style: { anchor: "hrseg0002" } },
      { match: { type: "paragraph" }, style: { recipe: "body" } },
      { match: { type: "code" }, style: { anchor: "hrseg9999" } },
    ],
    anchors: { hrseg0001: { kind: "slot", label: "学号", tags: ["cover"] } },
    skeleton: "[U202612345](ref:hrseg0001)\n\n# 六、参考文献 {ref:hrseg0002}\n",
  });

  const { info: merged, skeleton, warnings } = mergeTemplateAiResponse(ai, info);

  assert.deepEqual(
    merged.profiles.default.rules.map((rule) => rule.match.type),
    ["heading", "paragraph"],
  );
  assert.equal(merged.anchors.hrseg0001.label, "学号");
  assert.deepEqual(merged.anchors.hrseg0001.tags, ["cover"]);
  assert.match(skeleton, /U202612345/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hrseg9999/);
});

test("mergeTemplateAiResponse：skeleton 引用未知锚点会告警", () => {
  const info = fakeInfo();
  const { warnings } = mergeTemplateAiResponse(JSON.stringify({ skeleton: "[x](ref:hrseg8888)" }), info);
  assert.ok(warnings.some((warning) => warning.includes("hrseg8888")));
});

test("mergeTemplateAiResponse：非 JSON 返回时保留原模板", () => {
  const info = fakeInfo();
  const { info: merged, warnings } = mergeTemplateAiResponse("抱歉，我无法完成。", info);
  assert.equal(merged.profiles.default.rules.length, 1);
  assert.ok(warnings.some((warning) => warning.includes("JSON")));
});

test("mergeTemplateAiResponse：规范化 edits 只保留合法项", () => {
  const info = fakeInfo();
  const ai = JSON.stringify({
    skeleton: "# ok",
    edits: [
      { op: "delete", ref: "hrseg0002", as: "paragraph" },
      { op: "delete", ref: "hrseg7777" },
      { op: "oops", ref: "hrseg0001" },
    ],
  });
  const { edits, warnings } = mergeTemplateAiResponse(ai, info);
  assert.deepEqual(edits, [{ op: "delete", ref: "hrseg0002", as: "paragraph" }]);
  assert.equal(warnings.length, 2);
});

test("buildTemplateAiMessages：带上锚点表与规则约定", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), "帮我做实验报告模板");
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /rules/);
  assert.match(messages[1].content, /hrseg0002/);
  assert.match(messages[1].content, /帮我做实验报告模板/);
});

test("systemPrompt 完全替换内置提示词，不叠加", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), { systemPrompt: "只用我这句话" });
  assert.equal(messages[0].content, "只用我这句话");
  assert.doesNotMatch(messages[0].content, /Word 报告模板助手/);
});

test("systemPrompt 传空字符串时不发送 system 消息", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), { systemPrompt: "" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
});

test("preset：generic 是文档无关的，不含实验报告专用例子", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), { preset: "generic" });
  assert.match(messages[0].content, /rules/);
  assert.doesNotMatch(messages[0].content, /单倍行距/);
  assert.doesNotMatch(messages[0].content, /实验目的与要求/);
});

test("preset：labReport 叠加判断准则", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), { preset: "labReport" });
  assert.match(messages[0].content, /单倍行距/);
});

test("systemPrompt 优先级高于 preset", () => {
  const messages = buildTemplateAiMessages(fakeInfo(), { preset: "labReport", systemPrompt: "只用这句" });
  assert.equal(messages[0].content, "只用这句");
});

test("isInstructionalText: 纯文本语义判别引导语与占位符", async () => {
  const { isInstructionalText, isCoverLabel } = await import("../src/template-ai.ts");

  // 占位符
  assert.equal(isInstructionalText("××××××××××××××××"), true);
  assert.equal(isInstructionalText("......"), true);
  assert.equal(isInstructionalText("[2]......"), true);
  assert.equal(isInstructionalText("××××××××,××××××××（同1.2）"), true);

  // 指令与注意事项
  assert.equal(isInstructionalText("注意："), true);
  assert.equal(isInstructionalText("1、按照《C语言程序设计典型题解与实验指导》书中题目撰写报告，书中未发布到头歌的题目不写；"), true);
  assert.equal(isInstructionalText("2、请将所有红色文字和批注删除，否则扣分；"), true);
  assert.equal(isInstructionalText("4、本文仅为排版的参考模板，文字请替换为实际内容。"), true);

  // 任务作答指引与要求
  assert.equal(isInstructionalText("对于程序改错，下划线指出有错的代码行，分析错误原因，给出改正方案。"), true);
  assert.equal(isInstructionalText("对于程序完善，将程序中下划线处的代码补充完整，给一个运行截图说明答案的正确性。"), true);
  assert.equal(isInstructionalText("对于程序设计题："), true);
  assert.equal(isInstructionalText("1）分析解题思路，给出算法步骤或流程图，可用visio等工具画流程图；全文要求至少2个流程图。"), true);
  assert.equal(isInstructionalText("2）给出程序源代码 ：注意编码的规范性，如缩进对齐，关键位置注释，主要变量和函数的命名有可理解性等；"), true);

  // 心得小结指引
  assert.equal(isInstructionalText("可以写通过本次实验学到了什么知识，有哪些提高，又有哪些不足，调试程序过程中遇到的问题及解决办法，有什么体会等。"), true);

  // 括号内的排版/作答提示
  assert.equal(isInstructionalText("（图号按章编，例如 图1-1,图1-2，图2-1，图2-2 等）"), true);
  assert.equal(isInstructionalText("......(省略号代表后续题目，每道题都要写，要求一样，重在设计思路、解题方法的文字描述，而不是仅简单地粘贴代码）"), true);
  assert.equal(isInstructionalText("(先分析表达式的求值过程，给出计算值，再编程验证，给出验证程序)"), true);

  // 绝不误伤的内容（封面字段、章节标题、正文知识点）
  assert.equal(isInstructionalText("课 程 实 验 报 告"), false);
  assert.equal(isInstructionalText("专业班级："), false);
  assert.equal(isInstructionalText("学    号："), false);
  assert.equal(isInstructionalText("1.1 程序改错与跟踪调试"), false);
  assert.equal(isInstructionalText("1.4 小结"), false);
  assert.equal(isInstructionalText("参考文献"), false);
  assert.equal(isInstructionalText("[1] 卢萍,李开. C语言程序设计,北京：清华大学出版社,2019"), false);

  assert.equal(isCoverLabel("专业班级"), true);
  assert.equal(isCoverLabel("指导教师"), true);
  assert.equal(isCoverLabel("小结"), false);
});

test("mergeTemplateAiResponse: 兜底自动清理未在 edits 中声明删除的引导段落", () => {
  const info = fakeInfo();
  info.anchors["hrseg0099"] = {
    kind: "insert",
    label: "对于程序改错",
    paragraphText: "对于程序改错，下划线指出有错的代码行，分析错误原因，给出改正方案。",
    styleId: 0,
  };
  info.anchors["hrseg0100"] = {
    kind: "insert",
    label: "占位符",
    paragraphText: "××××××××××××××××××××",
    styleId: 0,
  };

  const aiOutput = JSON.stringify({
    rules: [{ match: { type: "paragraph" }, style: { anchor: "hrseg0001" } }],
    skeleton: "---\nprofile: default\n---\n[默认班级](ref:hrseg0001 | padding=cover)\n",
  });

  const merged = mergeTemplateAiResponse(aiOutput, info);
  const deleteEdits = merged.edits.filter((e) => e.op === "delete");
  const deletedRefs = deleteEdits.map((e) => e.ref);

  assert.ok(deletedRefs.includes("hrseg0099"), "hrseg0099 应该被自动加入删除操作");
  assert.ok(deletedRefs.includes("hrseg0100"), "hrseg0100 应该被自动加入删除操作");
  assert.ok(deleteEdits.every((e) => e.as === "paragraph"), "删除方式应为整段 paragraph");
});

