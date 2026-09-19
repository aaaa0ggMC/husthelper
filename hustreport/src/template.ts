import type { VirtualWordDocument } from "docx-edit";
import { analyzeDocument } from "./analyze.ts";
import { openDocx } from "./docx.ts";
import { stampAnchors, type StampOptions, type StampedAnchor } from "./stamp.ts";
import type { DocumentAnalysis, Segment, StyleObject } from "./types.ts";
import { extractDocumentComments, stripDocumentComments, type DocumentComment } from "./comments.ts";
import { describeFontSize, summarizeStylePair } from "./util.ts";
import { collectTables, type TableStyleInfo } from "./table-style.ts";

/**
 * 模板 DSL（`hustreport/template`）。
 *
 * 目标：把「markdown 结构 → 已有样式」的映射做成可扩展、可版本化、自包含的规则表，
 * 全部复用文档已有样式，不新建 `styles.xml` 条目。
 */

export const TEMPLATE_KIND = "hustreport/template";
export const TEMPLATE_VERSION = 2;

/**
 * 样式引用。优先级建议：anchor > recipe > styleName/ooxmlStyleId > inline。
 * - `anchor`：直接复用模板里某个锚点内容的样式（最稳，模板自包含）；
 * - `recipe`：引用 `styles` 里的命名配方；
 * - `styleName` / `ooxmlStyleId`：按命名样式 / `w:pStyle`·`w:rStyle` 匹配；
 * - `inline`：直接给出 `w:pPr` / `w:rPr` 直接格式（不产生命名样式）。
 */
export type StyleRef =
  | { anchor: string }
  | { recipe: string }
  | { styleName: string }
  | { ooxmlStyleId: string }
  | { inline: { paragraph?: StyleObject; run?: StyleObject } };

export type AnchorKind = "slot" | "insert" | "section" | "table" | "image";

/** 样式角色（启发式猜测，供 AI 参考；缺失时 AI 可自行省略或给默认值）。 */
export type StyleRole = "heading" | "caption" | "code" | "body";

export interface AnchorInfo {
  kind: AnchorKind;
  /** 便于人/AI 理解的标签。 */
  label?: string;
  /** 示例值（md 骨架里可作默认内容）。 */
  example?: string;
  /** 该锚点内容的样式；null 表示“就用自己的样式”。 */
  style?: StyleRef | null;
  /** 生成时该 segment 的 XML Style ID（仅供人/AI 参考，非身份）。 */
  styleId?: number;
  tags?: string[];
  paragraphText?: string;
  part?: string;
  paragraph?: number;
  /** 该锚点是否位于表格单元格内。 */
  inTable?: boolean;
  /** 所属表格的稳定 id（tbl1、tbl2…）。 */
  tableRef?: string;
  /** 前向兼容：未知能力放这里，渲染器忽略但保留。 */
  extensions?: Record<string, unknown>;
}

export type MarkdownNodeType =
  | "heading"
  | "paragraph"
  | "code"
  | "inlineCode"
  | "table"
  | "list"
  | "quote"
  | "image"
  | "caption"
  | "link"
  | "thematicBreak"
  | "*";

export interface TemplateMatcher {
  type: MarkdownNodeType;
  /** heading 级别。 */
  level?: number;
  /** code fence 语言。 */
  lang?: string;
  /** 只作用于某个锚点。 */
  ref?: string;
  /** 扩展条件：如 { suffix: "。" }，渲染器未知则忽略并告警。 */
  when?: Record<string, unknown>;
}

export interface TemplateRule {
  /** 命中的 markdown 节点。 */
  match: TemplateMatcher;
  style?: StyleRef;
  /** 套用段落样式 / run 样式 / 两者。默认 both。 */
  use?: "paragraph" | "run" | "both";
  /** 构造选项，如表格 { header: true }、代码 { wrap: false }。 */
  options?: Record<string, unknown>;
  /** 代码高亮模板名称（如 "default", "classic", "eclipse", "dark"），不确定时填 "" 回退到 CLI/config.json。 */
  theme?: string;
  /** 代码块是否启用语法着色（Token 区分高亮）。若为 true 则在保留原文档样式基础上做语法着色。 */
  lint?: boolean;
}

