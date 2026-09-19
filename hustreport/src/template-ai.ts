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
  type TemplateTocConfig,
} from "./template.ts";
import { extractJson, type ChatFn, type ChatMessage } from "./ai.ts";
import { parseDocument } from "./render.ts";
import { readAnchors } from "./stamp.ts";
import { writeRunElements } from "./edits.ts";
import { stripCommentElements, stripCommentElementsById, stripDocumentComments } from "./comments.ts";
import { childElementsOf, WORD_NS } from "./ooxml.ts";
import { summarizeTableStyle } from "./table-style.ts";

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
  | { op: "delete"; ref: string; as?: "run" | "paragraph" }
  | { op: "delete"; target: "comment"; id: string }
  | { op: "delete"; target: "comments" }
  /** 删除整张表格：ref 可以是表内任意锚点。 */
  | { op: "delete"; target: "table"; ref: string };

export interface TemplateAiResponse {
  /** 只覆盖锚点的 kind/label/tags 等元信息（style 仍由锚点自身决定）。 */
  anchors?: Record<string, { kind?: string; label?: string; tags?: string[] }>;
  /** 规范化建议：删除/清空引导与占位内容，让 docx 变成干净的模板。 */
  edits?: TemplateEdit[];
  /** 是否清理文档中的指导性批注（默认 true）。 */
  stripComments?: boolean;
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
  /** 目录（TOC）配置。 */
  toc?: Partial<TemplateTocConfig>;
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
  /** 是否清理模板中的批注（默认优先尊重 AI 判断 merged.info.stripComments，未指定时默认为 true）。 */
  stripComments?: boolean;
  onMessages?: (messages: ChatMessage[]) => void;
}

export interface BuildTemplateAiResult extends MergeResult {
  templatePath: string;
  infoPath: string;
  skeletonPath: string;
  /** 规范化结果。 */
  normalized: { applied: number; deleted: number };
}

