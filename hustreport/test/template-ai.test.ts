import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplateAiMessages, ensureJsonResponse, mergeTemplateAiResponse } from "../src/template-ai.ts";
import type { ChatMessage } from "../src/ai.ts";
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

test("mergeTemplateAiResponse: 正确验证并接收 AI 声明的 edits 操作", () => {
  const info = fakeInfo();
  info.anchors["hrseg0002"] = { kind: "insert", label: "标题", styleId: 0 };
  info.anchors["hrseg0003"] = { kind: "insert", label: "引导说明", styleId: 0 };

  const aiOutput = JSON.stringify({
    rules: [{ match: { type: "paragraph" }, style: { anchor: "hrseg0001" } }],
    edits: [
      { op: "delete", ref: "hrseg0003", as: "paragraph" },
      { op: "delete", ref: "nonexistent_anchor", as: "paragraph" },
      { op: "invalid_op", ref: "hrseg0002" },
    ],
    skeleton: "---\nprofile: default\n---\n[计算机](ref:hrseg0001 | padding=cover)\n",
  });

  const merged = mergeTemplateAiResponse(aiOutput, info);
  assert.equal(merged.edits.length, 1);
  const firstEdit = merged.edits[0];
  assert.equal(firstEdit?.op, "delete");
  assert.equal((firstEdit as any)?.ref, "hrseg0003");
  assert.ok(merged.warnings.some((w) => w.includes("nonexistent_anchor")));
  assert.ok(merged.warnings.some((w) => w.includes("非法")));
});

test("ensureJsonResponse：首轮非 JSON 时自动发起修复回合", async () => {
  const calls: ChatMessage[][] = [];
  const chat = async (messages: ChatMessage[]) => {
    calls.push(messages);
    return calls.length === 1 ? "抱歉，我不明白你的意思。" : '{"skeleton":"ok"}';
  };

  const raw = await ensureJsonResponse(chat, [{ role: "user", content: "生成模板" }]);
  assert.equal(calls.length, 2);
  assert.equal(raw, '{"skeleton":"ok"}');
  // 第二回合的末尾应是一条要求只输出 JSON 的修复指令
  const lastMessage = calls[1][calls[1].length - 1];
  assert.equal(lastMessage.role, "user");
  assert.match(lastMessage.content, /JSON/);
});

test("ensureJsonResponse：首轮即合法 JSON 时不重试", async () => {
  let count = 0;
  const chat = async () => {
    count += 1;
    return '```json\n{"a":1}\n```';
  };
  const raw = await ensureJsonResponse(chat, [{ role: "user", content: "x" }]);
  assert.equal(count, 1);
  assert.match(raw, /"a":1/);
});