export interface TemplateDefaults {
  style?: StyleRef;
  use?: "paragraph" | "run" | "both";
  options?: Record<string, unknown>;
}

/**
 * 一套“样式配方”。一篇文章可挂多套（学校官方版 / 精简版 / 个人版…），
 * 锚点共享，md 里可按块或按文档选 profile。
 */
export interface TemplateProfile {
  label?: string;
  /** 继承另一个 profile：先套用父级，再被本层覆盖。 */
  extends?: string;
  /** 命名格式配方，供规则用 `{ recipe }` 引用。 */
  styles: Record<string, StyleRef>;
  /** 有序规则，first-match-wins（本层规则优先于继承来的）。 */
  rules: TemplateRule[];
  defaults?: TemplateDefaults;
  /** 前向兼容命名空间。 */
  extensions?: Record<string, unknown>;
}

export interface TemplateInfo {
  version: typeof TEMPLATE_VERSION;
  kind: typeof TEMPLATE_KIND;
  meta: { source: string; createdAt: string; generator: string; [key: string]: unknown };
  anchorPrefix: string;
  /** 锚点表，key 为书签名，也是 md 里引用的 ref。 */
  anchors: Record<string, AnchorInfo>;
  /** 默认 profile 名。 */
  defaultProfile: string;
  /** 多套样式配方。 */
  profiles: Record<string, TemplateProfile>;
  /** 模板级变量（可在骨架里以 {{var}} 使用，渲染器按需扩展）。 */
  variables?: Record<string, unknown>;
  /** 原文档中提取的批注列表（来自教师或原作者）。 */
  comments?: DocumentComment[];
  /** 是否清理文档中的批注标记与部件（默认为 true）。若为 false 则保留批注。 */
  stripComments?: boolean;
  /** 文档已检测到的样式 Schema 表。 */
  styleSchema?: StyleSchemaEntry[];
  /** 文档中每张表格的样式摘要（key 为 tbl1、tbl2…）。 */
  tables?: Record<string, TableStyleInfo>;
  /** AI 或系统对模板的反馈（如缺少的样式指导）。 */
  feedback?: TemplateFeedback;
  /** 目录（TOC）配置。 */
  toc?: TemplateTocConfig;
  /** 前向兼容命名空间。 */
  extensions?: Record<string, unknown>;
}

export interface TemplateTocLevelConfig {
  pStyle?: string;
  sampleRef?: string;
  style?: StyleRef;
}

export interface TemplateTocConfig {
  enabled: boolean;
  type?: "sdt" | "field" | "manual";
  maxLevel?: number;
  instr?: string;
  levels?: Record<string, TemplateTocLevelConfig>;
}

export interface MissingStyleFeedback {
  name: string;
  requirement?: string;
  instruction: string;
}

export interface TemplateFeedback {
  missingStyles?: MissingStyleFeedback[];
  notes?: string;
}

export interface StyleSchemaEntry {
  styleId: number;
  summary: string;
  anchorRef?: string;
  examples: string[];
  /** 启发式角色（供 AI 快速定位正文/标题/代码/图注样式）。 */
  role?: StyleRole;
  paragraphDirect?: StyleObject;
  runDirect?: StyleObject;
  ooxmlStyleId?: string;
  fontCn?: string;
  fontAscii?: string;
  fontSize?: string;
  bold?: boolean;
  color?: string;
  alignment?: string;
  lineSpacing?: string;
  indent?: string;
}

/** `inferTemplate` 需要的锚点信息子集（从 TemplateInfo.anchors 就能重建）。 */
export interface StampedAnchorLike {
  ref: string;
  kind: AnchorKind;
  label: string;
  styleId: number;
  paragraphText?: string;
  part?: string;
  paragraph?: number;
  /** 该锚点是否位于表格单元格内。 */
  inTable?: boolean;
  /** 所属表格的稳定 id（tbl1、tbl2…）。 */
  tableRef?: string;
}

export interface BuildTemplateOptions extends StampOptions {
  filter?: (segment: Segment) => boolean;
  /** 追加到默认 profile 的规则。 */
  rules?: TemplateRule[];
  /** 追加/覆盖默认 profile 的配方。 */
  styles?: Record<string, StyleRef>;
  /** 额外 profile（多套模板）。 */
  profiles?: Record<string, Partial<TemplateProfile>>;
  /** 默认 profile 名，默认 `default`。 */
  defaultProfile?: string;
  meta?: Record<string, unknown>;
  source?: string;
  /** 是否清理模板中的批注（默认为 true）。 */
  stripComments?: boolean;
}