/** 请求模型输出 JSON；若首轮无法解析，则追加一个「修复回合」再试一次。 */
export async function ensureJsonResponse(chat: ChatFn, messages: ChatMessage[]): Promise<string> {
  const raw = await chat(messages);
  if (extractJson(raw) !== null) return raw;
  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: raw.slice(0, 6000) },
    {
      role: "user",
      content:
        "你上一次的输出不是合法 JSON，无法被程序解析。请重新输出：只输出一个 JSON 对象本身，" +
        "不要任何解释文字、不要 Markdown 代码围栏，字段与要求与上一条消息完全一致。",
    },
  ];
  return chat(repairMessages);
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
  const raw = await ensureJsonResponse(options.chat, messages);
  const merged = mergeTemplateAiResponse(raw, info);

  // 应用规范化建议：删掉引导/占位内容，得到干净模板；再按剩余书签裁剪锚点表。
  const styleIdOf = new Map<string, number | undefined>(
    Object.entries(merged.info.anchors).map(([ref, anchor]) => [ref, anchor.styleId]),
  );
  const normalized = applyNormalization(doc, merged.edits, merged.warnings);
  const remaining = new Set(readAnchors(doc, info.anchorPrefix).map((range) => range.ref));
  const deletedRefs: string[] = [];
  for (const ref of Object.keys(merged.info.anchors)) {
    if (!remaining.has(ref)) {
      delete merged.info.anchors[ref];
      deletedRefs.push(ref);
    }
  }
  // 无损性兜底：AI 的删除决策可能把 skeleton 里还要用的槽位/章节锚点删掉，
  // 渲染时会静默跳过。这里显式告警，提示人工复核。
  if (deletedRefs.length > 0) {
    const deleted = new Set(deletedRefs);
    for (const ref of collectSkeletonRefs(merged.skeleton)) {
      if (deleted.has(ref)) {
        merged.warnings.push(`skeleton 引用的锚点 ${ref} 在规范化删除后已不存在，渲染会被跳过，请复核 AI 的 edits`);
      }
    }
  }
  merged.warnings.push(...remapDanglingAnchors(merged.info, styleIdOf));
  merged.warnings.push(...pruneTemplateRefs(merged.info));
  // 同步清理已被删空的表格样式条目，避免 template.json 里残留失效的 tblN 引用。
  if (merged.info.tables) {
    const usedTableRefs = new Set(
      Object.values(merged.info.anchors)
        .map((anchor) => anchor.tableRef)
        .filter((ref): ref is string => Boolean(ref)),
    );
    for (const id of Object.keys(merged.info.tables)) {
      if (!usedTableRefs.has(id)) delete merged.info.tables[id];
    }
    if (Object.keys(merged.info.tables).length === 0) delete merged.info.tables;
  }
  // 兜底：规范化后 AI 的规则可能大多失效，用剩余文档重新推断补齐基础规则。
  augmentProfileFromDoc(doc, merged.info);

  await mkdir(options.outDir, { recursive: true });
  const templatePath = path.join(options.outDir, "template.docx");
  const infoPath = path.join(options.outDir, "template.json");
  const skeletonPath = path.join(options.outDir, "skeleton.md");
  const shouldStrip = options.stripComments ?? merged.info.stripComments ?? true;
  if (shouldStrip) {
    await stripDocumentComments(doc);
  }
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
    inTable: anchor.inTable,
    tableRef: anchor.tableRef,
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
  // 被编辑触及的表格：若编辑后整表已无任何文本，说明 AI 想清掉它，连同空框架一并移除。
  const touchedTables = new Set<XmlElement>();

  const findTable = (element: XmlElement | null | undefined): XmlElement | null => {
    let node: XmlElement = element?.parentNode ?? null;
    while (node) {
      if (node.nodeName === "w:tbl") return node;
      if (node.nodeName === "w:body" || node.nodeName === "#document") return null;
      node = node.parentNode;
    }
    return null;
  };
  const tableHasText = (table: XmlElement): boolean => (table.textContent ?? "").replace(/\s+/g, "").length > 0;
  /** 删除单元格内段落时，若该单元格已无段落，补一个空段落，保证 OOXML 结构合法。 */
  const ensureCellParagraph = (cell: XmlElement | null): void => {
    if (!cell || cell.nodeName !== "w:tc") return;
    const hasParagraph = childElementsOf(cell).some((child) => child.nodeName === "w:p");
    if (!hasParagraph) {
      cell.appendChild(cell.ownerDocument.createElementNS(WORD_NS, "w:p"));
    }
  };

  for (const edit of edits) {
    if (edit.op === "delete" && "target" in edit) {
      if (edit.target === "comment") {
        const id = edit.id;
        if (id !== undefined) {
          if (stripCommentElementsById(doc, String(id))) {
            deleted += 1;
          } else {
            warnings.push(`规范化：未找到批注 id=${id}，已忽略`);
          }
        }
      } else if (edit.target === "comments") {
        const count = stripCommentElements(doc);
        if (count > 0) deleted += count;
      } else if (edit.target === "table") {
        const range = ranges.get(edit.ref);
        const table = range ? findTable(range.paragraphEl) : null;
        if (table?.parentNode) {
          table.parentNode.removeChild(table);
          deleted += 1;
        } else {
          warnings.push(`规范化：锚点 ${edit.ref} 不在表格内，无法删除整表，已忽略`);
        }
      }
      continue;
    }

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
      const table = findTable(paragraphEl);
      if (table) touchedTables.add(table);
      const parent = paragraphEl?.parentNode as XmlElement | null;
      if (parent) {
        parent.removeChild(paragraphEl);
        deleted += 1;
        ensureCellParagraph(parent);
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

  // 兜底：被删空的示范 / 占位表格，连同空框架一并移除，避免模板残留无内容空表。
  for (const table of touchedTables) {
    if (table.parentNode && !tableHasText(table)) {
      table.parentNode.removeChild(table);
      deleted += 1;
      warnings.push("规范化：表格内容已全部删除，已连同空表格框架一并移除");
    }
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
        const details: string[] = [];
        if (s.ooxmlStyleId) details.push(`pStyle=${s.ooxmlStyleId}`);
        if (s.fontCn || s.fontAscii) details.push(`字体=${[s.fontCn && `中:${s.fontCn}`, s.fontAscii && `西:${s.fontAscii}`].filter(Boolean).join("/")}`);
        if (s.fontSize) details.push(`字号=${s.fontSize}`);
        if (s.bold) details.push("加粗");
        if (s.color) details.push(`颜色=${s.color}`);
        if (s.alignment) details.push(`对齐=${s.alignment}`);
        if (s.lineSpacing) details.push(`行距=${s.lineSpacing}`);
        if (s.indent) details.push(`缩进=${s.indent}`);
        const detailStr = details.length > 0 ? ` [${details.join(", ")}]` : "";
        const ex = s.examples.length > 0 ? ` 样例=${JSON.stringify(s.examples.join("; "))}` : "";
        const refStr = s.anchorRef ? ` (样本锚点: ${s.anchorRef})` : "";
        const roleStr = s.role ? ` role=${s.role}` : "";
        return `- [styleId=${s.styleId}]${refStr}${roleStr}${detailStr}: ${s.summary}${ex}`;
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

  let tocSection = "";
  if (info.toc?.enabled) {
    const levelEntries = Object.entries(info.toc.levels ?? {})
      .map(([lvl, cfg]) => `  - Level ${lvl} 目录项: 样式 ID=${cfg.pStyle ?? "TOC" + lvl}`)
      .join("\n");
    tocSection =
      `检测到的目录（TOC）信息：\n` +
      `- 存在形式: ${info.toc.type ?? "sdt"}，默认最大深度: 1-${info.toc.maxLevel ?? 2} 级\n` +
      (levelEntries ? `${levelEntries}\n` : "") +
      `可在 JSON 返回中通过 "toc": { "enabled": true, "maxLevel": 2 } 声明或调整目录设置。`;
  }

  let tablesSection = "";
  if (info.tables && Object.keys(info.tables).length > 0) {
    const lines = Object.entries(info.tables).map(([id, style]) => `- ${id}: ${summarizeTableStyle(style)}`);
    tablesSection =
      `文档中已存在的表格样式（可直接识别并在渲染时复用）：\n${lines.join("\n")}\n` +
      `若希望渲染的新表格沿用它，可在对应 table 规则里写 "options": { "styleAnchor": "<该表内任一锚点 ref>" }，` +
      `引擎会克隆该表的表属性/列宽/边框与单元格格式；也可以只用 "options": { "theme": "academic" } 使用内置主题。`;
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
      inTable: Boolean(anchor.inTable),
      tableRef: anchor.tableRef,
    };
  });
  if (options.maxAnchors && anchors.length > options.maxAnchors) anchors = anchors.slice(0, options.maxAnchors);
  const anchorTable = anchors
    .map((anchor) => {
      const tableTag = anchor.inTable ? `\t[表格内${anchor.tableRef ? ` ${anchor.tableRef}` : ""}]` : "";
      return `${anchor.ref}\tstyle=${anchor.styleId}\t${anchor.kind}${tableTag}\t${JSON.stringify(anchor.label)}`;
    })
    .join("\n");

  const schemaHint = `示例（注意：
1. 核心是理解学生要在文档内填写什么：
   - 封面：原地填空 slot（统一加 padding=cover 保证等宽对齐）；
   - 正文各章节：insert 插入点（如 ## 1.1 程序改错与跟踪调试 {ref:hrseg0070}），学生在章节标题下方撰写正文、插入代码块与图表；
2. 彻底清理引导内容与批注：面向写作者的作答指引、解题要求、说明提示（如『正文：宋体小4号，1.5倍行距』）、示范占位符（××××、......）必须在 edits 中以 op: "delete", as: "paragraph" 彻底删除，绝不留在 template.docx 中或当成 slot；
   若这些示范/占位内容位于**表格**内（锚点行标注了 [表格内]），删光单元格后残留的空表格会很难看：请对整张表输出 {"op":"delete","target":"table","ref":"<表内任一锚点>"} 直接删除整表；
3. 区分批注/指导文字与正文样式：原文档中红色文字（如 #FF0000）或文字本身是排版说明的，属于提示文字而非正文样式，绝不能把红色的提示段落作为正文 body 样式！正文必须是黑色、小四号、1.5倍行距、首行缩进；
4. 样式组装与反馈：若文档缺少规范样式，可以输出 inline: { paragraph: {...}, run: {...} } 自行组装，或者在 feedback.missingStyles 中指导用户；
5. 支持图片与表格规则配置）：
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
    {"op":"delete","ref":"hrseg0048","as":"paragraph"},
    {"op":"delete","target":"table","ref":"表格内任一锚点"}
  ],
  "skeleton": "---\\nprofile: default\\n---\\n\\n[计算机科学与技术学院](ref:hrseg0017 | padding=cover)\\n[网络空间安全2401班](ref:hrseg0019 | padding=cover)\\n[U202412345](ref:hrseg0021 | padding=cover)\\n[张三](ref:hrseg0023 | padding=cover)\\n[李老师](ref:hrseg0025 | padding=cover)\\n\\n## 1.1 程序改错与跟踪调试 {ref:hrseg0070}\\n\\n(在此记录改错与调试过程与结果)\\n\\n## 1.4 小结 {ref:hrseg0099}\\n\\n(在此填写心得体会)\\n"
}`;

  const standardSchemaSection = `标准 Word 排版 Schema 速查（缺样式或原样式错乱时，用 inline 精准拼装）：
- 字号对应 fontSize (半磅): 小初=72(36pt), 二号=44(22pt), 小二=36(18pt,章标题), 四号=28(14pt,节标题), 小四=24(12pt,标准正文), 五号=21(10.5pt,图表/代码)
- 行距对应 spacing: 1.5倍行距={line: 360, lineRule: "auto"}, 单倍行距={line: 240, lineRule: "auto"}, 标题0.5行间距={before: 156, after: 156, line: 360, lineRule: "auto"}
- 缩进对应 indent: 小四首行缩进2字符={firstLine: 480}, 五号首行缩进2字符={firstLine: 420}, 无缩进={firstLine: 0}
- 字体 fontFamily: 正文={eastAsia: "宋体", ascii: "Times New Roman"}, 标题={eastAsia: "黑体", ascii: "Times New Roman"}, 代码={ascii: "Consolas", eastAsia: "仿宋"}`;

  return [
    options.task ? `用户说明：${options.task}` : "",
    commentsSection,
    tocSection,
    tablesSection,
    `已检测到的文档样式列表（styleId 仅是编号，样式来源必须用锚点引用）：\n${styleTable}`,
    `锚点表（ref / 样式 / 类型 / 示例文本）：\n${anchorTable}`,
    standardSchemaSection,
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

/** 收集 fill.md / skeleton.md 中引用到的所有锚点 ref（去重，保序）。 */
export function collectSkeletonRefs(skeleton: string): string[] {
  const parsedDoc = parseDocument(skeleton);
  return [
    ...new Set<string>([
      ...parsedDoc.fills.map((fill) => fill.ref),
      ...parsedDoc.blocks.map((block) => block.ref).filter((ref): ref is string => Boolean(ref)),
    ]),
  ];
}

/** 校验 skeleton 引用的锚点是否都存在于模板里，返回告警列表。 */
export function validateSkeletonRefs(skeleton: string, info: TemplateInfo): string[] {
  const warnings: string[] = [];
  for (const ref of collectSkeletonRefs(skeleton)) {
    if (!info.anchors[ref]) warnings.push(`skeleton 引用了不存在的锚点 ${ref}`);
  }
  return warnings;
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
    warnings.push(...validateSkeletonRefs(skeleton, next));
  } else {
    warnings.push("AI 未给出 skeleton，已产出空填字稿");
  }

  // 规范化操作校验
  const validEdits: TemplateEdit[] = [];
  for (const edit of parsed?.edits ?? []) {
    if (!edit || (edit.op !== "set" && edit.op !== "delete")) {
      warnings.push("丢弃一条非法的规范化操作");
      continue;
    }
    const anyEdit = edit as any;
    if (anyEdit.target === "comment" || anyEdit.target === "comments") {
      if (edit.op === "delete") {
        validEdits.push(edit);
      } else {
        warnings.push(`批注操作仅支持 delete，已忽略`);
      }
      continue;
    }
    if (!("ref" in edit) || !edit.ref) {
      warnings.push("丢弃一条缺少 ref 的规范化操作");
      continue;
    }
    if (!next.anchors[edit.ref]) {
      warnings.push(`规范化引用了不存在的锚点 ${edit.ref}，已忽略`);
      continue;
    }
    validEdits.push(edit);
  }

  // TOC 目录配置
  if (parsed?.toc && typeof parsed.toc === "object") {
    next.toc = {
      ...(next.toc ?? { enabled: true }),
      ...parsed.toc,
    };
  }

  // 批注清理配置
  if (typeof parsed?.stripComments === "boolean") {
    next.stripComments = parsed.stripComments;
  }

  return { info: next, skeleton, edits: validEdits, warnings };
}

/** 判断是否属于封面字段 */
export function isCoverLabel(text: string): boolean {
  return /(专业班级|学号|姓名|指导教师|报告日期|课程名称|院系|学院|班级|学生姓名|教师|专业|学年|学期)/.test(text);
}

