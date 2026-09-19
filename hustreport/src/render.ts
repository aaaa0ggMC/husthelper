import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { VirtualWordDocument } from "docx-edit";
import { openDocx } from "./docx.ts";
import {
  cloneRunWithText,
  createParagraphFromStyles,
  replaceRunStyle,
  writeRunElements,
  type InlineRun,
} from "./edits.ts";
import type { StyleObject } from "./types.ts";
import { readAnchors, stripAnchors, type BookmarkRange } from "./stamp.ts";
import { resolveProfile, type StyleRef, type TemplateInfo, type TemplateProfile, type TemplateRule } from "./template.ts";
import { highlightCode } from "./highlight.ts";
import { loadCodeThemeSync, parseFontSizeToHalfPoints, type CodeTokenStyle } from "./code-theme.ts";
import {
  resolveReportConfigSync,
  type CodeBlockConfig,
  type ImageBlockConfig,
  type ReportConfig,
  type TableBlockConfig,
} from "./config.ts";
import { calculateImageEmuSize, getImageDimensions } from "./image-size.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

/**
 * 渲染器。
 */

export interface RenderFill {
  ref: string;
  text: string;
  /** 该填字生效的 profile（块级 > 章节级 > 文档级；没有则 undefined）。 */
  profile?: string;
  /**
   * 指定填充后的样式（recipe 名或锚点 id），覆盖锚点 run 的原有格式。
   * 写法：`[文字](ref:锚点 | use:body)`。
   */
  use?: string;
  /**
   * 对齐分组名（不是长度）。同一 padding 组的所有填字会补齐到组内最宽文本的显示宽度。
   * 写法：`[文字](ref:锚点 | padding=0)`。
   */
  padding?: string;
  /** 组内对齐方式，默认 left。 */
  align?: "left" | "center" | "right";
}

export type BlockType = "heading" | "paragraph" | "code" | "list" | "quote" | "table" | "hr" | "image";

export interface ListItem {
  text: string;
  /** 嵌套层级，0 为顶层。 */
  level: number;
  ordered: boolean;
  /** 任务列表：true/false 表示勾选；非任务列表为 undefined。 */
  checked?: boolean;
}

export interface MarkdownBlock {
  type: BlockType;
  text: string;
  level?: number;
  lang?: string;
  ordered?: boolean;
  items?: ListItem[];
  rows?: string[][];
  alignments?: Array<"left" | "center" | "right">;
  /** 插入锚点。 */
  ref?: string;
  profile?: string;
  position?: "before" | "after";
  /** 指定代码块高亮或表格主题。 */
  theme?: string;
  /** 图片专属：路径。 */
  src?: string;
  /** 图片专属：底下显示的文字（图注）。 */
  caption?: string;
  /** 块级解析出的属性（如 align, size, width, height, header 等）。 */
  attrs?: Record<string, string>;
  extra?: string;
  /** 纯文本正文段落（跳过 Markdown 行内解析，如由纯文本代码块生成）。 */
  rawRuns?: InlineRun[];
}

export interface ParsedDocument {
  profile?: string;
  blocks: MarkdownBlock[];
  fills: RenderFill[];
}

export interface RenderOptions {
  profile?: string;
  strip?: boolean;
  decodeEntities?: boolean;
  /** 是否做结构化插入（默认 true）。 */
  structured?: boolean;
  /** 没有 ref 也没有前置锚点的块是否追加到文末（默认 false：跳过并告警，避免重复内容）。 */
  appendUnanchored?: boolean;
  /** 代码高亮模板名称或 CSS 文件路径（默认 "default"）。 */
  codeTemplate?: string;
  /** 代码块详细定制配置（支持 fontFamily, fontSize, lineNumbers, tabSize 等）。 */
  codeConfig?: CodeBlockConfig;
  /** 是否显示代码行号（默认 true）。 */
  showLineNumbers?: boolean;
  /** 配置文件路径（--config）。 */
  configFile?: string;
  /** 覆盖配置项（--extra，支持 JSON 或 key=val）。 */
  extra?: string;
  /** 图片排版配置。 */
  imageConfig?: ImageBlockConfig;
  /** 表格排版配置。 */
  tableConfig?: TableBlockConfig;
  /** Markdown 文件所在目录（用于相对路径查找图片）。 */
  markdownDir?: string;
  /** 全局合并后的配置对象。 */
  config?: ReportConfig;
}

export interface RenderResult {
  profile: string;
  filled: number;
  inserted: number;
  warnings: string[];
  fills: RenderFill[];
  blocks: MarkdownBlock[];
}