export interface TemplateBundle {
  info: TemplateInfo;
  anchors: StampedAnchor[];
}

/** 在文档上生成模板：注入持久锚点 + 推断一套默认 DSL。调用方自行保存 `template.docx`。 */
export function buildTemplate(doc: VirtualWordDocument, options: BuildTemplateOptions = {}): TemplateBundle {
  const analysis = analyzeDocument(doc);
  const anchors = stampAnchors(doc, { prefix: options.prefix, filter: options.filter });

  const inferred = inferTemplate(analysis, anchors);
  const defaultName = options.defaultProfile ?? "default";
  const defaultProfile: TemplateProfile = {
    ...inferred.profile,
    styles: { ...inferred.profile.styles, ...options.styles },
    rules: [...(options.rules ?? []), ...inferred.profile.rules],
  };

  const profiles: Record<string, TemplateProfile> = { [defaultName]: defaultProfile };
  for (const [name, partial] of Object.entries(options.profiles ?? {})) {
    profiles[name] = normalizeProfile(partial);
  }

  const comments = extractDocumentComments(doc, options.prefix ?? "hrseg");
  const toc = detectDocumentToc(doc);
  const tables: Record<string, TableStyleInfo> = {};
  for (const table of collectTables(doc)) tables[table.id] = table.style;
  // 依据 segment 文本（而非样式样例）判定哪些样式用于图注/表注，避免共用样式时漏判。
  const captionStyleIds = new Set(
    analysis.segments.filter((segment) => looksLikeCaption(segment.text)).map((segment) => segment.styleId),
  );
  const styleSchema: StyleSchemaEntry[] = analysis.styles.map((style) => {
    const summary = summarizeStylePair(style.paragraph, style.run);
    const anchor = anchors.find((a) => a.styleId === style.id);
    const ooxml = style.paragraph.ooxmlStyleId ?? style.run.ooxmlStyleId ?? undefined;
    const runFontFamily = style.run.effective.fontFamily as Record<string, string> | undefined;
    const fontCn = runFontFamily?.eastAsia ?? runFontFamily?.eastAsiaTheme ?? undefined;
    const fontAscii =
      runFontFamily?.ascii ??
      runFontFamily?.asciiTheme ??
      runFontFamily?.hAnsi ??
      runFontFamily?.hAnsiTheme ??
      undefined;
    const fontSize = describeFontSize(style.run.effective.fontSize) ?? undefined;
    const bold = Boolean(style.run.effective.bold);
    const color = style.run.effective.color ? `#${style.run.effective.color}` : undefined;
    const alignment = (style.paragraph.effective.alignment as string) ?? undefined;
    const spacing = style.paragraph.effective.spacing as Record<string, unknown> | undefined;
    const lineSpacing = spacing?.line ? String(spacing.line) : undefined;
    const indent = style.paragraph.effective.indent ? JSON.stringify(style.paragraph.effective.indent) : undefined;

    const role: StyleRole | undefined = style.paragraph.headingLevel
      ? "heading"
      : looksLikeCode(style.run.effective) || looksLikeCode(style.run.direct)
        ? "code"
        : captionStyleIds.has(style.id) ||
            style.examples.some(looksLikeCaption) ||
            /caption|题注|图注|表注|图题|表题|图标题|表标题/i.test(`${ooxml ?? ""} ${summary}`)
          ? "caption"
          : undefined;

    return {
      styleId: style.id,
      summary,
      role,
      anchorRef: anchor?.ref,
      examples: style.examples.slice(0, 2),
      paragraphDirect: style.paragraph.direct,
      runDirect: style.run.direct,
      ooxmlStyleId: ooxml,
      fontCn,
      fontAscii,
      fontSize,
      bold,
      color,
      alignment,
      lineSpacing,
      indent,
    };
  });

  const info: TemplateInfo = {
    version: TEMPLATE_VERSION,
    kind: TEMPLATE_KIND,
    meta: {
      source: options.source ?? "(unknown)",
      createdAt: new Date().toISOString(),
      generator: "hustreport/template",
      ...options.meta,
    },
    anchorPrefix: options.prefix ?? "hrseg",
    anchors: inferred.anchors,
    defaultProfile: defaultName,
    profiles,
    comments: comments.length > 0 ? comments : undefined,
    styleSchema: styleSchema.length > 0 ? styleSchema : undefined,
    tables: Object.keys(tables).length > 0 ? tables : undefined,
    toc,
  };

  return { info, anchors };
}

