import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDocx } from "./docx.ts";
import { analyzeDocument } from "./analyze.ts";
import {
  buildTemplate,
  inferTemplate,
  pruneTemplateRefs,
  remapDanglingAnchors,
  type StyleRef,
  type StampedAnchorLike,
  type TemplateFeedback,
  type TemplateInfo,
  type TemplateProfile,
  type TemplateRule,
} from "./template.ts";
import { extractJson, type ChatFn, type ChatMessage } from "./ai.ts";
import { parseDocument } from "./render.ts";
import { readAnchors } from "./stamp.ts";
import { writeRunElements } from "./edits.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

/**
 * AI 生成模板（MVP）：
 *   原始 docx → 打锚点 + 推断默认 DSL → 把样式表/锚点表喂给 AI
 *   → AI 返回 { rules, anchors, skeleton } → 校验合并 → 产出
 *     template.docx / template.json / skeleton.md
 *
 * AI 只能引用已有锚点作为样式来源，不能新建样式、不能编造 ref。
 */

/** 规范化操作：把原始 docx 清理成标准模板（例如删掉“请在此填写”之类的引导内容）。 */
export type TemplateEdit =
  | { op: "set"; ref: string; text: string; mode?: "replace" | "append" | "prepend" }
  | { op: "delete"; ref: string; as?: "run" | "paragraph" };

export interface TemplateAiResponse {
  /** 只覆盖锚点的 kind/label/tags 等元信息（style 仍由锚点自身决定）。 */
  anchors?: Record<string, { kind?: string; label?: string; tags?: string[] }>;
  /** 规范化建议：删除/清空引导与占位内容，让 docx 变成干净的模板。 */
  edits?: TemplateEdit[];
  /** markdown 结构 → 已有样式的规则。 */
  rules?: TemplateRule[];
  /** 命名格式配方。 */
  styles?: Record<string, StyleRef>;
  /** 额外 profile。 */
  profiles?: Record<string, Partial<TemplateProfile>>;
  /** JSON 字段或直接把 markdown 放这里。 */
  skeleton?: string;
  /** 缺失样式诊断或给用户的反馈建议。 */
  feedback?: TemplateFeedback;
}

export interface MergeResult {
  info: TemplateInfo;
  skeleton: string;
  /** 校验后的规范化操作。 */
  edits: TemplateEdit[];
  warnings: string[];
}

export interface BuildTemplateAiOptions {
  input: string | Buffer;
  /** 产物目录；会写入 template.docx / template.json / skeleton.md。 */
  outDir: string;
  /** 用户对文档/报告的说明，帮助 AI 判断结构。 */
  task?: string;
  chat: ChatFn;
  /** 书签前缀。 */
  anchorPrefix?: string;
  /** 只看前 N 个锚点（超大文档时避免 prompt 过长）。 */
  maxAnchors?: number;
  /** 内置 system 提示词预设（generic / labReport）。 */
  preset?: TemplateSystemPreset;
  /** 完全替换内置 system 提示词（优先级高于 preset）；传空字符串则不发送 system 消息。 */
  systemPrompt?: string;
  /** 追加到用户消息末尾的额外要求。 */
  extraInstructions?: string;
  onMessages?: (messages: ChatMessage[]) => void;
}

export interface BuildTemplateAiResult extends MergeResult {
  templatePath: string;
  infoPath: string;
  skeletonPath: string;
  /** 规范化结果。 */
  normalized: { applied: number; deleted: number };
}