const REF_PATTERN = /\[([^\]]*)\]\(\s*ref\s*:\s*([^)\s|]+)([^)]*)\)/g;
const FILL_ONLY = /^\s*(\[[^\]]*\]\(\s*ref\s*:\s*[^)]+\)\s*)+$/;
/** 段落里只要出现 ref 链接，就按“填空”处理，不再重复插入该段落。 */
const HAS_REF_LINK = /\[[^\]]*\]\(\s*ref\s*:/;

const PURE_TEXT_LANGS = new Set([
  "text",
  "plain",
  "plaintext",
  "txt",
  "raw",
  "pure",
  "none",
]);

/**
 * 启发式检测一段文本是否具备典型编程代码或脚本特征。
 */
export function looksLikeProgrammingCode(text: string): boolean {
  // 1. 预处理与导入
  if (/^\s*(?:#\s*(?:include|define|ifdef|ifndef|pragma)|(?:from\s+[\w.]+\s+)?import\s+[\w*{]|package\s+[\w.]+|using\s+namespace|export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)|use\s+[\w:]+;)/m.test(text)) {
    return true;
  }
  // 2. 类/接口/结构体/命名空间定义
  if (/\b(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+)*(?:class|struct|interface|enum|namespace|trait|impl)\s+\w+[\s<:{]/m.test(text)) {
    return true;
  }
  // 3. 函数定义
  if (/\b(?:def|func|fn|function)\s+\w+\s*\(/.test(text)) {
    return true;
  }
  if (/\b(?:int|void|float|double|char|bool|boolean|auto|string|String|long)\s+\w+\s*\([^)]*\)\s*\{/m.test(text)) {
    return true;
  }
  // 4. 控制流与语句结构
  if (/\b(?:for|while|switch)\s*\([^)]*\)\s*\{?/m.test(text)) {
    return true;
  }
  // 5. 常见输出/调用特征
  if (/\b(?:printf|scanf|std::cout|std::cin|System\.out\.print|console\.(?:log|warn|error)|echo)\b/.test(text)) {
    return true;
  }
  // 6. 变量声明
  if (/\b(?:const|let|var|val)\s+[\w$]+\s*[:=]/.test(text)) {
    return true;
  }
  // 7. Shell / 终端命令特征
  if (/^\s*(?:\$|#)\s+\S+/m.test(text)) {
    return true;
  }
  if (/^\s*(?:npm|pnpm|yarn|pip|git|docker|curl|wget|cargo|go\s+(?:run|build|test)|python3?|node)\s+\S+/m.test(text)) {
    return true;
  }
  // 8. SQL 语句特征
  if (/\b(?:SELECT\s+.+?\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|UPDATE\s+\w+\s+SET)\b/i.test(text)) {
    return true;
  }
  // 9. HTML / XML 标签特征
  if (/^\s*<(?:!DOCTYPE|html|head|body|div|p|span|table|tr|td|script|style)\b/im.test(text)) {
    return true;
  }

  // 10. 代码标点密集度检查（连续以分号、大括号结尾）
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const codePunctuationLines = lines.filter((l) => /;\s*$|[{}]\s*$|=>/.test(l));
    if (codePunctuationLines.length >= Math.ceil(lines.length * 0.6)) {
      return true;
    }
  }

  return false;
}

/**
 * 判断代码块是否为纯文本正文内容（应绕过 Markdown 行内解析，直接作为正文段落填入）。
 */
export function isPureTextCodeBlock(
  lang: string,
  text: string,
  attrs: Record<string, string> = {},
): boolean {
  const normLang = (lang ?? "").trim().toLowerCase();
  // 显式纯文本语言标记
  if (PURE_TEXT_LANGS.has(normLang)) {
    return true;
  }
  // 显式属性标记 (如 ``` {raw} 或 ``` {mode="raw"} 或 ``` {text} 或 ``` {plain})
  if (
    attrs.raw !== undefined ||
    attrs.text !== undefined ||
    attrs.plain !== undefined ||
    attrs.pure !== undefined ||
    attrs.mode === "raw" ||
    attrs.mode === "text" ||
    attrs.mode === "plain"
  ) {
    return true;
  }

  // 若显式指定了其他语言（如 python, c, cpp, js 等），绝不判定为纯文本
  if (normLang) {
    return false;
  }

  // 未指定语言 (无 lang) 时的智能识别：
  // 1) 优先检测参考文献/引用列表格式（如以 [1]、[2]、[ref-1] 开头）
  const hasRefPattern = /^\s*\[(?:\d+|[A-Za-z0-9_-]+)\]\s*/m.test(text);
  if (hasRefPattern) {
    return true;
  }

  // 2) 如果不具备典型编程代码特征，则直接作为纯文本正文处理
  return !looksLikeProgrammingCode(text);
}

/* ------------------------------- 解析 ------------------------------- */

export function parseDocument(markdown: string, options: RenderOptions = {}): ParsedDocument {
  const { body, profile: docProfile } = splitFrontmatter(markdown);
  const docDefault = options.profile ?? docProfile;
  const lines = body.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  const fills: RenderFill[] = [];
  const seen = new Set<string>();
  let sectionProfile: string | undefined = docDefault;

  const collectRefs = (text: string): void => {
    REF_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REF_PATTERN.exec(text)) !== null) {
      const ref = match[2].trim();
      if (!ref || seen.has(ref)) continue;
      const blockProfile = /profile\s*[:=]\s*([^\s|)]+)/.exec(match[3] ?? "");
      const useMatch = /(?:use|fmt|style)\s*[:=]\s*([^\s|)]+)/.exec(match[3] ?? "");
      const paddingMatch = /padding\s*[:=]\s*([^\s|)]+)/.exec(match[3] ?? "");
      const alignMatch = /align\s*[:=]\s*(left|center|right)/i.exec(match[3] ?? "");
      const effective = blockProfile ? blockProfile[1] : sectionProfile;
      const value = options.decodeEntities === false ? match[1] : decodeEntities(match[1]);
      seen.add(ref);
      const fill: RenderFill = { ref, text: value };
      if (effective) fill.profile = effective;
      if (useMatch) fill.use = useMatch[1];
      if (paddingMatch) fill.padding = paddingMatch[1];
      if (alignMatch) fill.align = alignMatch[1].toLowerCase() as RenderFill["align"];
      fills.push(fill);
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 独立 marker：<!-- profile: x --> / <!-- ref: x -->
    const comment = /^\s*<!--\s*(.*?)\s*-->\s*$/.exec(line);
    if (comment) {
      const attrs = parseAttrs(comment[1]);
      if (attrs.profile) sectionProfile = attrs.profile;
      i += 1;
      continue;
    }

    // 围栏代码块
    const fence = /^\s*```+\s*([^\s{]*)\s*(?:\{([^}]*)\})?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const attrs = fence[2] ? parseAttrs(fence[2]) : {};
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      const codeText = buffer.join("\n");
      if (isPureTextCodeBlock(lang, codeText, attrs)) {
        const nonBlank = buffer.filter((l) => l.trim().length > 0);
        nonBlank.forEach((rawLine, idx) => {
          blocks.push({
            type: "paragraph",
            text: rawLine,
            rawRuns: [{ text: rawLine }],
            ref: idx === 0 ? attrs.ref : undefined,
            profile: attrs.profile ?? sectionProfile,
            position: idx === 0 ? attrPosition(attrs.pos) : undefined,
          });
        });
        continue;
      }
      blocks.push({
        type: "code",
        lang,
        text: codeText,
        ref: attrs.ref,
        profile: attrs.profile ?? sectionProfile,
        position: attrPosition(attrs.pos),
        theme: attrs.theme ?? attrs.template,
      });
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      collectRefs(line);
      const { text, attrs } = splitTrailingAttrs(heading[2]);
      if (attrs.profile) sectionProfile = attrs.profile;
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text,
        ref: attrs.ref,
        profile: attrs.profile ?? sectionProfile,
        position: attrPosition(attrs.pos),
      });
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr", text: "", profile: sectionProfile });
      i += 1;
      continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const { text, attrs } = splitTrailingAttrs(buffer.join(" "));
      blocks.push({ type: "quote", text, ref: attrs.ref, profile: attrs.profile ?? sectionProfile, position: attrPosition(attrs.pos) });
      continue;
    }

    // 列表（支持嵌套缩进与任务列表）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const raw: Array<{ indent: number; ordered: boolean; text: string }> = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (item) {
          const indent = item[1].replace(/\t/g, "    ").length;
          raw.push({ indent, ordered: /^\d/.test(item[2]), text: item[3].trim() });
        }
        i += 1;
      }
      // 用“出现过的缩进宽度排序后的序号”当层级，兼容 2 空格/4 空格/制表符等写法。
      const indents = [...new Set(raw.map((entry) => entry.indent))].sort((a, b) => a - b);
      const items: ListItem[] = raw.map((entry) => {
        const level = Math.max(0, indents.indexOf(entry.indent));
        let text = entry.text;
        let checked: boolean | undefined;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
        if (task) {
          checked = task[1].toLowerCase() === "x";
          text = task[2];
        }
        return { text, level, ordered: entry.ordered, checked };
      });
      blocks.push({
        type: "list",
        text: items.map((item) => item.text).join("\n"),
        ordered: items.some((item) => item.ordered),
        items,
        profile: sectionProfile,
      });
      continue;
    }

    // 独立图片：![caption](src){attrs}(extra)
    const imageMatch = /^\s*!\[([\s\S]*?)\]\((.*?)\)(?:\{([^}]*)\})?(?:\(([^)]*)\))?\s*$/.exec(line);
    if (imageMatch) {
      const caption = imageMatch[1].trim();
      const src = imageMatch[2].trim();
      const attrStr = [imageMatch[3], imageMatch[4]].filter(Boolean).join(" ");
      const attrs = parseEnhancedAttrs(attrStr);
      blocks.push({
        type: "image",
        src,
        caption: caption || undefined,
        text: caption,
        attrs,
        ref: attrs.ref,
        profile: attrs.profile ?? sectionProfile,
        position: attrPosition(attrs.pos),
        theme: attrs.theme,
      });
      i += 1;
      continue;
    }

    // 表格
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const headerRow = parseTableRow(line);
      const sepLine = lines[i + 1];
      const alignments = parseTableAlignments(sepLine);
      const rows: string[][] = [headerRow];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      let attrs: Attrs = {};
      if (i < lines.length && /^\s*\{([^}]*)\}\s*$/.test(lines[i])) {
        attrs = parseEnhancedAttrs(lines[i].replace(/[{}]/g, ""));
        i += 1;
      }
      blocks.push({
        type: "table",
        text: "",
        rows,
        alignments,
        attrs,
        ref: attrs.ref,
        profile: attrs.profile ?? sectionProfile,
        position: attrPosition(attrs.pos),
        theme: attrs.theme,
      });
      continue;
    }

    // 普通段落
    const buffer = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|```|>|<!--|!\[|([-*+]|\d+\.)\s)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]))
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    const raw = buffer.join(" ");
    collectRefs(raw);
    const { text, attrs } = splitTrailingAttrs(raw);
    blocks.push({
      type: "paragraph",
      text,
      ref: attrs.ref,
      profile: attrs.profile ?? sectionProfile,
      position: attrPosition(attrs.pos),
    });
  }

  return { profile: docDefault, blocks, fills };
}

/** 兼容旧入口：只取 fills。 */
export function parseSkeleton(markdown: string, options: RenderOptions = {}): { profile?: string; fills: RenderFill[] } {
  const { profile, fills } = parseDocument(markdown, options);
  return { profile, fills };
}

/* ------------------------------- 渲染 ------------------------------- */

export function renderTemplate(
  doc: VirtualWordDocument,
  info: TemplateInfo,
  markdown: string,
  options: RenderOptions = {},
): RenderResult {
  const effectiveConfig =
    options.config ?? resolveReportConfigSync({ configFile: options.configFile, extra: options.extra });
  const effectiveOptions: RenderOptions = {
    ...options,
    config: effectiveConfig,
    codeConfig: { ...(effectiveConfig.code ?? {}), ...(options.codeConfig ?? {}) },
    codeTemplate: options.codeTemplate,
    showLineNumbers: options.showLineNumbers ?? effectiveConfig.code?.lineNumbers ?? true,
  };
  const parsed = parseDocument(markdown, effectiveOptions);
  const warnings: string[] = [];
  const anchorRanges = new Map(readAnchors(doc, info.anchorPrefix).map((range) => [range.ref, range]));

  // 1) 填空
  // 先按 padding 分组求组内最大显示宽度，再统一补齐，保证同组文本等宽对齐。
  const paddingWidths = new Map<string, number>();
  for (const fill of parsed.fills) {
    if (!fill.padding) continue;
    paddingWidths.set(fill.padding, Math.max(paddingWidths.get(fill.padding) ?? 0, displayWidth(fill.text)));
  }

  let filled = 0;
  for (const fill of parsed.fills) {
    const range = anchorRanges.get(fill.ref);
    if (!range) {
      warnings.push(`未知 ref: ${fill.ref}（模板里没有这个锚点）`);
      continue;
    }
    if (range.runEls.length === 0) {
      warnings.push(`ref ${fill.ref} 没有可写的 run，已跳过`);
      continue;
    }
    // 可选：用指定样式覆盖锚点 run 的格式（[文字](ref:锚点 | use:body)）
    if (fill.use) {
      const profile = resolveProfile(info, fill.profile ?? parsed.profile ?? info.defaultProfile);
      const sample = resolveUseStyle(fill.use, profile, anchorRanges);
      if (sample?.runEl) {
        for (const runEl of range.runEls) replaceRunStyle(runEl, sample.runEl);
      } else {
        warnings.push(`fill ${fill.ref} 的 use:${fill.use} 未找到可用样式，沿用原格式`);
      }
    }
    const target = fill.padding ? paddingWidths.get(fill.padding) : undefined;
    const text = target !== undefined ? padToWidth(fill.text, target, fill.align ?? "left") : fill.text;
    if (writeRunElements(range.runEls, text, "replace")) filled += 1;
  }

  // 2) 结构化插入
  let inserted = 0;
  if (effectiveOptions.structured ?? true) {
    inserted = renderBlocks(
      doc,
      info,
      parsed,
      anchorRanges,
      warnings,
      effectiveOptions.appendUnanchored ?? false,
      effectiveOptions,
    );
  }

  if (options.strip ?? true) stripAnchors(doc, info.anchorPrefix);

  return {
    profile: parsed.profile ?? info.defaultProfile,
    filled,
    inserted,
    warnings,
    fills: parsed.fills,
    blocks: parsed.blocks,
  };
}