/** 检测 Word 文档中的目录（TOC）结构与层级样式。 */
export function detectDocumentToc(doc: VirtualWordDocument): TemplateTocConfig | undefined {
  const parts = (doc as unknown as { partsData?: Array<{ xmlDocument?: any }> }).partsData;
  const root = parts?.[0]?.xmlDocument?.documentElement;
  if (!root) return undefined;

  // 1. 标准 Word 结构化文档标签 SDT 目录
  const sdts = Array.from(root.getElementsByTagName("w:sdt") ?? []) as any[];
  for (const sdt of sdts) {
    const gallery = sdt.getElementsByTagName("w:docPartGallery")?.[0]?.getAttribute("w:val");
    if (gallery === "Table of Contents") {
      let maxLevel = 2;
      let instr = 'TOC \\o "1-2" \\h \\u ';
      const instrEl = sdt.getElementsByTagName("w:instrText")?.[0];
      if (instrEl) {
        const text = instrEl.textContent?.trim() ?? "";
        if (text) {
          instr = text;
          const m = text.match(/\\o\s+"(\d+)-(\d+)"/);
          if (m) maxLevel = parseInt(m[2], 10);
        }
      }
      const levels: Record<string, TemplateTocLevelConfig> = {};
      const ps = Array.from(sdt.getElementsByTagName("w:p") ?? []) as any[];
      for (const p of ps) {
        const pStyle = p.getElementsByTagName("w:pStyle")?.[0]?.getAttribute("w:val");
        if (pStyle) {
          const mLevel = pStyle.match(/TOC\s*(\d+)/i) || pStyle.match(/(\d+)/);
          const lvl = mLevel ? mLevel[1] : String(Object.keys(levels).length + 1);
          if (!levels[lvl]) {
            levels[lvl] = { pStyle };
          }
        }
      }
      return {
        enabled: true,
        type: "sdt",
        maxLevel,
        instr,
        levels: Object.keys(levels).length > 0 ? levels : { "1": { pStyle: "TOC1" }, "2": { pStyle: "TOC2" } },
      };
    }
  }

  // 2. 字段式 TOC（无 SDT 包裹）
  const instrs = Array.from(root.getElementsByTagName("w:instrText") ?? []) as any[];
  for (const instrEl of instrs) {
    const text = instrEl.textContent ?? "";
    if (/^\s*TOC\b/.test(text)) {
      let maxLevel = 2;
      const m = text.match(/\\o\s+"(\d+)-(\d+)"/);
      if (m) maxLevel = parseInt(m[2], 10);
      return {
        enabled: true,
        type: "field",
        maxLevel,
        instr: text.trim(),
      };
    }
  }

  // 3. 手工目录（“目录”标题下带有制表符和页码的连续段落）
  const ps = Array.from(root.getElementsByTagName("w:p") ?? []) as any[];
  for (let i = 0; i < ps.length; i++) {
    const text = ps[i].textContent?.trim() ?? "";
    if (/^(目\s*录|TABLE\s+OF\s+CONTENTS)$/i.test(text)) {
      let count = 0;
      let j = i + 1;
      const levels: Record<string, TemplateTocLevelConfig> = {};
      while (j < ps.length && j < i + 35) {
        const p = ps[j];
        const pText = p.textContent?.trim() ?? "";
        if (!pText) {
          j++;
          continue;
        }
        const hasTab = p.getElementsByTagName("w:tab").length > 0;
        const endsWithPage = /\d+$/.test(pText) || /[IVXLCDMivxlcdm]+$/.test(pText);
        if (hasTab && endsWithPage) {
          count++;
          const pStyle = p.getElementsByTagName("w:pStyle")?.[0]?.getAttribute("w:val");
          const m = pText.match(/^(\d+(?:\.\d+)*)/);
          let lvl = "1";
          if (m) {
            lvl = String(m[1].split(".").length);
          }
          if (!levels[lvl] && pStyle) {
            levels[lvl] = { pStyle };
          }
          j++;
        } else {
          break;
        }
      }
      if (count >= 3) {
        return {
          enabled: true,
          type: "manual",
          maxLevel: Math.max(...Object.keys(levels).map(Number), 2),
          levels: Object.keys(levels).length > 0 ? levels : undefined,
        };
      }
    }
  }

  return undefined;
}