/** 端到端：读 docx → AI → 落盘三件套。 */
export async function buildTemplateWithAi(options: BuildTemplateAiOptions): Promise<BuildTemplateAiResult> {
  const doc = await openDocx(options.input);
  const { info } = buildTemplate(doc, {
    prefix: options.anchorPrefix,
    source: typeof options.input === "string" ? options.input : "(buffer)",
  });

  const messages = buildTemplateAiMessages(info, {
    task: options.task,
    preset: options.preset,
    systemPrompt: options.systemPrompt,
    extraInstructions: options.extraInstructions,
    maxAnchors: options.maxAnchors,
  });
  options.onMessages?.(messages);
  const raw = await options.chat(messages);
  const merged = mergeTemplateAiResponse(raw, info);

  // 应用规范化建议：删掉引导/占位内容，得到干净模板；再按剩余书签裁剪锚点表。
  const styleIdOf = new Map<string, number | undefined>(
    Object.entries(merged.info.anchors).map(([ref, anchor]) => [ref, anchor.styleId]),
  );
  const normalized = applyNormalization(doc, merged.edits, merged.warnings);
  const remaining = new Set(readAnchors(doc, info.anchorPrefix).map((range) => range.ref));
  for (const ref of Object.keys(merged.info.anchors)) {
    if (!remaining.has(ref)) delete merged.info.anchors[ref];
  }
  merged.warnings.push(...remapDanglingAnchors(merged.info, styleIdOf));
  merged.warnings.push(...pruneTemplateRefs(merged.info));
  // 兜底：规范化后 AI 的规则可能大多失效，用剩余文档重新推断补齐基础规则。
  augmentProfileFromDoc(doc, merged.info);

  await mkdir(options.outDir, { recursive: true });
  const templatePath = path.join(options.outDir, "template.docx");
  const infoPath = path.join(options.outDir, "template.json");
  const skeletonPath = path.join(options.outDir, "skeleton.md");
  await doc.saveAs(templatePath);
  await writeFile(infoPath, JSON.stringify(merged.info, null, 2), "utf-8");
  await writeFile(skeletonPath, merged.skeleton, "utf-8");

  return { ...merged, templatePath, infoPath, skeletonPath, normalized };
}

/** 用规范化后的文档重新推断基础 rules/styles，附加到默认 profile（AI 规则优先，推断补齐）。 */
function augmentProfileFromDoc(doc: import("docx-edit").VirtualWordDocument, info: TemplateInfo): void {
  const analysis = analyzeDocument(doc);
  const stamped: StampedAnchorLike[] = Object.entries(info.anchors).map(([ref, anchor]) => ({
    ref,
    kind: anchor.kind,
    label: anchor.label ?? "",
    styleId: anchor.styleId ?? -1,
  }));
  const inferred = inferTemplate(analysis, stamped);
  const name = info.defaultProfile;
  const profile = info.profiles[name] ?? { styles: {}, rules: [] };
  info.profiles[name] = {
    ...profile,
    styles: { ...inferred.profile.styles, ...profile.styles },
    rules: [...profile.rules, ...inferred.profile.rules],
    defaults: profile.defaults ?? inferred.profile.defaults,
  };
}

/** 把规范化操作应用到文档（直接改 OOXML，不新建样式）。 */
export function applyNormalization(
  doc: import("docx-edit").VirtualWordDocument,
  edits: readonly TemplateEdit[],
  warnings: string[],
): { applied: number; deleted: number } {
  const ranges = new Map(readAnchors(doc).map((range) => [range.ref, range]));
  let applied = 0;
  let deleted = 0;

  for (const edit of edits) {
    const range = ranges.get(edit.ref);
    if (!range) {
      warnings.push(`规范化：未知锚点 ${edit.ref}，已忽略`);
      continue;
    }
    if (edit.op === "set") {
      if (range.runEls.length > 0 && writeRunElements(range.runEls, edit.text, edit.mode ?? "replace")) applied += 1;
      else warnings.push(`规范化 set 失败：${edit.ref}`);
      continue;
    }
    // delete
    if (edit.as === "paragraph") {
      const paragraphEl = range.paragraphEl as XmlElement;
      if (paragraphEl?.parentNode) {
        paragraphEl.parentNode.removeChild(paragraphEl);
        deleted += 1;
      }
      continue;
    }
    let removed = 0;
    for (const runEl of range.runEls as XmlElement[]) {
      if (runEl?.parentNode) {
        runEl.parentNode.removeChild(runEl);
        removed += 1;
      }
    }
    if (removed > 0) deleted += 1;
  }

  return { applied, deleted };
}

/** 构造给 AI 的消息。 */
export interface TemplatePromptOptions {
  task?: string;
  /** 选用内置 system 提示词预设。 */
  preset?: TemplateSystemPreset;
  /** 完全替换内置 system 提示词（优先级高于 preset）；传空字符串表示不发送 system 消息。 */
  systemPrompt?: string;
  /** 追加到用户消息末尾的额外要求。 */
  extraInstructions?: string;
  /** 只看前 N 个锚点。 */
  maxAnchors?: number;
}