function renderBlocks(
  doc: VirtualWordDocument,
  info: TemplateInfo,
  parsed: ParsedDocument,
  anchorRanges: Map<string, BookmarkRange>,
  warnings: string[],
  appendUnanchored: boolean,
  options: RenderOptions = {},
): number {
  let count = 0;
  let cursorLast: XmlElement | null = null;
  let cursorFallback: XmlElement | null = null;
  const profileCache = new Map<string, TemplateProfile>();
  const defaultContainer = findDefaultContainer(anchorRanges);
  const ownerDoc: XmlElement =
    defaultContainer?.ownerDocument ?? (anchorRanges.values().next().value as BookmarkRange | undefined)?.paragraphEl?.ownerDocument;

  for (const block of parsed.blocks) {
    if (block.type === "paragraph" && !block.rawRuns && (FILL_ONLY.test(block.text) || HAS_REF_LINK.test(block.text))) continue; // ref 链接按填空处理


    const profileName = block.profile ?? parsed.profile ?? info.defaultProfile;
    let profile = profileCache.get(profileName);
    if (!profile) {
      profile = resolveProfile(info, profileName);
      profileCache.set(profileName, profile);
    }

    const rule = matchRule(profile.rules, block);

    // 计算插入位置：container + refNode（refNode=null 表示追加）
    const position = block.position ?? "after";
    let container: XmlElement | null;
    let refNode: XmlElement | null;
    let anchored = false;

    if (block.ref) {
      const range = anchorRanges.get(block.ref);
      if (!range) {
        warnings.push(`未知 ref: ${block.ref}（${describeBlock(block)}）`);
        continue;
      }
      container = range.paragraphEl.parentNode;
      refNode = position === "before" ? range.paragraphEl : range.paragraphEl.nextSibling;
      anchored = true;
    } else if (cursorLast || cursorFallback) {
      const base = cursorLast ?? cursorFallback;
      container = base.parentNode;
      refNode = base.nextSibling;
    } else if (appendUnanchored && defaultContainer) {
      container = defaultContainer;
      refNode = trailingAnchor(defaultContainer);
    } else {
      warnings.push(`${describeBlock(block)} 没有 ref 也没有前置锚点，已跳过`);
      continue;
    }
    if (!container) continue;

    // 骨架常把已有标题再写一遍（带 {ref}）。若锚点段落文本与标题一致，就不再重复插入，
    // 只把它当作后续内容的游标。
    if (block.type === "heading" && block.ref) {
      const range = anchorRanges.get(block.ref);
      const existingText = range ? paragraphText(range.paragraphEl).replace(/\s+/g, "") : "";
      const wanted = block.text.replace(/\s+/g, "");
      if (existingText && existingText === wanted) {
        cursorLast = range!.paragraphEl;
        cursorFallback = container;
        continue;
      }
    }

    const sample =
      styleRefToSample(rule?.style ?? profile.defaults?.style, profile, anchorRanges) ??
      styleRefToSample(profile.styles?.body, profile, anchorRanges) ??
      { inline: { paragraph: { styleId: "Normal" } } };

    if (block.type === "code") {
      const hasExplicitTheme = Boolean(
        block.theme ||
        (rule?.theme && rule.theme.trim().length > 0) ||
        options.codeTemplate,
      );
      const hasDocumentStyle = Boolean(sample && (rule?.style || profile.styles?.code));

      if (hasDocumentStyle && !hasExplicitTheme) {
        // 模式 A：文档已明确代码样式（XML Style ID），套用原文档样式，按 lint 设置进行语法着色
        const { lastEl, lineCount } = renderStyledCodeParagraphs(
          block,
          rule ?? { match: { type: "code" } },
          sample!,
          options,
          container,
          refNode,
          ownerDoc,
        );
        if (lastEl) {
          cursorLast = lastEl;
          if (anchored) cursorFallback = container;
        }
        count += lineCount;
        continue;
      } else {
        // 模式 B：代码卡片表格（CodeInWord 风格，带行号栏、外边框与主题底色）
        const codeTable = buildCodeTable(block, rule, sample, options, ownerDoc);
        container.insertBefore(codeTable, refNode);
        cursorLast = codeTable;
        if (anchored) cursorFallback = container;
        count += 1;
        continue;
      }
    }

    if (block.type === "image") {
      const { paragraphEl, captionEl } = buildImageElement(
        ownerDoc,
        doc,
        block,
        rule,
        profile,
        anchorRanges,
        {
          imageConfig: options.imageConfig ?? options.config?.image,
          config: options.config,
          sample,
          markdownDir: options.markdownDir,
          docPrId: docPrIdCounter++,
        },
      );
      container.insertBefore(paragraphEl, refNode);
      let lastEl: XmlElement = paragraphEl;
      count += 1;
      if (captionEl) {
        container.insertBefore(captionEl, lastEl.nextSibling);
        lastEl = captionEl;
        count += 1;
      }
      cursorLast = lastEl;
      if (anchored) cursorFallback = container;
      continue;
    }

    if (block.type === "table") {
      const tableEl = buildTableElement(
        ownerDoc,
        block,
        rule,
        profile,
        anchorRanges,
        {
          tableConfig: options.tableConfig ?? options.config?.table,
          config: options.config,
          sample,
        },
      );
      container.insertBefore(tableEl, refNode);
      cursorLast = tableEl;
      if (anchored) cursorFallback = container;
      count += 1;
      continue;
    }

    if (!sample) {
      warnings.push(`${describeBlock(block)} 找不到可用样式（rules/profile 未覆盖），已跳过`);
      continue;
    }

    const inlineCodeRule = matchRule(profile.rules, { type: "inlineCode" });
    const inlineCodeSample = inlineCodeRule ? styleRefToSample(inlineCodeRule.style, profile, anchorRanges) : null;

    if (block.type === "hr") {
      const ruleEl = buildHorizontalRule(sample, ownerDoc);
      container.insertBefore(ruleEl, refNode);
      cursorLast = ruleEl;
      if (anchored) cursorFallback = container;
      count += 1;
      continue;
    }

    const specs = blockParagraphSpecs(block);
    let last: XmlElement | null = null;
    for (const spec of specs) {
      const paragraphEl = buildParagraph(
        sample,
        spec.runs,
        inlineCodeSample,
        (docNode, link) => createHyperlinkShell(doc, docNode, link),
        ownerDoc,
      );
      if (spec.level) applyIndent(paragraphEl, spec.level);
      container.insertBefore(paragraphEl, last ? last.nextSibling : refNode);
      last = paragraphEl;
      count += 1;
    }

    if (last) {
      cursorLast = last;
      if (anchored) cursorFallback = container;
    }
  }

  return count;
}

function buildParagraph(
  sample: StyleSample,
  runs: readonly InlineRun[],
  inlineCodeSample: StyleSample | null,
  hyperlink: (ownerDoc: XmlElement, link: string) => XmlElement | null,
  ownerDoc: XmlElement,
): XmlElement {
  if (sample.inline) {
    const styled = runs.map((run) => (run.link ? { ...run, underline: true, color: run.color ?? "0563C1" } : run));
    return createParagraphFromStyles(ownerDoc, sample.inline.paragraph ?? {}, sample.inline.run ?? {}, styled);
  }

  const paragraphEl = sample.paragraphEl.cloneNode(true) as XmlElement;
  paragraphEl.removeAttribute("w14:paraId");
  paragraphEl.removeAttribute("w14:textId");
  for (const child of childElementsOf(paragraphEl)) {
    if (child.nodeName !== "w:pPr") paragraphEl.removeChild(child);
  }
  let openLink: string | null = null;
  let openEl: XmlElement | null = null;

  for (const run of runs) {
    const runSample = run.code && inlineCodeSample && !inlineCodeSample.inline ? inlineCodeSample : sample;
    const mods = run.link ? { ...run, underline: true, color: run.color ?? "0563C1" } : run;
    const runEl = cloneRunWithText(runSample.runEl as XmlElement, run.text, mods);

    if (run.link) {
      if (openEl && openLink === run.link) {
        openEl.appendChild(runEl); // 同一链接的连续 run 合并进一个 w:hyperlink
      } else {
        const shell = hyperlink(paragraphEl.ownerDocument, run.link);
        if (shell) {
          shell.appendChild(runEl);
          paragraphEl.appendChild(shell);
          openEl = shell;
          openLink = run.link;
        } else {
          paragraphEl.appendChild(runEl);
          openEl = null;
          openLink = null;
        }
      }
    } else {
      paragraphEl.appendChild(runEl);
      openEl = null;
      openLink = null;
    }
  }
  return paragraphEl;
}

function buildHorizontalRule(sample: StyleSample, ownerDoc: XmlElement): XmlElement {
  if (sample.inline) {
    const paragraphEl = createParagraphFromStyles(ownerDoc, sample.inline.paragraph ?? {}, sample.inline.run ?? {}, []);
    addBottomBorder(paragraphEl, ownerDoc);
    return paragraphEl;
  }
  const paragraphEl = sample.paragraphEl!.cloneNode(true) as XmlElement;
  paragraphEl.removeAttribute("w14:paraId");
  paragraphEl.removeAttribute("w14:textId");
  for (const child of childElementsOf(paragraphEl)) {
    if (child.nodeName !== "w:pPr") paragraphEl.removeChild(child);
  }
  let pPr = childElementsOf(paragraphEl).find((child) => child.nodeName === "w:pPr") ?? null;
  if (!pPr) {
    pPr = createWordElement(paragraphEl, "w:pPr");
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild);
  }
  addBottomBorder(paragraphEl, ownerDoc);
  return paragraphEl;
}

function extractSampleFont(sample: StyleSample | null): { family?: string; size?: number } {
  if (!sample?.runEl) return {};
  const rPr = childElementsOf(sample.runEl).find((c) => c.nodeName === "w:rPr");
  if (!rPr) return {};
  const rFonts = childElementsOf(rPr).find((c) => c.nodeName === "w:rFonts");
  const sz = childElementsOf(rPr).find((c) => c.nodeName === "w:sz");
  return {
    family: rFonts?.getAttribute?.("w:ascii") || rFonts?.getAttribute?.("w:eastAsia") || undefined,
    size: sz?.getAttribute?.("w:val") ? parseInt(sz.getAttribute("w:val"), 10) : undefined,
  };
}

