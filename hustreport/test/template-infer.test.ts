import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferTemplate,
  looksLikeCaption,
  pruneTemplateRefs,
  remapDanglingAnchors,
  TEMPLATE_KIND,
  TEMPLATE_VERSION,
  type TemplateInfo,
} from "../src/template.ts";
import { collectSkeletonRefs, validateSkeletonRefs } from "../src/template-ai.ts";
import type { DocumentAnalysis, StyleEntry, StyleSnapshot } from "../src/types.ts";

function snap(partial: Partial<StyleSnapshot>): StyleSnapshot {
  return {
    ooxmlStyleId: partial.ooxmlStyleId ?? null,
    direct: partial.direct ?? {},
    effective: partial.effective ?? {},
    headingLevel: partial.headingLevel ?? null,
  };
}

interface StyleSpec {
  paragraph: Partial<StyleSnapshot>;
  run: Partial<StyleSnapshot>;
  segmentCount: number;
  examples?: string[];
}

function makeAnalysis(specs: StyleSpec[]): DocumentAnalysis {
  const styles: StyleEntry[] = specs.map((spec, id) => ({
    id,
    key: `key${id}`,
    paragraph: snap(spec.paragraph),
    run: snap(spec.run),
    segmentCount: spec.segmentCount,
    examples: spec.examples ?? [],
    firstSegmentIndex: 0,
    summary: `style${id}`,
  }));
  return {
    segments: [],
    styles,
    media: [],
    meta: { segmentCount: 0, styleCount: styles.length, charCount: 0, partParagraphCounts: {} },
  };
}

test("inferTemplate：按标题级别/正文/代码推断规则与配方（全部用锚点引用）", () => {
  const analysis = makeAnalysis([
    {
      paragraph: { ooxmlStyleId: "Heading1", headingLevel: 1, effective: { styleId: "Heading1", alignment: "center" } },
      run: { effective: { fontSize: "32", bold: true, fontFamily: { eastAsia: "黑体" } } },
      segmentCount: 2,
      examples: ["实验一"],
    },
    {
      paragraph: { effective: {} },
      run: { effective: { fontSize: "24", fontFamily: { eastAsia: "宋体" } } },
      segmentCount: 5,
      examples: ["正文段落"],
    },
    {
      paragraph: { effective: {} },
      run: { effective: { fontFamily: { ascii: "Consolas", eastAsia: "仿宋" } } },
      segmentCount: 1,
    },
  ]);

  const anchors = [
    { ref: "hrseg0001", kind: "insert" as const, label: "标题", styleId: 0 },
    { ref: "hrseg0002", kind: "slot" as const, label: "正文", styleId: 1 },
    { ref: "hrseg0003", kind: "insert" as const, label: "代码", styleId: 2 },
  ];

  const { profile, anchors: anchorInfos } = inferTemplate(analysis, anchors);

  assert.deepEqual(profile.styles.body, { anchor: "hrseg0002" });
  assert.deepEqual(profile.styles.code, { anchor: "hrseg0003" });
  assert.deepEqual(profile.defaults?.style, { anchor: "hrseg0002" });

  const ruleTypes = profile.rules.map((rule) => rule.match.type);
  assert.deepEqual(ruleTypes, ["heading", "paragraph", "code"]);
  assert.deepEqual(profile.rules[0], { match: { type: "heading", level: 1 }, style: { anchor: "hrseg0001" } });

  // 锚点元信息齐全，且 style 指回自身
  assert.equal(Object.keys(anchorInfos).length, 3);
  assert.deepEqual(anchorInfos.hrseg0001.style, { anchor: "hrseg0001" });
  assert.equal(anchorInfos.hrseg0001.kind, "insert");
});

test("remapDanglingAnchors：把指向已删除锚点的样式改绑到同样式的存活锚点", () => {  const info: TemplateInfo = {
    version: TEMPLATE_VERSION,
    kind: TEMPLATE_KIND,
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    anchors: {
      hrseg0002: { kind: "insert", styleId: 1, style: { anchor: "hrseg0002" } },
    },
    defaultProfile: "default",
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" } },
        rules: [{ match: { type: "paragraph" }, style: { anchor: "hrseg0001" } }],
      },
    },
  };

  const warnings = remapDanglingAnchors(info, new Map<string, number | undefined>([["hrseg0001", 1]]));
  assert.deepEqual(info.profiles.default.styles.body, { anchor: "hrseg0002" });
  assert.deepEqual(info.profiles.default.rules[0].style, { anchor: "hrseg0002" });
  assert.ok(warnings.some((warning) => warning.includes("hrseg0001") && warning.includes("hrseg0002")));
});