/**
 * 提示词以 `prompts/*.md` 的 skill 文档形式维护（便于阅读、版本化、按文档类型扩展）。
 * 运行时读取；读不到（例如打包未带上文件）则退回精简的兜底文本。
 */
function loadPrompt(relative: string, fallback: string): string {
  try {
    return readFileSync(new URL(`../prompts/${relative}`, import.meta.url), "utf-8").trim();
  } catch {
    return fallback;
  }
}

const FALLBACK_GENERIC = `你是 Word 模板助手。阅读样式表与锚点表，输出 JSON（rules/styles/anchors/edits/skeleton）。
只能用给定的 ref，禁止新建样式；skeleton 只写需要填写或新增的内容，其余从模板原样保留。只输出 JSON。`;

const FALLBACK_LAB_REPORT = `这是实验/课程报告类文档：根据学生填写职责理解语义，清理模板。
删：所有面向写作者的指引、解题要求、说明、示范心得、占位符（×××、......）。必须在 edits 中以 op: "delete", as: "paragraph" 彻底删除，严禁留在模板中或当成 slot。
留：章节标题（作为 insert 插入点）、封面字段（作为 slot）、固定客观实验任务条目。`;

/** 文档无关的通用提示词（来自 `prompts/template.md`）。 */
export const GENERIC_TEMPLATE_SYSTEM_PROMPT = loadPrompt("template.md", FALLBACK_GENERIC);

/** 实验/课程报告专用提示词 = 通用 + `prompts/lab-report.md` 判断准则。 */
export const LAB_REPORT_TEMPLATE_SYSTEM_PROMPT =
  GENERIC_TEMPLATE_SYSTEM_PROMPT + "\n\n---\n\n" + loadPrompt("lab-report.md", FALLBACK_LAB_REPORT);

/** 预设的 system 提示词。 */
export const TEMPLATE_SYSTEM_PRESETS = {
  generic: GENERIC_TEMPLATE_SYSTEM_PROMPT,
  labReport: LAB_REPORT_TEMPLATE_SYSTEM_PROMPT,
} as const;

export type TemplateSystemPreset = keyof typeof TEMPLATE_SYSTEM_PRESETS;

/** 默认沿用实验报告策略（本仓库主要场景）。 */
export const DEFAULT_TEMPLATE_SYSTEM_PROMPT = LAB_REPORT_TEMPLATE_SYSTEM_PROMPT;