const STANDARD_LINT_COLORS: Record<string, { color?: string; bold?: boolean; italic?: boolean }> = {
  keyword: { color: "006699", bold: true },
  string: { color: "032F62" },
  comment: { color: "008200", italic: true },
  comments: { color: "008200", italic: true },
  function: { color: "6F42C1" },
  functions: { color: "6F42C1" },
  number: { color: "005CC5" },
  value: { color: "005CC5" },
  operator: { color: "D73A49" },
  variable: { color: "E36209" },
  "class-name": { color: "6F42C1", bold: true },
  boolean: { color: "006699", bold: true },
  preprocessor: { color: "22863A" },
};

function renderStyledCodeParagraphs(
  block: MarkdownBlock,
  rule: TemplateRule,
  sample: StyleSample,
  options: RenderOptions,
  container: XmlElement,
  refNode: XmlElement | null,
  ownerDoc: XmlElement,
): { lastEl: XmlElement | null; lineCount: number } {
  const isLint = rule.lint !== false;
  const tabSize = options.codeConfig?.tabSize ?? 4;
  const hl = highlightCode(block.text, { lang: block.lang, tabSize });

  let last: XmlElement | null = null;
  for (const line of hl.lines) {
    let paragraphEl: XmlElement;
    if (sample.inline) {
      paragraphEl = createParagraphFromStyles(ownerDoc, sample.inline.paragraph ?? {}, sample.inline.run ?? {}, []);
    } else {
      paragraphEl = sample.paragraphEl!.cloneNode(true) as XmlElement;
      paragraphEl.removeAttribute("w14:paraId");
      paragraphEl.removeAttribute("w14:textId");
      for (const child of childElementsOf(paragraphEl)) {
        if (child.nodeName !== "w:pPr") paragraphEl.removeChild(child);
      }
    }

    if (line.runs.length === 0) {
      const emptyRun = cloneRunWithText(sample.runEl as XmlElement, "");
      paragraphEl.appendChild(emptyRun);
    } else {
      for (const run of line.runs) {
        let styleMods: { color?: string; bold?: boolean; italic?: boolean } = {};
        if (isLint) {
          for (const cls of run.classes) {
            if (STANDARD_LINT_COLORS[cls]) {
              styleMods = STANDARD_LINT_COLORS[cls];
              break;
            }
          }
        }
        const runEl = cloneRunWithText(sample.runEl as XmlElement, run.text, styleMods);
        paragraphEl.appendChild(runEl);
      }
    }

    container.insertBefore(paragraphEl, last ? last.nextSibling : refNode);
    last = paragraphEl;
  }

  return { lastEl: last, lineCount: hl.lines.length };
}

function buildCodeTable(
  block: MarkdownBlock,
  rule: TemplateRule | undefined,
  sample: StyleSample | null,
  options: RenderOptions,
  ownerDoc: XmlElement,
): XmlElement {
  const codeConfig = options.codeConfig ?? options.config?.code ?? {};
  const themeFromRule = rule?.theme && rule.theme.trim().length > 0 ? rule.theme.trim() : undefined;
  const themeName =
    block.theme ??
    themeFromRule ??
    options.codeTemplate ??
    codeConfig.template ??
    "default";
  const theme = loadCodeThemeSync(themeName);

  const sampleFont = extractSampleFont(sample);

  // 字体配置：支持 "inherit" 随正文/代码样板字体
  let fontFamily = codeConfig.fontFamily ?? theme.container.fontFamily;
  if (fontFamily === "inherit") fontFamily = sampleFont.family || "Consolas";
  if (!fontFamily) fontFamily = "Consolas";

  // 字号配置：支持 "inherit" 随正文字号
  let fontSize: number;
  if (codeConfig.fontSize === "inherit") {
    fontSize = sampleFont.size ?? theme.container.fontSize ?? 19;
  } else if (typeof codeConfig.fontSize === "number") {
    fontSize = codeConfig.fontSize;
  } else if (typeof codeConfig.fontSize === "string") {
    fontSize = parseFontSizeToHalfPoints(codeConfig.fontSize, theme.container.fontSize ?? 19);
  } else {
    fontSize = theme.container.fontSize ?? 19;
  }

  const tabSize = codeConfig.tabSize ?? 4;
  const showLineNumbers = options.showLineNumbers ?? codeConfig.lineNumbers ?? true;

  const hl = highlightCode(block.text, { lang: block.lang, tabSize });

  const containerBg = theme.container.backgroundColor ?? "FAFBFC";
  const borderColor = theme.container.borderColor ?? "E1E4E8";
  const borderSize = String(theme.container.borderSize ?? 4);

  const gutterBg = theme.gutter.backgroundColor ?? "F6F8FA";
  const gutterColor = theme.gutter.color ?? "959DA5";
  const gutterBorderColor = theme.gutter.borderRightColor ?? "52C41A";
  const gutterBorderSize = String(theme.gutter.borderRightSize ?? 18);
  const defaultColor = theme.container.color ?? "24292E";

  const digits = Math.max(2, String(hl.lines.length).length);
  const gutterWidth = 360 + digits * 140;
  const codeWidth = 9000 - (showLineNumbers ? gutterWidth : 0);

  const tbl = ownerDoc.createElementNS(WORD_NS, "w:tbl");

  // tblPr
  const tblPr = ownerDoc.createElementNS(WORD_NS, "w:tblPr");
  const tblW = ownerDoc.createElementNS(WORD_NS, "w:tblW");
  tblW.setAttribute("w:w", "5000");
  tblW.setAttribute("w:type", "pct");
  tblPr.appendChild(tblW);

  const jc = ownerDoc.createElementNS(WORD_NS, "w:jc");
  jc.setAttribute("w:val", "center");
  tblPr.appendChild(jc);

  const tblBorders = ownerDoc.createElementNS(WORD_NS, "w:tblBorders");
  for (const side of ["top", "left", "bottom", "right"]) {
    const b = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    b.setAttribute("w:val", "single");
    b.setAttribute("w:sz", borderSize);
    b.setAttribute("w:space", "0");
    b.setAttribute("w:color", borderColor);
    tblBorders.appendChild(b);
  }
  for (const side of ["insideH", "insideV"]) {
    const b = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    b.setAttribute("w:val", "none");
    tblBorders.appendChild(b);
  }
  tblPr.appendChild(tblBorders);

  const tblCellMar = ownerDoc.createElementNS(WORD_NS, "w:tblCellMar");
  for (const side of ["top", "bottom"]) {
    const m = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    m.setAttribute("w:w", "30");
    m.setAttribute("w:type", "dxa");
    tblCellMar.appendChild(m);
  }
  for (const side of ["left", "right"]) {
    const m = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    m.setAttribute("w:w", "80");
    m.setAttribute("w:type", "dxa");
    tblCellMar.appendChild(m);
  }
  tblPr.appendChild(tblCellMar);
  tbl.appendChild(tblPr);

  // tblGrid
  const tblGrid = ownerDoc.createElementNS(WORD_NS, "w:tblGrid");
  if (showLineNumbers) {
    const col1 = ownerDoc.createElementNS(WORD_NS, "w:gridCol");
    col1.setAttribute("w:w", String(gutterWidth));
    tblGrid.appendChild(col1);
  }
  const col2 = ownerDoc.createElementNS(WORD_NS, "w:gridCol");
  col2.setAttribute("w:w", String(codeWidth));
  tblGrid.appendChild(col2);
  tbl.appendChild(tblGrid);

  // rows
  for (const line of hl.lines) {
    const tr = ownerDoc.createElementNS(WORD_NS, "w:tr");
    const trPr = ownerDoc.createElementNS(WORD_NS, "w:trPr");
    const cantSplit = ownerDoc.createElementNS(WORD_NS, "w:cantSplit");
    trPr.appendChild(cantSplit);
    tr.appendChild(trPr);

    if (showLineNumbers) {
      const tcGutter = ownerDoc.createElementNS(WORD_NS, "w:tc");
      const tcPr = ownerDoc.createElementNS(WORD_NS, "w:tcPr");
      const tcW = ownerDoc.createElementNS(WORD_NS, "w:tcW");
      tcW.setAttribute("w:w", String(gutterWidth));
      tcW.setAttribute("w:type", "dxa");
      tcPr.appendChild(tcW);

      const shd = ownerDoc.createElementNS(WORD_NS, "w:shd");
      shd.setAttribute("w:val", "clear");
      shd.setAttribute("w:color", "auto");
      shd.setAttribute("w:fill", gutterBg);
      tcPr.appendChild(shd);

      const tcBorders = ownerDoc.createElementNS(WORD_NS, "w:tcBorders");
      for (const side of ["top", "left", "bottom"]) {
        const b = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
        b.setAttribute("w:val", "none");
        tcBorders.appendChild(b);
      }
      const bRight = ownerDoc.createElementNS(WORD_NS, "w:right");
      bRight.setAttribute("w:val", "single");
      bRight.setAttribute("w:sz", gutterBorderSize);
      bRight.setAttribute("w:space", "0");
      bRight.setAttribute("w:color", gutterBorderColor);
      tcBorders.appendChild(bRight);
      tcPr.appendChild(tcBorders);

      const tcMar = ownerDoc.createElementNS(WORD_NS, "w:tcMar");
      for (const [s, w] of [["top", "20"], ["bottom", "20"], ["left", "40"], ["right", "80"]]) {
        const m = ownerDoc.createElementNS(WORD_NS, `w:${s}`);
        m.setAttribute("w:w", w);
        m.setAttribute("w:type", "dxa");
        tcMar.appendChild(m);
      }
      tcPr.appendChild(tcMar);
      tcGutter.appendChild(tcPr);

      const pGutter = ownerDoc.createElementNS(WORD_NS, "w:p");
      const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
      const sp = ownerDoc.createElementNS(WORD_NS, "w:spacing");
      sp.setAttribute("w:before", "0");
      sp.setAttribute("w:after", "0");
      sp.setAttribute("w:line", "240");
      sp.setAttribute("w:lineRule", "auto");
      pPr.appendChild(sp);
      const jcLine = ownerDoc.createElementNS(WORD_NS, "w:jc");
      jcLine.setAttribute("w:val", "right");
      pPr.appendChild(jcLine);
      pGutter.appendChild(pPr);

      const rGutter = ownerDoc.createElementNS(WORD_NS, "w:r");
      const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
      const rFonts = ownerDoc.createElementNS(WORD_NS, "w:rFonts");
      rFonts.setAttribute("w:ascii", fontFamily);
      rFonts.setAttribute("w:hAnsi", fontFamily);
      rPr.appendChild(rFonts);
      const colEl = ownerDoc.createElementNS(WORD_NS, "w:color");
      colEl.setAttribute("w:val", gutterColor);
      rPr.appendChild(colEl);
      const szEl = ownerDoc.createElementNS(WORD_NS, "w:sz");
      szEl.setAttribute("w:val", String(fontSize));
      rPr.appendChild(szEl);
      rGutter.appendChild(rPr);

      const tGutter = ownerDoc.createElementNS(WORD_NS, "w:t");
      tGutter.textContent = String(line.lineNumber);
      rGutter.appendChild(tGutter);
      pGutter.appendChild(rGutter);

      tcGutter.appendChild(pGutter);
      tr.appendChild(tcGutter);
    }

    // Code Cell
    const tcCode = ownerDoc.createElementNS(WORD_NS, "w:tc");
    const tcPr = ownerDoc.createElementNS(WORD_NS, "w:tcPr");
    const tcW = ownerDoc.createElementNS(WORD_NS, "w:tcW");
    tcW.setAttribute("w:w", String(codeWidth));
    tcW.setAttribute("w:type", "dxa");
    tcPr.appendChild(tcW);

    const shd = ownerDoc.createElementNS(WORD_NS, "w:shd");
    shd.setAttribute("w:val", "clear");
    shd.setAttribute("w:color", "auto");
    shd.setAttribute("w:fill", containerBg);
    tcPr.appendChild(shd);

    const tcBorders = ownerDoc.createElementNS(WORD_NS, "w:tcBorders");
    for (const side of ["top", "left", "bottom", "right"]) {
      const b = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
      b.setAttribute("w:val", "none");
      tcBorders.appendChild(b);
    }
    tcPr.appendChild(tcBorders);

    const tcMar = ownerDoc.createElementNS(WORD_NS, "w:tcMar");
    for (const [s, w] of [["top", "20"], ["bottom", "20"], ["left", "120"], ["right", "60"]]) {
      const m = ownerDoc.createElementNS(WORD_NS, `w:${s}`);
      m.setAttribute("w:w", w);
      m.setAttribute("w:type", "dxa");
      tcMar.appendChild(m);
    }
    tcPr.appendChild(tcMar);
    tcCode.appendChild(tcPr);

    const pCode = ownerDoc.createElementNS(WORD_NS, "w:p");
    const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
    const sp = ownerDoc.createElementNS(WORD_NS, "w:spacing");
    sp.setAttribute("w:before", "0");
    sp.setAttribute("w:after", "0");
    sp.setAttribute("w:line", "240");
    sp.setAttribute("w:lineRule", "auto");
    pPr.appendChild(sp);
    pCode.appendChild(pPr);

    if (line.runs.length === 0) {
      const emptyRun = ownerDoc.createElementNS(WORD_NS, "w:r");
      const emptyPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
      const emptySz = ownerDoc.createElementNS(WORD_NS, "w:sz");
      emptySz.setAttribute("w:val", String(fontSize));
      emptyPr.appendChild(emptySz);
      emptyRun.appendChild(emptyPr);
      const emptyT = ownerDoc.createElementNS(WORD_NS, "w:t");
      emptyT.textContent = "";
      emptyRun.appendChild(emptyT);
      pCode.appendChild(emptyRun);
    } else {
      for (const run of line.runs) {
        let tokenStyle: CodeTokenStyle | undefined;
        for (const cls of run.classes) {
          if (theme.tokens[cls]) {
            tokenStyle = theme.tokens[cls];
            break;
          }
        }
        const color = tokenStyle?.color ?? defaultColor;
        const bold = tokenStyle?.bold ?? false;
        const italic = tokenStyle?.italic ?? false;

        const runEl = ownerDoc.createElementNS(WORD_NS, "w:r");
        const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");

        const rFonts = ownerDoc.createElementNS(WORD_NS, "w:rFonts");
        rFonts.setAttribute("w:ascii", fontFamily);
        rFonts.setAttribute("w:hAnsi", fontFamily);
        rPr.appendChild(rFonts);

        const colEl = ownerDoc.createElementNS(WORD_NS, "w:color");
        colEl.setAttribute("w:val", color);
        rPr.appendChild(colEl);

        const szEl = ownerDoc.createElementNS(WORD_NS, "w:sz");
        szEl.setAttribute("w:val", String(fontSize));
        rPr.appendChild(szEl);

        if (bold) rPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:b"));
        if (italic) rPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:i"));

        runEl.appendChild(rPr);

        const tEl = ownerDoc.createElementNS(WORD_NS, "w:t");
        tEl.textContent = run.text;
        tEl.setAttribute("xml:space", "preserve");
        runEl.appendChild(tEl);

        pCode.appendChild(runEl);
      }
    }

    tcCode.appendChild(pCode);
    tr.appendChild(tcCode);
    tbl.appendChild(tr);
  }

  return tbl;
}