/** 解析某个 profile（含 `extends` 继承链），返回可直接喂渲染器的合并结果。 */
export function resolveProfile(info: TemplateInfo, name?: string): TemplateProfile {
  const profile = info.profiles[name ?? info.defaultProfile] ?? info.profiles[info.defaultProfile];
  if (!profile) return { styles: {}, rules: [] };
  if (!profile.extends) return normalizeProfile(profile);

  const base = resolveProfile(info, profile.extends);
  return {
    label: profile.label ?? base.label,
    styles: { ...base.styles, ...profile.styles },
    // 本层规则优先，其后才是继承来的
    rules: [...profile.rules, ...base.rules],
    defaults: profile.defaults ?? base.defaults,
    extensions: { ...base.extensions, ...profile.extensions },
  };
}

/** 列出所有 profile 名。 */
export function listProfiles(info: TemplateInfo): string[] {
  return Object.keys(info.profiles);
}

/**
 * 锚点被规范化删除后，把指向它的 StyleRef 重映射到“同样式、仍存在”的锚点。
 * `styleIdOf` 是删除前的 ref → styleId 记录。返回告警列表。
 */
export function remapDanglingAnchors(info: TemplateInfo, styleIdOf: ReadonlyMap<string, number | undefined>): string[] {
  const remainingByStyle = new Map<number, string>();
  for (const [ref, anchor] of Object.entries(info.anchors)) {
    if (anchor.styleId !== undefined && !remainingByStyle.has(anchor.styleId)) remainingByStyle.set(anchor.styleId, ref);
  }

  const warnings: string[] = [];
  const fix = (ref: StyleRef): StyleRef => {
    if (!("anchor" in ref) || info.anchors[ref.anchor]) return ref;
    const styleId = styleIdOf.get(ref.anchor);
    const alternative = styleId !== undefined ? remainingByStyle.get(styleId) : undefined;
    if (alternative) {
      warnings.push(`样式锚点 ${ref.anchor} 已删除，改用同样式锚点 ${alternative}`);
      return { anchor: alternative };
    }
    if (styleId !== undefined && info.styleSchema) {
      const entry = info.styleSchema.find((s) => s.styleId === styleId);
      const hasDirectFormatting =
        entry?.paragraphDirect &&
        (entry.paragraphDirect.spacing !== undefined ||
          entry.paragraphDirect.indent !== undefined ||
          entry.paragraphDirect.alignment !== undefined);
      if (hasDirectFormatting || entry?.runDirect) {
        warnings.push(`样式锚点 ${ref.anchor} 已删除且无替代锚点，保留其直接格式降级为行内格式配置`);
        return { inline: { paragraph: entry.paragraphDirect, run: entry.runDirect } };
      }
      if (entry?.ooxmlStyleId) {
        warnings.push(`样式锚点 ${ref.anchor} 已删除且无替代锚点，降级为样式 ID: ${entry.ooxmlStyleId}`);
        return { ooxmlStyleId: entry.ooxmlStyleId };
      }
    }
    return ref;
  };

  for (const profile of Object.values(info.profiles)) {
    if (profile.defaults?.style) profile.defaults.style = fix(profile.defaults.style);
    for (const [key, ref] of Object.entries(profile.styles ?? {})) profile.styles[key] = fix(ref);
    for (const rule of profile.rules ?? []) {
      if (rule.style) rule.style = fix(rule.style);
    }
  }
  return warnings;
}

/**
 * 清理悬空引用：锚点被删除后，指向它的 style recipe / rule 一并移除。
 * 返回告警列表。
 */