/** 构造用户消息主体（样式表 + 锚点表 + 批注 + 示例）。 */
export function buildTemplateContext(info: TemplateInfo, options: TemplatePromptOptions = {}): string {
  let styleTable = "";
  if (info.styleSchema && info.styleSchema.length > 0) {
    styleTable = info.styleSchema
      .map((s) => {
        const ex = s.examples.length > 0 ? ` 样例=${JSON.stringify(s.examples.join("; "))}` : "";
        const refStr = s.anchorRef ? ` (样本锚点: ${s.anchorRef})` : "";
        return `- [styleId=${s.styleId}]${refStr}: ${s.summary}${ex}`;
      })
      .join("\n");
  } else {
    const styleLines = Object.entries(info.anchors)
      .map(([, anchor]) => anchor.styleId)
      .filter((styleId): styleId is number => styleId !== undefined);
    const styleIds = [...new Set(styleLines)].sort((a, b) => a - b);
    styleTable = styleIds.map((id) => `styleId=${id}`).join("\n");
  }

  let commentsSection = "";
  if (info.comments && info.comments.length > 0) {
    const commentLines = info.comments.map((c) => {
      const authorStr = c.author ? ` (${c.author})` : "";
      const refStr = c.paragraphRef ? ` -> 关联锚点: ${c.paragraphRef}` : "";
      const targetStr = c.paragraphText ? ` [段落: "${c.paragraphText}"]` : "";
      return `- 批注${c.id}${authorStr}: "${c.text}"${refStr}${targetStr}`;
    });
    commentsSection = `文档批注与排版要求（来自教师/原作者，至关重要）：\n${commentLines.join("\n")}`;
  }

  let anchors = Object.entries(info.anchors).map(([ref, anchor]) => {
    let label = anchor.label ?? "";
    const pText = anchor.paragraphText;
    if (pText && pText.trim() !== label.trim()) {
      label = `${label} (段落全文: ${JSON.stringify(pText.trim().slice(0, 70))})`;
    }
    return {
      ref,
      kind: anchor.kind,
      styleId: anchor.styleId,
      label,
    };
  });
  if (options.maxAnchors && anchors.length > options.maxAnchors) anchors = anchors.slice(0, options.maxAnchors);
  const anchorTable = anchors
    .map((anchor) => `${anchor.ref}\tstyle=${anchor.styleId}\t${anchor.kind}\t${JSON.stringify(anchor.label)}`)
    .join("\n");

  const schemaHint = `示例（注意：
1. 核心是理解学生要在文档内填写什么：
   - 封面：原地填空 slot（统一加 padding=cover 保证等宽对齐）；
   - 正文各章节：insert 插入点（如 ## 1.1 程序改错与跟踪调试 {ref:hrseg0070}），学生在章节标题下方撰写正文、插入代码块与图表；
2. 彻底清理引导内容：面向写作者的作答指引、解题要求、说明提示、示范占位符（××××、......）必须在 edits 中以 op: "delete", as: "paragraph" 彻底删除，绝不留在 template.docx 中或当成 slot；
3. 严禁凭空发明样式！如果批注/规范中需要某种格式（如代码块、图标题等），但在已检测样式列表中找不到样本锚点，必须在 feedback.missingStyles 中指出；
4. 支持图片与表格规则配置）：
{
  "rules": [
    {"match":{"type":"heading","level":1},"style":{"anchor":"hrseg0007"}},
    {"match":{"type":"paragraph"},"style":{"recipe":"body"}},
    {"match":{"type":"code"},"style":{"anchor":"hrseg0042"},"lint":true},
    {"match":{"type":"image"},"options":{"captionRef":"hrseg0094","align":"center","size":"max"}},
    {"match":{"type":"table"},"options":{"theme":"academic","header":true}}
  ],
  "styles": {"body": {"anchor": "hrseg0012"}},
  "anchors": {
    "hrseg0003": {"kind":"slot","label":"学号"},
    "hrseg0070": {"kind":"insert","label":"1.1 程序改错与跟踪调试"}
  },
  "feedback": {
    "missingStyles": [
      {
        "name": "代码块",
        "requirement": "等宽代码字体",
        "instruction": "原文档中未发现代码块排版样式。请在 Word 模板文档末尾另起一行写入 'int main() { return 0; }' 并设为 Consolas 等宽字体，保存后重新生成模板。"
      }
    ]
  },
  "edits": [
    {"op":"delete","ref":"hrseg0046","as":"paragraph"},
    {"op":"delete","ref":"hrseg0048","as":"paragraph"}
  ],
  "skeleton": "---\\nprofile: default\\n---\\n\\n[计算机科学与技术学院](ref:hrseg0017 | padding=cover)\\n[网络空间安全2401班](ref:hrseg0019 | padding=cover)\\n[U202412345](ref:hrseg0021 | padding=cover)\\n[张三](ref:hrseg0023 | padding=cover)\\n[李老师](ref:hrseg0025 | padding=cover)\\n\\n## 1.1 程序改错与跟踪调试 {ref:hrseg0070}\\n\\n(在此记录改错与调试过程与结果)\\n\\n## 1.4 小结 {ref:hrseg0099}\\n\\n(在此填写心得体会)\\n"
}`;

  return [
    options.task ? `用户说明：${options.task}` : "",
    commentsSection,
    `已检测到的文档样式列表（styleId 仅是编号，样式来源必须用锚点引用）：\n${styleTable}`,
    `锚点表（ref / 样式 / 类型 / 示例文本）：\n${anchorTable}`,
    schemaHint,
    options.extraInstructions ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 构造给 AI 的消息。第二个参数可以是 task 字符串，或完整选项对象。
 * 传入 `systemPrompt` 时**完全替换**内置提示词（不会叠加）；传空字符串则不发送 system 消息。
 */
export function buildTemplateAiMessages(info: TemplateInfo, options: string | TemplatePromptOptions = {}): ChatMessage[] {
  const opts: TemplatePromptOptions = typeof options === "string" ? { task: options } : options;
  const systemPrompt =
    opts.systemPrompt !== undefined
      ? opts.systemPrompt
      : opts.preset
        ? TEMPLATE_SYSTEM_PRESETS[opts.preset]
        : DEFAULT_TEMPLATE_SYSTEM_PROMPT;
  const user = buildTemplateContext(info, opts);
  return systemPrompt ? [{ role: "system", content: systemPrompt }, { role: "user", content: user }] : [{ role: "user", content: user }];
}

/** 解析 AI 返回的 JSON/文本，校验后合并进 TemplateInfo。 */
export function mergeTemplateAiResponse(text: string, info: TemplateInfo): MergeResult {
  const warnings: string[] = [];
  const parsed = extractJson<TemplateAiResponse>(text);

  const next: TemplateInfo = {
    ...info,
    anchors: { ...info.anchors },
    profiles: { ...info.profiles },
  };

  if (parsed?.feedback) {
    next.feedback = parsed.feedback;
  }

  let skeleton = info.profiles[info.defaultProfile]?.extensions?.skeleton as string | undefined;
  if (typeof parsed?.skeleton === "string") skeleton = parsed.skeleton;
  if (!parsed) warnings.push("AI 返回不是可解析的 JSON，已保留原模板");
  if (!skeleton) skeleton = "";

  // 锚点元信息（保留原 style/styleId）
  if (parsed?.anchors) {
    for (const [ref, patch] of Object.entries(parsed.anchors)) {
      const anchor = next.anchors[ref];
      if (!anchor) {
        warnings.push(`AI 引用了不存在的锚点 ${ref}，已忽略`);
        continue;
      }
      if (patch.kind === "slot" || patch.kind === "insert") anchor.kind = patch.kind;
      if (typeof patch.label === "string") anchor.label = patch.label;
      if (Array.isArray(patch.tags)) anchor.tags = patch.tags;
    }
  }

  // 规则校验
  const validRules = (parsed?.rules ?? []).filter((rule) => {
    if (!rule?.match?.type) {
      warnings.push("丢弃一条缺少 match.type 的规则");
      return false;
    }
    const ref = rule.style && "anchor" in rule.style ? rule.style.anchor : undefined;
    if (ref && !next.anchors[ref]) {
      warnings.push(`规则引用了不存在的锚点 ${ref}，已丢弃`);
      return false;
    }
    return true;
  });

  const defaultProfile = next.profiles[next.defaultProfile] ?? { styles: {}, rules: [] };
  const mergedStyles = { ...defaultProfile.styles, ...(parsed?.styles ?? {}) };
  const profile: TemplateProfile = {
    ...defaultProfile,
    styles: mergedStyles,
    rules: validRules.length > 0 ? validRules : defaultProfile.rules,
  };
  next.profiles[next.defaultProfile] = profile;
  for (const [name, partial] of Object.entries(parsed?.profiles ?? {})) {
    next.profiles[name] = { ...next.profiles[name], ...partial, styles: { ...(next.profiles[name]?.styles ?? {}), ...(partial.styles ?? {}) }, rules: partial.rules ?? next.profiles[name]?.rules ?? [] };
  }

  // skeleton 里的 ref 校验
  if (skeleton) {
    const parsedDoc = parseDocument(skeleton);
    const used = new Set<string>([
      ...parsedDoc.fills.map((fill) => fill.ref),
      ...parsedDoc.blocks.map((block) => block.ref).filter((ref): ref is string => Boolean(ref)),
    ]);
    for (const ref of used) {
      if (!next.anchors[ref]) warnings.push(`skeleton 引用了不存在的锚点 ${ref}`);
    }
  } else {
    warnings.push("AI 未给出 skeleton，已产出空填字稿");
  }

  // 规范化操作校验
  const validEdits: TemplateEdit[] = [];
  for (const edit of parsed?.edits ?? []) {
    if (!edit || (edit.op !== "set" && edit.op !== "delete") || !edit.ref) {
      warnings.push("丢弃一条非法的规范化操作");
      continue;
    }
    if (!next.anchors[edit.ref]) {
      warnings.push(`规范化引用了不存在的锚点 ${edit.ref}，已忽略`);
      continue;
    }
    validEdits.push(edit);
  }

  // 兜底安全性保障：通过纯文本语义分析，清理遗漏的面向写作者的引导语/说明/占位符
  const deletedRefs = new Set(validEdits.filter((e) => e.op === "delete").map((e) => e.ref));
  for (const [ref, anchor] of Object.entries(next.anchors)) {
    if (deletedRefs.has(ref)) continue;
    // 保护：封面字段、目录等结构绝不误删
    if (anchor.tags?.includes("cover") || isCoverLabel(anchor.label ?? "")) continue;
    const textToCheck = anchor.paragraphText ?? anchor.label ?? "";
    if (isInstructionalText(textToCheck)) {
      validEdits.push({ op: "delete", ref, as: "paragraph" });
      deletedRefs.add(ref);
      warnings.push(`自动清理未在 edits 中声明删除的引导/占位段落: ${ref} ("${textToCheck.slice(0, 30)}")`);
    }
  }

  return { info: next, skeleton, edits: validEdits, warnings };
}

/** 判断是否属于封面字段 */
export function isCoverLabel(text: string): boolean {
  return /(专业班级|学号|姓名|指导教师|报告日期|课程名称|院系|学院|班级|学生姓名|教师|专业|学年|学期)/.test(text);
}

/**
 * 基于纯文本语义判断段落是否属于面向写作者的引导语、排版提示、解题指引或示范占位符。
 * 核心是理解语义与受众：此类内容是给写作者看的指导，不应属于最终报告正文，更不应残留在空白模板中。
 */
export function isInstructionalText(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;

  // 1. 纯占位符 / 示例省略号（如 ××××、......、[2]...... 等）
  if (/^[×xX*._—\-]{3,}$/.test(text)) return true;
  if (/^[×\s,，.。(（)）同\d]{4,}$/.test(text)) return true;
  if (/^\[\d+\]\s*(\.{3,}|…{2,}|等|同上)/.test(text)) return true;
  if (/^(\.{4,}|…{2,}|……)/.test(text)) return true;
  if (/^[A-Za-z0-9\s]*[×]{3,}[A-Za-z0-9\s×,，.。(（)）同\d]*$/.test(text)) return true;

  // 2. 指令性标头与面向写作者的提示说明
  if (/^(注意|要求|提示|排版要求|排版规范|说明|注|温馨提示|填报说明|撰写说明|注意事项|示例|例如|样例|参考样例|模版说明)[：:\s]/.test(text)) {
    return true;
  }

  // 3. 针对写作者的写作/填报/清理动词短语
  if (/(请将所有.*删除|否则扣分|此处删除|请删除|提交时删除|打印时删除)/.test(text)) return true;
  if (/(仅为排版.*模板|仅供参考|本文仅为排版|文字请替换为实际内容|替换为实际内容)/.test(text)) return true;
  if (/请(在此|按|将|根据|参考|务必|在下|在后|自行).*(填写|写入|记录|删除|替换|撰写|补充|粘贴|输入|修改)/.test(text)) return true;

  // 4. 实验报告中面向学生的具体作答与解题指引
  if (/^对于(程序改错|程序完善|程序设计|修改替换|跟踪调试|实验任务|设计题|本实验|本题|每道题)/.test(text)) return true;
  if (/(指出有错的代码行|分析错误原因|给出改正方案|截图给出题目要求|各观察点的有关变量的值|代码补充完整|设计替换方案)/.test(text)) return true;
  if (/(分析解题思路|给出算法步骤|给出程序源代码|注意编码的规范性|关键位置注释|主要变量和函数的命名|全文要求至少.*个流程图|给出运行截图说明答案的正确性)/.test(text)) return true;

  // 5. 心得、小结、总结指导建议
  if (/(可以写通过本次实验|学到了什么知识|有哪些提高|又有哪些不足|调试程序过程中遇到|有什么体会|写出.*体会|总结.*收获|谈谈.*收获|从以下几个方面进行总结)/.test(text)) return true;

  // 6. 括号内的排版/作答提示
  if (/^[（(].*(省略号代表|每道题都要写|重在设计思路|先分析表达式|图号按章编|同\s*[\d.]+|仅为排版|格式同文献|字数不少于|单倍行距|5号宋体).*[）)]$/.test(text)) return true;
  if (/(省略号代表后续题目|每道题都要写|重在设计思路、解题方法的文字描述)/.test(text)) return true;

  // 7. 编号条目式的排版要求说明
  if (/^\d+、(按照|请将|节后面|本文仅|报告要求|严禁|不得)/.test(text)) return true;

  // 8. 示例配图与说明
  if (/(示例流程图|参考流程图|程序设计题\d*的流程图)/.test(text)) return true;

  return false;
}