function addBottomBorder(paragraphEl: XmlElement, ownerDoc: XmlElement): void {
  let pPr = childElementsOf(paragraphEl).find((child) => child.nodeName === "w:pPr") ?? null;
  if (!pPr) {
    pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild);
  }
  if (childElementsOf(pPr).some((child) => child.nodeName === "w:pBdr")) return;
  const pBdr = ownerDoc.createElementNS(WORD_NS, "w:pBdr");
  const bottom = ownerDoc.createElementNS(WORD_NS, "w:bottom");
  bottom.setAttribute("w:val", "single");
  bottom.setAttribute("w:sz", "6");
  bottom.setAttribute("w:space", "1");
  bottom.setAttribute("w:color", "auto");
  pBdr.appendChild(bottom);
  pPr.appendChild(pBdr);
}

/** 取段落的可见文本（用于判断骨架标题是否已经在模板里存在）。 */
function paragraphText(paragraphEl: XmlElement): string {
  let out = "";
  const visit = (element: XmlElement): void => {
    for (const child of childElementsOf(element)) {
      if (child.nodeName === "w:t") out += child.textContent ?? "";
      else if (child.nodeName === "w:tab") out += "\t";
      else if (child.nodeName === "w:br") out += "\n";
      else visit(child);
    }
  };
  visit(paragraphEl);
  return out;
}

function findDefaultContainer(anchorRanges: Map<string, BookmarkRange>): XmlElement | null {
  let fallback: XmlElement | null = null;
  for (const range of anchorRanges.values()) {
    const parent = range.paragraphEl?.parentNode;
    if (!parent) continue;
    if (parent.nodeName === "w:body") return parent;
    fallback ??= parent;
  }
  return fallback;
}

function trailingAnchor(container: XmlElement): XmlElement | null {
  const last = childElementsOf(container).findLast?.((child) => child.nodeName === "w:sectPr");
  return last ?? null;
}

interface ParagraphSpec {
  runs: InlineRun[];
  /** 列表缩进层级，0/undefined 表示不缩进。 */
  level?: number;
}

/** 把一个 block 拆成若干“段落”，每个段落是若干行内 run（含列表层级）。 */
function blockParagraphSpecs(block: MarkdownBlock): ParagraphSpec[] {
  if (block.rawRuns) return [{ runs: block.rawRuns }];
  if (block.type === "code") return block.text.split("\n").map((line) => ({ runs: [{ text: line }] }));
  if (block.type === "list") {
    const counters: number[] = [];
    const markers = ["• ", "◦ ", "▪ ", "· "];
    return (block.items ?? []).map((item) => {
      let marker: string;
      if (item.checked !== undefined) {
        marker = item.checked ? "☑ " : "☐ ";
      } else if (item.ordered) {
        counters[item.level] = (counters[item.level] ?? 0) + 1;
        counters.length = item.level + 1;
        marker = `${counters[item.level]}. `;
      } else {
        marker = markers[Math.min(item.level, markers.length - 1)];
      }
      return { runs: [{ text: marker }, ...parseInline(item.text)], level: item.level };
    });
  }
  return [{ runs: parseInline(block.text) }];
}

/** 按层级给列表段落加缩进（在样板已有缩进基础上叠加）。 */
function applyIndent(paragraphEl: XmlElement, level: number): void {
  let pPr = childElementsOf(paragraphEl).find((child) => child.nodeName === "w:pPr") ?? null;
  if (!pPr) {
    pPr = createWordElement(paragraphEl, "w:pPr");
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild);
  }
  let ind = childElementsOf(pPr).find((child) => child.nodeName === "w:ind") ?? null;
  if (!ind) {
    ind = createWordElement(pPr, "w:ind");
    pPr.appendChild(ind);
  }
  const base = Number.parseInt(ind.getAttribute("w:left") ?? "0", 10) || 0;
  const step = 420;
  ind.setAttribute("w:left", String(base + level * step));
  if (!ind.getAttribute("w:hanging")) ind.setAttribute("w:hanging", String(step));
}

const INLINE_PATTERN_SOURCE =
  "(\\[[^\\]]+\\]\\(\\s*[^)\\s]+\\s*\\)|\\*\\*\\*[^*]+\\*\\*\\*|\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|___[^_]+___|__[^_]+__|_[^_]+_|~~[^~]+~~|`[^`]+`)";