export function pruneTemplateRefs(info: TemplateInfo): string[] {
  const warnings: string[] = [];
  const anchorExists = (ref: StyleRef): boolean => {
    if ("anchor" in ref) return Boolean(info.anchors[ref.anchor]);
    return true;
  };

  for (const [name, profile] of Object.entries(info.profiles)) {
    const styles: Record<string, StyleRef> = {};
    for (const [key, ref] of Object.entries(profile.styles ?? {})) {
      if (anchorExists(ref)) styles[key] = ref;
      else warnings.push(`profile ${name} 的配方 ${key} 指向已删除锚点，已移除`);
    }

    const rules = (profile.rules ?? []).filter((rule) => {
      if (!rule.style) return true;
      if ("anchor" in rule.style && !info.anchors[rule.style.anchor]) {
        warnings.push(`profile ${name} 的规则 ${rule.match.type} 指向已删除锚点 ${rule.style.anchor}，已移除`);
        return false;
      }
      if ("recipe" in rule.style && !styles[rule.style.recipe]) {
        warnings.push(`profile ${name} 的规则 ${rule.match.type} 引用了已失效配方 ${rule.style.recipe}，已移除`);
        return false;
      }
      return true;
    });

    info.profiles[name] = { ...profile, styles, rules };
  }

  return warnings;
}

function normalizeProfile(partial: Partial<TemplateProfile>): TemplateProfile {
  return {
    label: partial.label,
    extends: partial.extends,
    styles: partial.styles ?? {},
    rules: partial.rules ?? [],
    defaults: partial.defaults,
    extensions: partial.extensions,
  };
}

/** 读取 docx → 生成 template.docx + template.json。 */
export async function createTemplate(
  input: string | Buffer,
  templatePath: string,
  infoPath: string,
  options: BuildTemplateOptions = {},
): Promise<TemplateInfo> {
  const doc = await openDocx(input);
  const { info } = buildTemplate(doc, {
    ...options,
    source: options.source ?? (typeof input === "string" ? input : "(buffer)"),
  });
  const shouldStrip = options.stripComments ?? info.stripComments ?? true;
  if (shouldStrip) {
    await stripDocumentComments(doc);
  }
  await doc.saveAs(templatePath);
  const fs = await import("node:fs/promises");
  await fs.writeFile(infoPath, JSON.stringify(info, null, 2), "utf-8");
  return info;
}

/** 判断一个对象是不是本系统的模板。 */
export function isTemplateInfo(value: unknown): value is TemplateInfo {
  return Boolean(value) && typeof value === "object" && (value as TemplateInfo).kind === TEMPLATE_KIND;
}

/**
 * 根据分析结果 + 已打锚点，推断一套默认 DSL（启发式，可在 options 里覆盖）。
 * 样式优先用 `{ anchor }` 引用，保证模板自包含、不依赖数字 id。
 */