test("pruneTemplateRefs：清理指向已删除锚点的配方与规则", () => {
  const info: TemplateInfo = {
    version: TEMPLATE_VERSION,
    kind: TEMPLATE_KIND,
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    anchors: { hrseg0001: { kind: "insert" } },
    defaultProfile: "default",
    profiles: {
      default: {
        styles: { gone: { anchor: "hrseg9999" }, body: { anchor: "hrseg0001" } },
        rules: [
          { match: { type: "paragraph" }, style: { recipe: "gone" } },
          { match: { type: "heading" }, style: { anchor: "hrseg9999" } },
          { match: { type: "code" } },
        ],
      },
    },
  };

  const warnings = pruneTemplateRefs(info);
  assert.deepEqual(info.profiles.default.styles, { body: { anchor: "hrseg0001" } });
  assert.equal(info.profiles.default.rules.length, 1);
  assert.equal(info.profiles.default.rules[0].match.type, "code");
  assert.equal(warnings.length, 3);
});

test("collectSkeletonRefs / validateSkeletonRefs：收集并校验骨架锚点", () => {
  const skeleton = [
    "[张三](ref:hrseg0001)",
    "[重复](ref:hrseg0001)",
    "# 章节 {ref:hrseg0002}",
    "正文 [链接](ref:hrseg9999)",
  ].join("\n");

  assert.deepEqual(collectSkeletonRefs(skeleton).sort(), ["hrseg0001", "hrseg0002", "hrseg9999"]);

  const info: TemplateInfo = {
    version: TEMPLATE_VERSION,
    kind: TEMPLATE_KIND,
    meta: { source: "t.docx", createdAt: "now", generator: "test" },
    anchorPrefix: "hrseg",
    anchors: {
      hrseg0001: { kind: "slot" },
      hrseg0002: { kind: "insert" },
    },
    defaultProfile: "default",
    profiles: { default: { styles: {}, rules: [] } },
  };

  const warnings = validateSkeletonRefs(skeleton, info);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hrseg9999/);
});

test("looksLikeCaption：识别常见图注/表注写法", () => {
  assert.equal(looksLikeCaption("图 3-1 系统结构图"), true);
  assert.equal(looksLikeCaption("表2 模块说明"), true);
  assert.equal(looksLikeCaption("Figure 1 Overview"), true);
  assert.equal(looksLikeCaption("Table 3-2 Results"), true);
  assert.equal(looksLikeCaption("这是一段正文"), false);
  assert.equal(looksLikeCaption(""), false);
});

test("inferTemplate：识别图注样式并生成可选 caption 配方与规则", () => {
  const analysis = makeAnalysis([
    {
      paragraph: { ooxmlStyleId: "Heading1", headingLevel: 1, effective: { styleId: "Heading1" } },
      run: { effective: { fontSize: "32", bold: true } },
      segmentCount: 2,
    },
    {
      paragraph: { effective: {} },
      run: { effective: { fontSize: "24" } },
      segmentCount: 5,
    },
    {
      paragraph: { effective: {} },
      run: { effective: { fontFamily: { ascii: "Consolas" } } },
      segmentCount: 1,
    },
    {
      paragraph: { effective: { alignment: "center" } },
      run: { effective: { fontSize: "21", fontFamily: { eastAsia: "黑体" } } },
      segmentCount: 3,
      examples: ["图 1-1 系统结构图"],
    },
  ]);

  const anchors = [
    { ref: "hrseg0001", kind: "insert" as const, label: "标题", styleId: 0 },
    { ref: "hrseg0002", kind: "slot" as const, label: "正文", styleId: 1 },
    { ref: "hrseg0003", kind: "insert" as const, label: "代码", styleId: 2 },
    { ref: "hrseg0004", kind: "insert" as const, label: "图注", styleId: 3 },
  ];

  const { profile } = inferTemplate(analysis, anchors);
  assert.deepEqual(profile.styles.caption, { anchor: "hrseg0004" });
  const captionRule = profile.rules.find((rule) => rule.match.type === "caption");
  assert.ok(captionRule);
  assert.deepEqual(captionRule?.style, { anchor: "hrseg0004" });
});