/**
 * 解析行内 markdown：`**粗**`、`*斜*`、`***粗斜***`、`~~删除~~`、`` `代码` ``（代码暂按普通文本）。
 * 相邻、格式相同的片段会合并。
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (value: string, mods: Omit<InlineRun, "text">): void => {
    if (!value && !mods.link && !mods.code) return;
    const prev = runs[runs.length - 1];
    if (
      prev &&
      prev.bold === mods.bold &&
      prev.italic === mods.italic &&
      prev.strike === mods.strike &&
      prev.code === mods.code &&
      prev.link === mods.link
    ) {
      prev.text += value;
      return;
    }
    runs.push({ text: value, ...mods });
  };

  // 用局部正则：解析链接文字时会递归调用本函数，共享全局 lastIndex 会死循环。
  const pattern = new RegExp(INLINE_PATTERN_SOURCE, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) push(text.slice(last, match.index), {});
    const token = match[0];
    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(\s*([^)\s]+)\s*\)$/.exec(token);
      if (link && !link[2].startsWith("ref:")) {
        // 链接文字内部还可以有 **粗**/*斜*：递归解析后统一挂上 link
        const url = link[2];
        for (const inner of parseInline(decodeEntities(link[1]))) push(inner.text, { ...inner, link: url });
      } else if (link) {
        push(link[1], {}); // ref: 链接是填空，这里当普通文本
      }
    } else if (token.startsWith("***") || token.startsWith("___")) {
      push(token.slice(3, -3), { bold: true, italic: true });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      push(token.slice(2, -2), { bold: true });
    } else if (token.startsWith("~~")) {
      push(token.slice(2, -2), { strike: true });
    } else if (token.startsWith("`")) {
      push(token.slice(1, -1), { code: true });
    } else {
      push(token.slice(1, -1), { italic: true });
    }
    last = match.index + token.length;
  }
  if (last < text.length) push(text.slice(last), {});
  return runs.length > 0 ? runs : [{ text }];
}

interface StyleSample {
  paragraphEl?: XmlElement;
  runEl?: XmlElement;
  /** 没有可克隆元素时，用内联样式对象从零构造。 */
  inline?: { paragraph?: StyleObject; run?: StyleObject };
}

function styleRefToSample(
  ref: StyleRef | undefined,
  profile: TemplateProfile,
  anchorRanges: Map<string, BookmarkRange>,
): StyleSample | null {
  if (!ref) return null;
  if ("anchor" in ref) {
    const range = anchorRanges.get(ref.anchor);
    if (!range || range.runEls.length === 0) return null;
    return { paragraphEl: range.paragraphEl, runEl: range.runEls[0] };
  }
  if ("recipe" in ref) return styleRefToSample(profile.styles[ref.recipe], profile, anchorRanges);
  if ("inline" in ref) return { inline: ref.inline };
  if ("ooxmlStyleId" in ref) return { inline: { paragraph: { styleId: ref.ooxmlStyleId } } };
  if ("styleName" in ref) return { inline: { paragraph: { styleId: ref.styleName } } };
  return null;
}

interface MatchTarget {
  type: string;
  level?: number;
  lang?: string;
  ref?: string;
}

/** 显示宽度：CJK / 全角字符算 2，ASCII 算 1，零宽字符算 0。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    width += isWideCodePoint(cp) ? 2 : cp === 0x200b ? 0 : 1;
  }
  return width;
}

/** 用空格补齐到目标显示宽度，并按 align 左/中/右对齐。 */
export function padToWidth(text: string, target: number, align: "left" | "center" | "right" = "left"): string {
  const diff = target - displayWidth(text);
  if (diff <= 0) return text;
  if (align === "right") return " ".repeat(diff) + text;
  if (align === "center") {
    const left = Math.floor(diff / 2);
    return " ".repeat(left) + text + " ".repeat(diff - left);
  }
  return text + " ".repeat(diff);
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** `use:` 可写 recipe 名，也可写锚点 id；返回可用于取 rPr 的样式样板。 */
function resolveUseStyle(use: string, profile: TemplateProfile, anchorRanges: Map<string, BookmarkRange>): StyleSample | null {
  if (profile.styles[use]) return styleRefToSample(profile.styles[use], profile, anchorRanges);
  const anchor = anchorRanges.get(use);
  if (anchor && anchor.runEls.length > 0) return { paragraphEl: anchor.paragraphEl, runEl: anchor.runEls[0] };
  return null;
}

function matchRule(rules: readonly TemplateRule[], target: MatchTarget): TemplateRule | undefined {
  const exact = rules.find((rule) => matchesRule(rule, target));
  if (exact) return exact;

  // 降级策略：
  // 1. 高阶标题向下退避：h3 -> h2 -> h1
  if (target.type === "heading" && target.level && target.level > 1) {
    for (let lvl = target.level - 1; lvl >= 1; lvl--) {
      const fallback = rules.find((rule) => matchesRule(rule, { ...target, level: lvl }));
      if (fallback) return fallback;
    }
  }

  // 2. 列表、引用、分割线回退到正文段落
  if (target.type === "list" || target.type === "quote" || target.type === "hr") {
    const fallback = rules.find((rule) => matchesRule(rule, { ...target, type: "paragraph" }));
    if (fallback) return fallback;
  }

  // 3. 只有文本类块（paragraph, caption）才回退到默认段落或通配规则
  if (target.type === "paragraph" || target.type === "caption") {
    return rules.find((rule) => rule.match.type === "paragraph" || rule.match.type === "*");
  }

  return undefined;
}

function matchesRule(rule: TemplateRule, target: MatchTarget): boolean {
  const matcher = rule.match;
  if (matcher.ref !== undefined && matcher.ref !== target.ref) return false;
  if (matcher.type !== "*" && matcher.type !== target.type) return false;
  if (matcher.level !== undefined && matcher.level !== target.level) return false;
  if (matcher.lang !== undefined && matcher.lang !== target.lang) return false;
  return true;
}

function describeBlock(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      return `标题 h${block.level}`;
    case "code":
      return `代码块(${block.lang || "text"})`;
    case "list":
      return "列表";
    case "quote":
      return "引用";
    case "image":
      return `图片(${block.src || ""})`;
    case "table":
      return `表格(${block.rows?.length ?? 0}行)`;
    default:
      return block.type;
  }
}

/* ------------------------------ 工具 ------------------------------ */

export async function renderTemplateFile(
  templatePath: string,
  infoPath: string,
  markdownPath: string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const info = JSON.parse(await readFile(infoPath, "utf-8")) as TemplateInfo;
  const markdown = await readFile(markdownPath, "utf-8");
  const doc = await openDocx(templatePath);
  const markdownDir = options.markdownDir ?? path.dirname(path.resolve(markdownPath));
  const result = renderTemplate(doc, info, markdown, { ...options, markdownDir });
  await doc.saveAs(outputPath);
  return result;
}

interface Attrs {
  [key: string]: string;
}

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  const pattern = /([\w-]+)\s*[:=]\s*("([^"]*)"|'([^']*)'|[^\s,}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    attrs[match[1]] = match[3] ?? match[4] ?? match[2];
  }
  return attrs;
}

function splitTrailingAttrs(text: string): { text: string; attrs: Attrs } {
  const match = /\{([^}]*)\}\s*$/.exec(text);
  if (!match) return { text, attrs: {} };
  return { text: text.slice(0, match.index).trimEnd(), attrs: parseAttrs(match[1]) };
}