export function inferTemplate(
  analysis: DocumentAnalysis,
  anchors: readonly StampedAnchorLike[],
): { anchors: Record<string, AnchorInfo>; profile: TemplateProfile } {
  const anchorByStyleId = new Map<number, StampedAnchorLike>();
  for (const anchor of anchors) {
    if (anchor.styleId !== undefined && !anchorByStyleId.has(anchor.styleId)) anchorByStyleId.set(anchor.styleId, anchor);
  }
  const refFor = (styleId: number): StyleRef | null => {
    const anchor = anchorByStyleId.get(styleId);
    if (anchor) return { anchor: anchor.ref };
    const entry = analysis.styles.find((style) => style.id === styleId);
    const ooxml = entry?.paragraph.ooxmlStyleId ?? entry?.run.ooxmlStyleId;
    if (ooxml) return { ooxmlStyleId: ooxml };
    if (entry) return { inline: { paragraph: entry.paragraph.direct, run: entry.run.direct } };
    return null;
  };

  // 命名配方
  const styles: Record<string, StyleRef> = {};
  const nonHeading = analysis.styles
    .filter((style) => !style.paragraph.headingLevel)
    .sort((a, b) => b.segmentCount - a.segmentCount);
  const bodyRef = nonHeading[0] ? refFor(nonHeading[0].id) : null;
  if (bodyRef) styles.body = bodyRef;

  const codeStyle = analysis.styles.find(
    (style) =>
      looksLikeCode(style.run.effective) ||
      looksLikeCode(style.run.direct) ||
      /code|mono|代码/i.test(style.run.ooxmlStyleId ?? "") ||
      /code|mono|代码/i.test(style.paragraph.ooxmlStyleId ?? ""),
  );
  const codeRef = codeStyle ? refFor(codeStyle.id) : null;
  if (codeRef) styles.code = codeRef;

  // 图注 / 表注样式（可选；文档未提供则跳过，渲染器会用默认）
  const captionStyleIds = new Set(
    analysis.segments.filter((segment) => looksLikeCaption(segment.text)).map((segment) => segment.styleId),
  );
  const captionStyle =
    analysis.styles.find(
      (style) =>
        !style.paragraph.headingLevel &&
        style.id !== nonHeading[0]?.id &&
        (captionStyleIds.has(style.id) || style.examples.some(looksLikeCaption)),
    ) ??
    analysis.styles.find(
      (style) =>
        style.id !== nonHeading[0]?.id &&
        /caption|题注|图注|表注|图题|表题|图标题|表标题/i.test(
          `${style.paragraph.ooxmlStyleId ?? ""} ${style.run.ooxmlStyleId ?? ""}`,
        ),
    );
  const captionRef = captionStyle ? refFor(captionStyle.id) : null;
  if (captionRef) styles.caption = captionRef;

  // 规则
  const rules: TemplateRule[] = [];
  const headingByLevel = new Map<number, StyleRef>();
  for (const style of analysis.styles) {
    const level = style.paragraph.headingLevel;
    if (!level || headingByLevel.has(level)) continue;
    const ref = refFor(style.id);
    if (ref) headingByLevel.set(level, ref);
  }
  for (const [level, ref] of [...headingByLevel.entries()].sort((a, b) => a[0] - b[0])) {
    rules.push({ match: { type: "heading", level }, style: ref });
  }
  if (bodyRef) rules.push({ match: { type: "paragraph" }, style: bodyRef });
  if (codeRef) rules.push({ match: { type: "code" }, style: codeRef });
  if (captionRef) rules.push({ match: { type: "caption" }, style: captionRef });

  // 锚点
  const anchorInfos: Record<string, AnchorInfo> = {};
  for (const anchor of anchors) {
    anchorInfos[anchor.ref] = {
      kind: anchor.kind,
      label: anchor.label,
      example: anchor.kind === "slot" ? anchor.label : undefined,
      styleId: anchor.styleId,
      style: { anchor: anchor.ref },
      paragraphText: anchor.paragraphText,
      part: anchor.part,
      paragraph: anchor.paragraph,
      inTable: anchor.inTable,
      tableRef: anchor.tableRef,
    };
  }

  // 没有大纲级别时，给候选让 AI/人挑
  const bodySize = halfPoints(nonHeading[0]?.run.effective.fontSize);
  const headingCandidates = analysis.styles
    .filter((style) => style.id !== nonHeading[0]?.id && style.run.effective.bold)
    .map((style) => ({ id: style.id, size: halfPoints(style.run.effective.fontSize) }))
    .filter((entry) => entry.size >= Math.max(bodySize + 4, 28))
    .sort((a, b) => b.size - a.size)
    .map((entry) => refFor(entry.id))
    .filter((ref): ref is StyleRef => Boolean(ref));

  return {
    anchors: anchorInfos,
    profile: {
      label: "自动推断",
      styles,
      rules,
      defaults: bodyRef ? { style: bodyRef, use: "both" } : undefined,
      extensions: headingCandidates.length > 0 ? { headingCandidates } : undefined,
    },
  };
}

function looksLikeCode(style: StyleObject): boolean {
  const fontFamily = style.fontFamily as Record<string, unknown> | undefined;
  if (!fontFamily) return false;
  return Object.values(fontFamily).some((value) => typeof value === "string" && /mono|consolas|courier|menlo|monaco|fira/i.test(value));
}

/** 启发式判断一段文本是否像图注 / 表注（如「图 3-1 …」「表2 …」「Figure 1 …」）。 */
export function looksLikeCaption(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(图|表)\s*[\d一二三四五六七八九十]/u.test(trimmed)) return true;
  if (/^(figure|table)\s*\d/i.test(trimmed)) return true;
  return false;
}

function halfPoints(value: unknown): number {
  const size = Number(value);
  return Number.isFinite(size) ? size : 0;
}