function attrPosition(value: string | undefined): "before" | "after" | undefined {
  return value === "before" || value === "after" ? value : undefined;
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function parseTableAlignments(sepLine: string): Array<"left" | "center" | "right"> {
  const cols = sepLine.trim().replace(/^\||\|$/g, "").split("|");
  return cols.map((col) => {
    const s = col.trim();
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function parseEnhancedAttrs(attrStr?: string): Attrs {
  if (!attrStr) return {};
  const attrs: Attrs = {};
  const regex = /([#\w-]+)(?:[:=](?:"([^"]*)"|'([^']*)'|([^\s,}]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrStr)) !== null) {
    const rawKey = match[1];
    const val = match[2] ?? match[3] ?? match[4];
    if (rawKey.startsWith("#")) {
      attrs.ref = rawKey.slice(1);
    } else if (val !== undefined) {
      attrs[rawKey] = val;
    } else {
      const lower = rawKey.toLowerCase();
      if (lower === "center" || lower === "left" || lower === "right") {
        attrs.align = lower;
      } else if (lower === "before" || lower === "after") {
        attrs.pos = lower;
      } else if (lower === "max" || /^\d+(\.\d+)?(%|px|pt|cm|mm|in)?$/.test(lower)) {
        attrs.size = lower;
      } else if (["academic", "grid", "striped", "clean"].includes(lower)) {
        attrs.theme = lower;
      } else {
        attrs[rawKey] = "true";
      }
    }
  }
  return attrs;
}

let docPrIdCounter = 1000;

function buildImageElement(
  ownerDoc: XmlElement,
  doc: VirtualWordDocument,
  block: MarkdownBlock,
  rule: TemplateRule | null | undefined,
  profile: TemplateProfile,
  anchorRanges: Map<string, BookmarkRange>,
  ctx: {
    imageConfig?: ImageBlockConfig;
    config?: ReportConfig;
    sample: XmlElement | null;
    markdownDir?: string;
    docPrId: number;
  },
): { paragraphEl: XmlElement; captionEl: XmlElement | null } {
  let imagePath = block.src || "";
  if (ctx.markdownDir && !path.isAbsolute(imagePath)) {
    const candidate = path.resolve(ctx.markdownDir, imagePath);
    if (existsSync(candidate)) {
      imagePath = candidate;
    }
  }
  if (!existsSync(imagePath)) {
    throw new Error(`图片文件未找到: ${block.src} (解析路径: ${imagePath})`);
  }

  const buffer = readFileSync(imagePath);
  const dims = getImageDimensions(buffer);

  const align =
    block.attrs?.align ||
    (rule?.options as any)?.align ||
    ctx.imageConfig?.align ||
    "center";

  const size =
    block.attrs?.size ||
    (rule?.options as any)?.size ||
    ctx.imageConfig?.size ||
    "max";

  const width =
    block.attrs?.width ||
    (rule?.options as any)?.width ||
    ctx.imageConfig?.width;

  const height =
    block.attrs?.height ||
    (rule?.options as any)?.height ||
    ctx.imageConfig?.height;

  const emuSize = calculateImageEmuSize(dims, { size, width, height, maxWidthPt: ctx.imageConfig?.maxWidth });

  const ext = path.extname(imagePath).replace(/^\./, "").toLowerCase() || dims.type;
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  const contentType = mimeMap[ext] || `image/${ext}`;

  const imageProps = (doc as any).createOrUpdateImage("word/document.xml", {
    props: {
      data: buffer,
      filename: path.basename(imagePath),
      contentType,
    },
  });
  const relId = imageProps.relId;

  const paragraphEl = ownerDoc.createElementNS(WORD_NS, "w:p");
  const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
  const jc = ownerDoc.createElementNS(WORD_NS, "w:jc");
  jc.setAttribute("w:val", align);
  pPr.appendChild(jc);
  paragraphEl.appendChild(pPr);

  const runEl = ownerDoc.createElementNS(WORD_NS, "w:r");
  const drawingEl = ownerDoc.createElementNS(WORD_NS, "w:drawing");

  const inlineEl = ownerDoc.createElementNS(WP_NS, "wp:inline");
  inlineEl.setAttribute("distT", "0");
  inlineEl.setAttribute("distB", "0");
  inlineEl.setAttribute("distL", "0");
  inlineEl.setAttribute("distR", "0");

  const extentEl = ownerDoc.createElementNS(WP_NS, "wp:extent");
  extentEl.setAttribute("cx", String(emuSize.cx));
  extentEl.setAttribute("cy", String(emuSize.cy));
  inlineEl.appendChild(extentEl);

  const effectExtentEl = ownerDoc.createElementNS(WP_NS, "wp:effectExtent");
  effectExtentEl.setAttribute("l", "0");
  effectExtentEl.setAttribute("t", "0");
  effectExtentEl.setAttribute("r", "0");
  effectExtentEl.setAttribute("b", "0");
  inlineEl.appendChild(effectExtentEl);

  const docPrEl = ownerDoc.createElementNS(WP_NS, "wp:docPr");
  docPrEl.setAttribute("id", String(ctx.docPrId));
  docPrEl.setAttribute("name", `Picture ${ctx.docPrId}`);
  inlineEl.appendChild(docPrEl);

  const cNvGraphicFramePr = ownerDoc.createElementNS(WP_NS, "wp:cNvGraphicFramePr");
  const locks = ownerDoc.createElementNS(A_NS, "a:graphicFrameLocks");
  locks.setAttribute("noChangeAspect", "1");
  cNvGraphicFramePr.appendChild(locks);
  inlineEl.appendChild(cNvGraphicFramePr);

  const graphic = ownerDoc.createElementNS(A_NS, "a:graphic");
  const graphicData = ownerDoc.createElementNS(A_NS, "a:graphicData");
  graphicData.setAttribute("uri", "http://schemas.openxmlformats.org/drawingml/2006/picture");

  const pic = ownerDoc.createElementNS(PIC_NS, "pic:pic");

  const nvPicPr = ownerDoc.createElementNS(PIC_NS, "pic:nvPicPr");
  const cNvPr = ownerDoc.createElementNS(PIC_NS, "pic:cNvPr");
  cNvPr.setAttribute("id", "0");
  cNvPr.setAttribute("name", path.basename(imagePath));
  nvPicPr.appendChild(cNvPr);
  const cNvPicPr = ownerDoc.createElementNS(PIC_NS, "pic:cNvPicPr");
  nvPicPr.appendChild(cNvPicPr);
  pic.appendChild(nvPicPr);

  const blipFill = ownerDoc.createElementNS(PIC_NS, "pic:blipFill");
  const blip = ownerDoc.createElementNS(A_NS, "a:blip");
  blip.setAttributeNS(R_NS, "r:embed", relId);
  blipFill.appendChild(blip);
  const stretch = ownerDoc.createElementNS(A_NS, "a:stretch");
  stretch.appendChild(ownerDoc.createElementNS(A_NS, "a:fillRect"));
  blipFill.appendChild(stretch);
  pic.appendChild(blipFill);

  const spPr = ownerDoc.createElementNS(PIC_NS, "pic:spPr");
  const xfrm = ownerDoc.createElementNS(A_NS, "a:xfrm");
  const off = ownerDoc.createElementNS(A_NS, "a:off");
  off.setAttribute("x", "0");
  off.setAttribute("y", "0");
  xfrm.appendChild(off);
  const extEl = ownerDoc.createElementNS(A_NS, "a:ext");
  extEl.setAttribute("cx", String(emuSize.cx));
  extEl.setAttribute("cy", String(emuSize.cy));
  xfrm.appendChild(extEl);
  spPr.appendChild(xfrm);

  const prstGeom = ownerDoc.createElementNS(A_NS, "a:prstGeom");
  prstGeom.setAttribute("prst", "rect");
  prstGeom.appendChild(ownerDoc.createElementNS(A_NS, "a:avLst"));
  spPr.appendChild(prstGeom);
  pic.appendChild(spPr);

  graphicData.appendChild(pic);
  graphic.appendChild(graphicData);
  inlineEl.appendChild(graphic);

  drawingEl.appendChild(inlineEl);
  runEl.appendChild(drawingEl);
  paragraphEl.appendChild(runEl);

  let captionEl: XmlElement | null = null;
  if (block.caption && block.caption.trim()) {
    const aiCaptionRef = (rule?.options as any)?.captionRef;
    const aiCaptionStyle = (rule?.options as any)?.captionStyle;
    const profileCaptionRule = matchRule(profile.rules, { type: "caption" } as any);
    const userCaptionStyle = block.attrs?.captionStyle || block.attrs?.style || ctx.imageConfig?.captionStyle;

    let targetStyleRef: StyleRef | undefined;
    if (aiCaptionRef) {
      targetStyleRef = typeof aiCaptionRef === "string" ? { anchor: aiCaptionRef } : aiCaptionRef;
    } else if (aiCaptionStyle) {
      targetStyleRef = typeof aiCaptionStyle === "string"
        ? (profile.styles?.[aiCaptionStyle] ? { recipe: aiCaptionStyle } : { styleName: aiCaptionStyle })
        : aiCaptionStyle;
    } else if (profileCaptionRule?.style) {
      targetStyleRef = profileCaptionRule.style;
    } else if (userCaptionStyle) {
      targetStyleRef = anchorRanges.has(userCaptionStyle)
        ? { anchor: userCaptionStyle }
        : profile.styles?.[userCaptionStyle]
        ? { recipe: userCaptionStyle }
        : { styleName: userCaptionStyle };
    }

    const captionSample = styleRefToSample(targetStyleRef ?? (rule?.style || profile.defaults?.style), profile, anchorRanges);

    const captionAlign =
      block.attrs?.captionAlign ||
      (rule?.options as any)?.captionAlign ||
      ctx.imageConfig?.captionAlign ||
      "center";

    if (captionSample && !captionSample.inline && captionSample.paragraphEl) {
      captionEl = captionSample.paragraphEl.cloneNode(true) as XmlElement;
      captionEl.removeAttribute("w14:paraId");
      captionEl.removeAttribute("w14:textId");
      for (const child of childElementsOf(captionEl)) {
        if (child.nodeName !== "w:pPr") captionEl.removeChild(child);
      }
      let cPPr = childElementsOf(captionEl).find((c) => c.nodeName === "w:pPr");
      if (!cPPr) {
        cPPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
        captionEl.insertBefore(cPPr, captionEl.firstChild);
      }
      let cJc = childElementsOf(cPPr).find((c) => c.nodeName === "w:jc");
      if (!cJc) {
        cJc = ownerDoc.createElementNS(WORD_NS, "w:jc");
        cPPr.appendChild(cJc);
      }
      cJc.setAttribute("w:val", captionAlign);

      const cRun = cloneRunWithText(captionSample.runEl as XmlElement, block.caption);
      captionEl.appendChild(cRun);
    } else {
      captionEl = ownerDoc.createElementNS(WORD_NS, "w:p");
      const cPPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
      const cJc = ownerDoc.createElementNS(WORD_NS, "w:jc");
      cJc.setAttribute("w:val", captionAlign);
      cPPr.appendChild(cJc);
      captionEl.appendChild(cPPr);

      const cRun = ownerDoc.createElementNS(WORD_NS, "w:r");
      const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
      const sz = ownerDoc.createElementNS(WORD_NS, "w:sz");
      sz.setAttribute("w:val", "21"); // 10.5pt (五号)
      rPr.appendChild(sz);
      cRun.appendChild(rPr);

      const t = ownerDoc.createElementNS(WORD_NS, "w:t");
      t.textContent = block.caption;
      cRun.appendChild(t);
      captionEl.appendChild(cRun);
    }
  }

  return { paragraphEl, captionEl };
}

function buildTableElement(
  ownerDoc: XmlElement,
  block: MarkdownBlock,
  rule: TemplateRule | null | undefined,
  profile: TemplateProfile,
  anchorRanges: Map<string, BookmarkRange>,
  ctx: {
    tableConfig?: TableBlockConfig;
    config?: ReportConfig;
    sample: XmlElement | null;
  },
): XmlElement {
  const rows = block.rows || [];
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const alignments = block.alignments || [];

  const theme =
    block.attrs?.theme ||
    (rule?.options as any)?.theme ||
    ctx.tableConfig?.theme ||
    "academic";

  const headerOpt =
    block.attrs?.header !== undefined
      ? block.attrs.header !== "false"
      : (rule?.options as any)?.header !== undefined
      ? (rule?.options as any).header !== false
      : ctx.tableConfig?.header !== undefined
      ? ctx.tableConfig.header !== false
      : true;

  const hasHeader = headerOpt && rows.length > 0;

  const tableAlign =
    block.attrs?.align ||
    (rule?.options as any)?.align ||
    ctx.tableConfig?.align ||
    "center";

  const tbl = ownerDoc.createElementNS(WORD_NS, "w:tbl");

  // tblPr
  const tblPr = ownerDoc.createElementNS(WORD_NS, "w:tblPr");
  const tblW = ownerDoc.createElementNS(WORD_NS, "w:tblW");
  tblW.setAttribute("w:w", "5000");
  tblW.setAttribute("w:type", "pct");
  tblPr.appendChild(tblW);

  const jc = ownerDoc.createElementNS(WORD_NS, "w:jc");
  jc.setAttribute("w:val", tableAlign);
  tblPr.appendChild(jc);

  // Table borders according to theme
  const tblBorders = ownerDoc.createElementNS(WORD_NS, "w:tblBorders");
  const applyBorder = (side: string, val: string, sz?: string, color?: string) => {
    const b = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    b.setAttribute("w:val", val);
    if (sz) b.setAttribute("w:sz", sz);
    if (color) b.setAttribute("w:color", color);
    b.setAttribute("w:space", "0");
    tblBorders.appendChild(b);
  };

  if (theme === "academic") {
    // 三线表：顶底 1.5pt (sz=12)，无左右边框，无垂直线，无内部横线（栏目线在 header 单元格单独加）
    applyBorder("top", "single", "12", "000000");
    applyBorder("bottom", "single", "12", "000000");
    applyBorder("left", "none");
    applyBorder("right", "none");
    applyBorder("insideH", "none");
    applyBorder("insideV", "none");
  } else if (theme === "grid") {
    // 细网格：四周及内部 0.5pt (sz=4)
    applyBorder("top", "single", "4", "CCCCCC");
    applyBorder("bottom", "single", "4", "CCCCCC");
    applyBorder("left", "single", "4", "CCCCCC");
    applyBorder("right", "single", "4", "CCCCCC");
    applyBorder("insideH", "single", "4", "E0E0E0");
    applyBorder("insideV", "single", "4", "E0E0E0");
  } else if (theme === "striped") {
    // 斑马纹：顶底 1pt (sz=8)，内部横线 0.5pt (sz=4)，无坚线
    applyBorder("top", "single", "8", "666666");
    applyBorder("bottom", "single", "8", "666666");
    applyBorder("left", "none");
    applyBorder("right", "none");
    applyBorder("insideH", "single", "4", "EEEEEE");
    applyBorder("insideV", "none");
  } else {
    // clean / 极简
    applyBorder("top", "single", "6", "999999");
    applyBorder("bottom", "single", "6", "999999");
    applyBorder("left", "none");
    applyBorder("right", "none");
    applyBorder("insideH", "single", "4", "F0F0F0");
    applyBorder("insideV", "none");
  }
  tblPr.appendChild(tblBorders);

  // Cell padding
  const tblCellMar = ownerDoc.createElementNS(WORD_NS, "w:tblCellMar");
  for (const side of ["top", "bottom"]) {
    const m = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    m.setAttribute("w:w", "120"); // 6pt
    m.setAttribute("w:type", "dxa");
    tblCellMar.appendChild(m);
  }
  for (const side of ["left", "right"]) {
    const m = ownerDoc.createElementNS(WORD_NS, `w:${side}`);
    m.setAttribute("w:w", "160"); // 8pt
    m.setAttribute("w:type", "dxa");
    tblCellMar.appendChild(m);
  }
  tblPr.appendChild(tblCellMar);
  tbl.appendChild(tblPr);

  // tblGrid
  const tblGrid = ownerDoc.createElementNS(WORD_NS, "w:tblGrid");
  const colWidthPct = Math.floor(5000 / colCount);
  for (let c = 0; c < colCount; c += 1) {
    const gridCol = ownerDoc.createElementNS(WORD_NS, "w:gridCol");
    gridCol.setAttribute("w:w", String(colWidthPct));
    tblGrid.appendChild(gridCol);
  }
  tbl.appendChild(tblGrid);

  // Render rows
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const isHeader = hasHeader && r === 0;

    const tr = ownerDoc.createElementNS(WORD_NS, "w:tr");
    const trPr = ownerDoc.createElementNS(WORD_NS, "w:trPr");
    const cantSplit = ownerDoc.createElementNS(WORD_NS, "w:cantSplit");
    trPr.appendChild(cantSplit);
    if (isHeader) {
      trPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:tblHeader"));
    }
    tr.appendChild(trPr);

    for (let c = 0; c < colCount; c += 1) {
      const cellText = row[c] ?? "";
      const colAlign = alignments[c] ?? (isHeader ? "center" : "left");

      const tc = ownerDoc.createElementNS(WORD_NS, "w:tc");
      const tcPr = ownerDoc.createElementNS(WORD_NS, "w:tcPr");
      const tcW = ownerDoc.createElementNS(WORD_NS, "w:tcW");
      tcW.setAttribute("w:w", String(colWidthPct));
      tcW.setAttribute("w:type", "pct");
      tcPr.appendChild(tcW);

      const vAlign = ownerDoc.createElementNS(WORD_NS, "w:vAlign");
      vAlign.setAttribute("w:val", "center");
      tcPr.appendChild(vAlign);

      let bgColor: string | undefined;
      if (isHeader) {
        if (theme === "grid") bgColor = "F2F2F2";
        else if (theme === "striped") bgColor = "EAEAEA";
      } else if (theme === "striped" && r % 2 === 0) {
        bgColor = "FAFAFA";
      }
      if (bgColor) {
        const shd = ownerDoc.createElementNS(WORD_NS, "w:shd");
        shd.setAttribute("w:val", "clear");
        shd.setAttribute("w:color", "auto");
        shd.setAttribute("w:fill", bgColor);
        tcPr.appendChild(shd);
      }

      if (theme === "academic" && isHeader) {
        const tcBorders = ownerDoc.createElementNS(WORD_NS, "w:tcBorders");
        const bBottom = ownerDoc.createElementNS(WORD_NS, "w:bottom");
        bBottom.setAttribute("w:val", "single");
        bBottom.setAttribute("w:sz", "6");
        bBottom.setAttribute("w:space", "0");
        bBottom.setAttribute("w:color", "000000");
        tcBorders.appendChild(bBottom);
        tcPr.appendChild(tcBorders);
      }

      tc.appendChild(tcPr);

      const p = ownerDoc.createElementNS(WORD_NS, "w:p");
      const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
      const jc = ownerDoc.createElementNS(WORD_NS, "w:jc");
      jc.setAttribute("w:val", colAlign);
      pPr.appendChild(jc);
      p.appendChild(pPr);

      const run = ownerDoc.createElementNS(WORD_NS, "w:r");
      const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
      const sz = ownerDoc.createElementNS(WORD_NS, "w:sz");
      sz.setAttribute("w:val", "21"); // 10.5pt (五号)
      rPr.appendChild(sz);
      if (isHeader) {
        rPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:b"));
      }
      run.appendChild(rPr);

      const t = ownerDoc.createElementNS(WORD_NS, "w:t");
      t.textContent = cellText;
      run.appendChild(t);
      p.appendChild(run);

      tc.appendChild(p);
      tr.appendChild(tc);
    }

    tbl.appendChild(tr);
  }

  return tbl;
}

function splitFrontmatter(markdown: string): { body: string; profile?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { body: markdown };
  let profile: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = /^\s*profile\s*:\s*(.+?)\s*$/.exec(line);
    if (parsed) profile = parsed[1];
  }
  return { body: markdown.slice(match[0].length), profile };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ------------------------------ 链接 / DOM ------------------------------ */

/** 建一个 `w:hyperlink` 外壳；外部链接顺带补 part 关系，失败返回 null。 */
function createHyperlinkShell(doc: VirtualWordDocument, ownerDoc: XmlElement, link: string): XmlElement | null {
  const hyperlink = ownerDoc.createElementNS(WORD_NS, "w:hyperlink");
  if (link.startsWith("#")) {
    hyperlink.setAttribute("w:anchor", link.slice(1));
  } else {
    const relId = ensureHyperlinkRel(doc, ownerDoc, link);
    if (!relId) return null;
    hyperlink.setAttributeNS(R_NS, "r:id", relId);
  }
  return hyperlink;
}

function ensureHyperlinkRel(doc: VirtualWordDocument, ownerDoc: XmlElement, url: string): string | null {
  const anyDoc = doc as unknown as { getRelationships?: (path: string) => any; partsData?: Array<{ path: string; xmlDocument: any }> };
  if (typeof anyDoc.getRelationships !== "function" || !Array.isArray(anyDoc.partsData)) return null;
  const partPath = anyDoc.partsData.find((part) => part.xmlDocument === ownerDoc)?.path;
  if (!partPath) return null;

  let rels: any;
  try {
    rels = anyDoc.getRelationships(partPath);
  } catch {
    return null;
  }
  if (!rels?.relationships) return null;

  for (const rel of rels.relationships.values()) {
    if (rel?.target === url && String(rel.type ?? "").includes("hyperlink")) return rel.id;
  }

  let max = 0;
  for (const key of rels.relationships.keys()) {
    const n = Number.parseInt(String(key).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const id = `rId${max + 1}`;
  rels.relationships.set(id, {
    id,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    target: url,
    targetMode: "External",
    partPath,
  });
  return id;
}

function childElementsOf(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = element?.childNodes;
  if (!nodes) return out;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.nodeType === 1) out.push(nodes[i]);
  }
  return out;
}

function createWordElement(reference: XmlElement, name: string): XmlElement {
  return reference.ownerDocument.createElementNS(WORD_NS, name);
}
