import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { VirtualWordDocument } from "docx-edit";
import { openDocx } from "./docx.ts";
import {
  cloneRunWithText,
  createParagraphFromStyles,
  createRunFromStyles,
  replaceRunStyle,
  writeRunElements,
  type InlineRun,
} from "./edits.ts";
import type { StyleObject } from "./types.ts";
import { insertBookmarkPair, readAnchors, runsBetween, stripAnchors, type BookmarkRange } from "./stamp.ts";
import { resolveProfile, type StyleRef, type TemplateInfo, type TemplateProfile, type TemplateRule } from "./template.ts";
import { highlightCode } from "./highlight.ts";
import { loadCodeThemeSync, parseFontSizeToHalfPoints, type CodeTokenStyle } from "./code-theme.ts";
import {
  resolveReportConfigSync,
  type CodeBlockConfig,
  type FormatConfig,
  type ImageBlockConfig,
  type ReportConfig,
  type TableBlockConfig,
} from "./config.ts";
import { fitFontSize } from "./code-fit.ts";
import {
  formatCjkSpacing,
  isCjkSpacingActive,
  resolveCjkSpacing,
  type ResolvedCjkSpacing,
} from "./typography.ts";
import { calculateImageEmuSize, getImageDimensions } from "./image-size.ts";
import { stripCommentElements, stripDocumentComments } from "./comments.ts";
import {
  A_NS,
  childElementsOf,
  createWordElement,
  PIC_NS,
  R_NS,
  WORD_NS,
  WP_NS,
  type XmlElement,
} from "./ooxml.ts";
import { enableDocxUpdateFields, findHeadingBookmarkName, updateTableOfContents } from "./toc.ts";
import {
  buildUserSettings,
  codeAttrsForceCard,
  resolveCodeSettings,
  isDocumentStyleRef,
  resolveImageSettings,
  resolveTableSettings,
  type CodeSettings,
  type ImageSettings,
  type TableSettings,
  type UserSettings,
} from "./settings.ts";

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
  /** 解析阶段发现的可疑写法（如把程序输出写进 ```text 被逐行展开成正文）。 */
  warnings: string[];
}

export interface RenderOptions {
  profile?: string;
  strip?: boolean;
  /** 是否清理批注（默认由模板配置或 options.strip 决定，设为 false 可保留批注）。 */
  stripComments?: boolean;
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
  /** 代码块排版模式（覆盖 config.code.mode）：auto / native / card。 */
  codeMode?: "auto" | "native" | "card";
  /** 中英文空格排版（覆盖 config.format）：cjkSpacing 预设与 lspace / rspace。 */
  format?: FormatConfig;
  /** 严格模式：缺图直接报错；renderTemplateFile 在有任何警告时报错且不写出成稿。 */
  strict?: boolean;
  /** 只渲染与统计，不写出文件（renderTemplateFile 生效）。 */
  dryRun?: boolean;
  /** 合并后的使用者层设置（由 renderTemplate 计算，调用方无需传）。 */
  user?: UserSettings;
}

/** 单个 Markdown 块的渲染记录（供 --json / 自检使用，免去解析 XML）。 */
export interface RenderTraceEntry {
  index: number;
  type: BlockType;
  /** 文本预览（最多 40 字）。 */
  text: string;
  ref?: string;
  /** inserted：新插入；updated：改写了已有段落；fill：按填空处理；placeholder：缺资源已占位；skipped：未渲染。 */
  status: "inserted" | "updated" | "fill" | "placeholder" | "skipped";
  /** 代码块：实际选用的排版模式。 */
  mode?: "native" | "card";
  /** 代码/表格主题。 */
  theme?: string;
  /** 样式来源（anchor:hrseg0012 / recipe:body / inline / style:Heading1 / default）。 */
  style?: string;
  /** 插入的段落/表格元素数。 */
  elements?: number;
  /** 跳过或降级原因。 */
  note?: string;
}

export interface RenderStats {
  /** 就地填空数。 */
  filled: number;
  /** 渲染成功的 Markdown 块数（不含填空）。 */
  blocks: number;
  /** 插入的段落/表格元素总数。 */
  elements: number;
  headings: number;
  paragraphs: number;
  lists: number;
  tables: number;
  images: number;
  codeNative: number;
  codeCard: number;
  /** 缺失图片（已用占位段落代替）。 */
  missingImages: string[];
  skipped: number;
}

export interface RenderResult {
  profile: string;
  filled: number;
  inserted: number;
  warnings: string[];
  fills: RenderFill[];
  blocks: MarkdownBlock[];
  /** 模板是否包含目录（TOC）——成稿后需用户在 Word/WPS 中「更新目录/更新域」。 */
  hasToc: boolean;
  /** 逐块渲染记录。 */
  trace: RenderTraceEntry[];
  /** 汇总统计。 */
  stats: RenderStats;
  /** 实际加载的渲染配置文件（未找到则为 undefined）。 */
  configSource?: string;
  /** 生效的中英文空格设置（未启用时为 undefined）。 */
  cjkSpacing?: ResolvedCjkSpacing;
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
  const parseWarnings: string[] = [];
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
      if (isPureTextCodeBlock(lang, codeText, attrs) && !codeAttrsForceCard(attrs)) {
        const nonBlank = buffer.filter((l) => l.trim().length > 0);
        // ```text 会被逐行展开成比例字体正文，空行与空格对齐都会丢；像程序输出/日志的多行块要提醒。
        if (nonBlank.length >= 4 || nonBlank.some((l) => /\S {3,}\S/.test(l))) {
          parseWarnings.push(
            `第 ${i - buffer.length} 行起的 \`\`\`${lang} 块被当作纯文本正文逐行展开（${nonBlank.length} 行，丢弃空行与对齐空格）；` +
              `若是程序输出/日志，请改用 \`\`\`console 或加 {mode=card}`,
          );
        }
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
        attrs,
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

  return { profile: docDefault, blocks, fills, warnings: parseWarnings };
}

/** CLI/API 选项优先于配置文件；只覆盖有值的键。 */
function mergeFormat(config: FormatConfig | undefined, cli: FormatConfig | undefined): FormatConfig {
  const pick = (v: string | undefined): string | undefined => (v === undefined || v === "" ? undefined : v);
  return {
    cjkSpacing: pick(cli?.cjkSpacing) ?? pick(config?.cjkSpacing),
    lspace: pick(cli?.lspace) ?? pick(config?.lspace),
    rspace: pick(cli?.rspace) ?? pick(config?.rspace),
  };
}

/**
 * 对解析后的块套用中英文空格排版。代码块、水平线不动；` ```text ` 展开的纯文本段落（带 rawRuns）是
 * “原样照搬”语义（如参考文献），同样不动。
 */
export function applySpacingToBlocks(blocks: MarkdownBlock[], spacing: ResolvedCjkSpacing): void {
  const fmt = (text: string): string => formatCjkSpacing(text, spacing);
  for (const block of blocks) {
    if (block.type === "code" || block.type === "hr" || block.rawRuns) continue;
    block.text = fmt(block.text);
    if (block.caption) block.caption = fmt(block.caption);
    for (const item of block.items ?? []) item.text = fmt(item.text);
    if (block.rows) block.rows = block.rows.map((row) => row.map(fmt));
  }
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
  // 使用者层一次性合并：CLI/API 选项 > --extra > 配置文件（覆盖准则见 settings.ts）
  const user = buildUserSettings(effectiveConfig, {
    code: {
      ...(options.codeConfig ?? {}),
      template: options.codeTemplate ?? options.codeConfig?.template,
      mode: options.codeMode ?? options.codeConfig?.mode,
      lineNumbers: options.showLineNumbers ?? options.codeConfig?.lineNumbers,
    },
    image: options.imageConfig,
    table: options.tableConfig,
  });
  const effectiveOptions: RenderOptions = { ...options, config: effectiveConfig, user };
  const parsed = parseDocument(markdown, effectiveOptions);
  const warnings: string[] = [...parsed.warnings];
  const spacing = resolveCjkSpacing(mergeFormat(effectiveConfig.format, options.format));
  if (isCjkSpacingActive(spacing)) applySpacingToBlocks(parsed.blocks, spacing);
  for (const fill of parsed.fills) {
    if (/^\s*【[^】]+】\s*$/.test(fill.text)) warnings.push(`填空 ${fill.ref} 仍是占位标记 ${fill.text.trim()}，请替换成真实内容`);
  }
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
  const trace: RenderTraceEntry[] = [];
  if (effectiveOptions.structured ?? true) {
    inserted = renderBlocks(
      doc,
      info,
      parsed,
      anchorRanges,
      warnings,
      effectiveOptions.appendUnanchored ?? false,
      effectiveOptions,
      trace,
    );
  }

  if (options.strip ?? true) {
    stripAnchors(doc, info.anchorPrefix);
  }

  const shouldStripComments = options.stripComments ?? info.stripComments ?? (options.strip ?? true);
  if (shouldStripComments) {
    stripCommentElements(doc);
  }

  return {
    profile: parsed.profile ?? info.defaultProfile,
    filled,
    inserted,
    warnings,
    fills: parsed.fills,
    blocks: parsed.blocks,
    hasToc: Boolean(info.toc?.enabled),
    trace,
    stats: summarizeTrace(trace, filled),
    configSource: effectiveConfig.source,
    ...(isCjkSpacingActive(spacing) ? { cjkSpacing: spacing } : {}),
  };
}

/** 由逐块记录汇总统计。 */
export function summarizeTrace(trace: readonly RenderTraceEntry[], filled: number): RenderStats {
  const stats: RenderStats = {
    filled,
    blocks: 0,
    elements: 0,
    headings: 0,
    paragraphs: 0,
    lists: 0,
    tables: 0,
    images: 0,
    codeNative: 0,
    codeCard: 0,
    missingImages: [],
    skipped: 0,
  };
  for (const entry of trace) {
    if (entry.status === "skipped") {
      stats.skipped += 1;
      continue;
    }
    if (entry.status === "fill") continue;
    stats.blocks += 1;
    stats.elements += entry.elements ?? 0;
    if (entry.status === "placeholder" && entry.type === "image") {
      stats.missingImages.push(entry.note ?? entry.text);
      continue;
    }
    switch (entry.type) {
      case "heading":
        stats.headings += 1;
        break;
      case "list":
        stats.lists += 1;
        break;
      case "table":
        stats.tables += 1;
        break;
      case "image":
        stats.images += 1;
        break;
      case "code":
        if (entry.mode === "native") stats.codeNative += 1;
        else stats.codeCard += 1;
        break;
      default:
        stats.paragraphs += 1;
    }
  }
  return stats;
}

function describeStyleRef(ref: StyleRef | undefined): string {
  if (!ref) return "default";
  if ("anchor" in ref) return `anchor:${ref.anchor}`;
  if ("recipe" in ref) return `recipe:${ref.recipe}`;
  if ("inline" in ref) return "inline";
  if ("ooxmlStyleId" in ref) return `style:${ref.ooxmlStyleId}`;
  if ("styleName" in ref) return `style:${ref.styleName}`;
  return "default";
}

function hasVisibleTextBefore(p: XmlElement, node: XmlElement): boolean {
  let child = p.firstChild;
  while (child && child !== node) {
    if (child.nodeName === "w:r" || child.nodeName === "w:hyperlink") {
      const text = child.textContent?.replace(/\s+/g, "");
      if (text && text.length > 0) return true;
    }
    child = child.nextSibling;
  }
  return false;
}

function splitParagraphBeforeAnchor(
  anchorRange: BookmarkRange,
  info: TemplateInfo,
  anchorRanges: Map<string, BookmarkRange>,
): XmlElement | null {
  const p = anchorRange.paragraphEl;
  const splitTarget = anchorRange.start;
  const ownerDoc = p.ownerDocument;

  let child = p.firstChild;
  let lastRunBefore: XmlElement | null = null;
  while (child && child !== splitTarget) {
    if (child.nodeName === "w:r" || child.nodeName === "w:hyperlink") {
      if (child.textContent?.replace(/\s+/g, "").length > 0) {
        lastRunBefore = child;
      }
    }
    child = child.nextSibling;
  }
  if (!lastRunBefore) return null;

  let firstRunAfter: XmlElement | null = null;
  child = splitTarget;
  while (child) {
    if (child.nodeName === "w:r" || child.nodeName === "w:hyperlink") {
      if (child.textContent?.replace(/\s+/g, "").length > 0) {
        firstRunAfter = child;
        break;
      }
    }
    child = child.nextSibling;
  }

  const bookmarkStartsBefore = new Set<string>();
  child = p.firstChild;
  while (child && child !== lastRunBefore.nextSibling) {
    if (child.nodeName === "w:bookmarkStart") {
      const id = child.getAttribute?.("w:id") || child.getAttribute?.("id");
      if (id) bookmarkStartsBefore.add(id);
    }
    child = child.nextSibling;
  }

  const p1BookmarkEnds: XmlElement[] = [];
  child = lastRunBefore.nextSibling;
  while (child && child !== firstRunAfter) {
    if (child.nodeName === "w:bookmarkEnd") {
      const id = child.getAttribute?.("w:id") || child.getAttribute?.("id");
      if (id && bookmarkStartsBefore.has(id)) {
        p1BookmarkEnds.push(child);
      }
    }
    child = child.nextSibling;
  }

  let insertAnchor = lastRunBefore;
  for (const endNode of p1BookmarkEnds) {
    if (endNode.previousSibling !== insertAnchor) {
      p.insertBefore(endNode, insertAnchor.nextSibling);
    }
    insertAnchor = endNode;
  }

  const cutNode = insertAnchor.nextSibling;
  if (!cutNode) return null;

  const p2 = ownerDoc.createElementNS(WORD_NS, "w:p");
  const pPr = p.getElementsByTagName?.("w:pPr")?.[0];
  if (pPr) {
    const pPr2 = pPr.cloneNode(true);
    const anchorMeta = info.anchors?.[anchorRange.ref];
    const isSubHeading =
      anchorMeta?.tags?.some((t) => t === "heading2" || t === "heading3" || t === "heading4") ||
      anchorMeta?.label?.includes("节标题");
    if (isSubHeading) {
      const jc = pPr2.getElementsByTagName?.("w:jc")?.[0];
      if (jc) jc.parentNode?.removeChild(jc);
    }
    p2.appendChild(pPr2);
  }

  let curr = cutNode;
  while (curr) {
    const next = curr.nextSibling;
    p2.appendChild(curr);
    curr = next;
  }

  p.parentNode.insertBefore(p2, p.nextSibling);

  for (const ar of anchorRanges.values()) {
    if (ar.paragraphEl === p) {
      if (ar.start.parentNode === p2) {
        ar.paragraphEl = p2;
        if (ar.end && ar.end.parentNode === p2) {
          ar.runEls = runsBetween(p2, ar.start, ar.end);
        }
      } else {
        if (ar.end && ar.end.parentNode === p) {
          ar.runEls = runsBetween(p, ar.start, ar.end);
        }
      }
    }
  }

  return p2;
}

function normalizeGluedParagraphAnchors(
  parsed: ParsedDocument,
  info: TemplateInfo,
  anchorRanges: Map<string, BookmarkRange>,
): void {
  for (const block of parsed.blocks) {
    if (!block.ref) continue;
    const range = anchorRanges.get(block.ref);
    if (!range) continue;
    if (hasVisibleTextBefore(range.paragraphEl, range.start)) {
      splitParagraphBeforeAnchor(range, info, anchorRanges);
    }
  }

  for (const range of anchorRanges.values()) {
    const meta = info.anchors?.[range.ref];
    const isHeading =
      meta?.tags?.some((t) => t.startsWith("heading")) ||
      meta?.label?.includes("章标题") ||
      meta?.label?.includes("节标题");
    if (isHeading && hasVisibleTextBefore(range.paragraphEl, range.start)) {
      splitParagraphBeforeAnchor(range, info, anchorRanges);
    }
  }
}

function renderBlocks(
  doc: VirtualWordDocument,
  info: TemplateInfo,
  parsed: ParsedDocument,
  anchorRanges: Map<string, BookmarkRange>,
  warnings: string[],
  appendUnanchored: boolean,
  options: RenderOptions = {},
  trace: RenderTraceEntry[] = [],
): number {
  let count = 0;
  const tocEnabled = Boolean(info.toc?.enabled);
  let cursorLast: XmlElement | null = null;
  let cursorFallback: XmlElement | null = null;
  const profileCache = new Map<string, TemplateProfile>();
  const defaultContainer = findDefaultContainer(anchorRanges);
  const ownerDoc: XmlElement =
    defaultContainer?.ownerDocument ?? (anchorRanges.values().next().value as BookmarkRange | undefined)?.paragraphEl?.ownerDocument;

  normalizeGluedParagraphAnchors(parsed, info, anchorRanges);

  const renderedHeadings: Array<{ level: number; text: string; bookmarkName: string }> = [];
  let headingBookmarkCounter = 0;

  const recordHeading = (block: MarkdownBlock, paragraphEl: XmlElement) => {
    const level = block.level ?? 1;
    const text = block.text.trim();
    if (!text) return;

    // 无目录的模板不需要 TOC 书签，避免与用户后续手工插入的书签混杂
    if (!tocEnabled) return;
    let bookmarkName = findHeadingBookmarkName(paragraphEl);
    if (!bookmarkName) {
      headingBookmarkCounter += 1;
      bookmarkName = `_Toc_hr_${headingBookmarkCounter}`;
      const runs = childElementsOf(paragraphEl).filter((el) => el.nodeName === "w:r");
      const firstRun = runs[0] ?? paragraphEl.firstChild;
      const lastRun = runs[runs.length - 1] ?? paragraphEl.lastChild;
      if (firstRun && lastRun) {
        insertBookmarkPair(paragraphEl, firstRun, lastRun, `toc_bm_${headingBookmarkCounter}`, bookmarkName);
      }
    }
    renderedHeadings.push({ level, text, bookmarkName });
  };

  for (const [blockIndex, block] of parsed.blocks.entries()) {
    const entry: RenderTraceEntry = {
      index: blockIndex,
      type: block.type,
      text: previewText(block),
      ...(block.ref ? { ref: block.ref } : {}),
      status: "skipped",
    };
    trace.push(entry);
    const countBefore = count;
    const skip = (note: string): void => {
      warnings.push(note);
      entry.note = note;
    };
    if (block.type === "paragraph" && !block.rawRuns && (FILL_ONLY.test(block.text) || HAS_REF_LINK.test(block.text))) {
      entry.status = "fill"; // ref 链接按填空处理
      continue;
    }


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
        skip(`未知 ref: ${block.ref}（${describeBlock(block)}）`);
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
      skip(`${describeBlock(block)} 没有 ref 也没有前置锚点，已跳过（可给它加 {ref:锚点}，或用 appendUnanchored 追加到文末）`);
      continue;
    }
    if (!container) {
      skip(`${describeBlock(block)} 的插入位置无效，已跳过`);
      continue;
    }
    entry.style = describeStyleRef(rule?.style ?? profile.defaults?.style ?? profile.styles?.body);

    const sample =
      styleRefToSample(rule?.style ?? profile.defaults?.style, profile, anchorRanges) ??
      styleRefToSample(profile.styles?.body, profile, anchorRanges) ??
      { inline: { paragraph: { styleId: "Normal" } } };

    // 骨架把已有标题再写一遍（带 {ref}）。
    // 1) 若文本一致：不重复插入，作为后续游标；
    // 2) 若文本被用户修改（如「实验6」改成「实验1」）：直接改写原标题段落的文本，不重复插入新段落。
    if (block.type === "heading" && block.ref) {
      const range = anchorRanges.get(block.ref);
      if (range) {
        const existingText = paragraphText(range.paragraphEl).replace(/\s+/g, "");
        const wanted = block.text.replace(/\s+/g, "");
        if (existingText !== wanted) {
          const allRuns = childElementsOf(range.paragraphEl).filter((el) => el.nodeName === "w:r");
          if (allRuns.length > 0) {
            writeRunElements(allRuns, block.text, "replace");
          } else if (range.runEls.length > 0) {
            writeRunElements(range.runEls, block.text, "replace");
          }
        }
        // 校准标题样式：如果规则指定了该 level 对应的样式（例如 Heading1），但原段落被误设为了其他样式（如 Heading2），
        // 自动将原段落的 w:pStyle 校准为规范样式，以确保在 Word/WPS 中点击「更新目录」时层级一致正确。
        const targetStyleId =
          sample?.inline?.paragraph?.styleId ??
          sample?.paragraphEl?.getElementsByTagName("w:pStyle")?.[0]?.getAttribute("w:val");
        if (targetStyleId) {
          let pPr = range.paragraphEl.getElementsByTagName("w:pPr")?.[0];
          if (!pPr) {
            pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
            range.paragraphEl.insertBefore(pPr, range.paragraphEl.firstChild);
          }
          let pStyle = pPr.getElementsByTagName("w:pStyle")?.[0];
          if (pStyle) {
            pStyle.setAttribute("w:val", targetStyleId);
          } else {
            pStyle = ownerDoc.createElementNS(WORD_NS, "w:pStyle");
            pStyle.setAttribute("w:val", targetStyleId);
            pPr.insertBefore(pStyle, pPr.firstChild);
          }
        }
        ensureOutlineLevel(range.paragraphEl, block.level ?? 1);
        recordHeading(block, range.paragraphEl);
        cursorLast = range.paragraphEl;
        cursorFallback = container;
        entry.status = "updated";
        entry.elements = 0;
        continue;
      }
    }

    if (block.type === "code") {
      const settings = resolveCodeSettings({
        attrs: block.attrs ?? {},
        blockTheme: block.theme,
        rule,
        user: options.user?.code,
        hasDocumentStyle: Boolean(sample && (isDocumentStyleRef(rule?.style) || isDocumentStyleRef(profile.styles?.code))),
      });
      for (const w of settings.warnings) if (!warnings.includes(w)) warnings.push(w);
      const useNative = settings.mode.value === "native";
      entry.mode = settings.mode.value;
      if (!useNative) entry.theme = settings.theme.value;
      if (settings.note) entry.note = settings.note;

      if (useNative) {
        // 模式 A：文档已明确代码样式（XML Style ID），套用原文档样式，按 lint 设置进行语法着色
        const { lastEl, lineCount } = renderStyledCodeParagraphs(
          block,
          settings,
          sample!,
          container,
          refNode,
          ownerDoc,
        );
        if (lastEl) {
          cursorLast = lastEl;
          if (anchored) cursorFallback = container;
        }
        count += lineCount;
        entry.status = "inserted";
        entry.elements = lineCount;
        continue;
      } else {
        // 模式 B：代码卡片表格（CodeInWord 风格，带行号栏、外边框与主题底色）
        // 字体优先复制文档正文样式（中文/西文分别取 eastAsia/ascii），显式设置才覆盖
        const bodyRuleStyle = (profile.rules ?? []).find((r) => r.match?.type === "paragraph")?.style;
        const bodySample =
          styleRefToSample(profile.styles?.body, profile, anchorRanges) ?? styleRefToSample(bodyRuleStyle, profile, anchorRanges);
        const codeTable = buildCodeTable(block, settings, sample, ownerDoc, extractSampleFont(bodySample), (kind, message) => {
          if (kind === "shrunk") entry.note = entry.note ? `${entry.note}；${message}` : message;
          else if (!warnings.includes(message)) warnings.push(message);
        });
        container.insertBefore(codeTable, refNode);
        cursorLast = codeTable;
        if (anchored) cursorFallback = container;
        count += 1;
        entry.status = "inserted";
        entry.elements = 1;
        continue;
      }
    }

    if (block.type === "image") {
      const imagePath = resolveImagePath(block.src ?? "", options.markdownDir);
      if (!imagePath) {
        const message = `图片文件未找到: ${block.src}${options.markdownDir ? `（相对 ${options.markdownDir} 解析）` : ""}`;
        if (options.strict) throw new Error(message);
        // 默认降级：插一段醒目的占位文字（含图注），不中断整份渲染
        const caption = block.caption?.trim();
        const placeholder = buildParagraph(
          sample,
          [{ text: `【缺图：${block.src}】${caption ? ` ${caption}` : ""}`, color: "FF0000" }],
          null,
          () => null,
          ownerDoc,
        );
        setParagraphAlign(placeholder, "center");
        container.insertBefore(placeholder, refNode);
        cursorLast = placeholder;
        if (anchored) cursorFallback = container;
        count += 1;
        warnings.push(`${message}，已插入占位文字（--strict 时报错）`);
        entry.status = "placeholder";
        entry.elements = 1;
        entry.note = block.src;
        continue;
      }
      const { paragraphEl, captionEl } = buildImageElement(
        ownerDoc,
        doc,
        block,
        rule,
        profile,
        anchorRanges,
        {
          settings: resolveImageSettings({ attrs: block.attrs ?? {}, rule, user: options.user?.image }),
          imagePath,
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
      entry.status = "inserted";
      entry.elements = captionEl ? 2 : 1;
      continue;
    }

    if (block.type === "table") {
      const tableSettings = resolveTableSettings({ attrs: block.attrs ?? {}, rule, user: options.user?.table });
      const tableEl = buildTableElement(
        ownerDoc,
        block,
        anchorRanges,
        tableSettings,
      );
      container.insertBefore(tableEl, refNode);
      cursorLast = tableEl;
      if (anchored) cursorFallback = container;
      count += 1;
      entry.status = "inserted";
      entry.elements = 1;
      entry.theme = tableSettings.styleAnchor ? `sample:${tableSettings.styleAnchor}` : tableSettings.theme.value;
      delete entry.style; // 表格样式由主题/样板表决定，不走段落样式
      continue;
    }

    if (!sample) {
      skip(`${describeBlock(block)} 找不到可用样式（rules/profile 未覆盖），已跳过`);
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
      entry.status = "inserted";
      entry.elements = 1;
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
      if (block.type === "heading") {
        ensureOutlineLevel(paragraphEl, block.level ?? 1);
        recordHeading(block, paragraphEl);
      }
      last = paragraphEl;
      count += 1;
    }

    if (last) {
      cursorLast = last;
      if (anchored) cursorFallback = container;
    }
    entry.status = "inserted";
    entry.elements = count - countBefore;
  }

  if (info.toc?.enabled) {
    const fullHeadings = collectDocumentHeadings(
      doc,
      info,
      resolveProfile(info, parsed.profile ?? info.defaultProfile),
      anchorRanges,
      renderedHeadings,
    );
    updateTableOfContents(doc, info, fullHeadings, ownerDoc);
  }

  return count;
}

/** inlineCode 规则为 inline 样式时，取其 run 里的字体/字号/颜色作为代码 run 的覆盖项。 */
export function inlineCodeRunOverride(sample: StyleSample | null): Partial<InlineRun> | null {
  const run = sample?.inline?.run as Record<string, any> | undefined;
  if (!run) return null;
  const out: Partial<InlineRun> = {};
  if (run.fontFamily && typeof run.fontFamily === "object") out.fontFamily = run.fontFamily;
  if (run.fontSize) out.fontSize = run.fontSize;
  if (run.color) out.color = run.color;
  return Object.keys(out).length > 0 ? out : null;
}

function buildParagraph(
  sample: StyleSample,
  runs: readonly InlineRun[],
  inlineCodeSample: StyleSample | null,
  hyperlink: (ownerDoc: XmlElement, link: string) => XmlElement | null,
  ownerDoc: XmlElement,
): XmlElement {
  // inlineCode 规则若是 inline 样式（AI 常见），把它的字体/字号/颜色叠加到代码 run 上
  const codeOverride = inlineCodeRunOverride(inlineCodeSample);
  if (sample.inline) {
    const styled = runs
      .map((run) => (run.code && codeOverride ? { ...codeOverride, ...run } : run))
      .map((run) => (run.link ? { ...run, underline: true, color: run.color ?? "0563C1" } : run));
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
    const withCode = run.code && codeOverride ? { ...codeOverride, ...run } : run;
    const mods = run.link ? { ...withCode, underline: true, color: withCode.color ?? "0563C1" } : withCode;
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

function extractSampleFont(sample: StyleSample | null): { family?: string; eastAsia?: string; size?: number } {
  if (sample?.inline?.run) {
    const run = sample.inline.run;
    const fontFamily = run.fontFamily as Record<string, unknown> | undefined;
    const family = (fontFamily?.ascii ?? fontFamily?.eastAsia ?? run.font) as string | undefined;
    const size = run.fontSize ? parseInt(String(run.fontSize), 10) : undefined;
    return { family, eastAsia: fontFamily?.eastAsia as string | undefined, size };
  }
  if (!sample?.runEl) return {};
  const rPr = childElementsOf(sample.runEl).find((c) => c.nodeName === "w:rPr");
  if (!rPr) return {};
  const rFonts = childElementsOf(rPr).find((c) => c.nodeName === "w:rFonts");
  const sz = childElementsOf(rPr).find((c) => c.nodeName === "w:sz");
  return {
    family: rFonts?.getAttribute?.("w:ascii") || rFonts?.getAttribute?.("w:eastAsia") || undefined,
    eastAsia: rFonts?.getAttribute?.("w:eastAsia") || undefined,
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
  settings: CodeSettings,
  sample: StyleSample,
  container: XmlElement,
  refNode: XmlElement | null,
  ownerDoc: XmlElement,
): { lastEl: XmlElement | null; lineCount: number } {
  const isLint = settings.lint.value;
  const tabSize = settings.tabSize;
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
      const emptyRun = sample.inline
        ? createRunFromStyles(ownerDoc, sample.inline.run ?? {}, "")
        : cloneRunWithText(sample.runEl as XmlElement, "");
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
        const runEl = sample.inline
          ? createRunFromStyles(ownerDoc, sample.inline.run ?? {}, run.text, styleMods)
          : cloneRunWithText(sample.runEl as XmlElement, run.text, styleMods);
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
  settings: CodeSettings,
  sample: StyleSample | null,
  ownerDoc: XmlElement,
  bodyFont: { family?: string; eastAsia?: string; size?: number } = {},
  onFit?: (kind: "shrunk" | "overflow", message: string) => void,
): XmlElement {
  const codeConfig = { fontFamily: settings.fontFamily, fontEastAsia: settings.fontEastAsia, fontSize: settings.fontSize };
  const theme = loadCodeThemeSync(settings.theme.value);

  const sampleFont = extractSampleFont(sample);

  // 字体配置：支持 "inherit" 随正文/代码样板字体
  let fontFamily = codeConfig.fontFamily ?? bodyFont.family ?? theme.container.fontFamily;
  if (fontFamily === "inherit") fontFamily = sampleFont.family || "Consolas";
  if (!fontFamily) fontFamily = "Consolas";
  // 中文字体：单独设置（如 宋体），"inherit" 取样板的中文字体；未设置则不写 eastAsia（沿用文档默认）
  let eastAsia: string | undefined = codeConfig.fontEastAsia ?? bodyFont.eastAsia;
  if (eastAsia === "inherit") eastAsia = sampleFont.eastAsia || undefined;

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

  const tabSize = settings.tabSize;
  const showLineNumbers = settings.lineNumbers.value;
  const showBorder = settings.border.value;

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

  // 自动适配宽度：最长行放不下就缩小字号，避免折行破坏对齐；缩到下限仍放不下才折行并告警
  if (settings.fit.value) {
    const fit = fitFontSize(
      hl.lines.map((line) => line.runs.map((run) => run.text).join("")),
      { fontSize, codeWidthTwips: codeWidth, minFontSize: settings.minFontSize },
    );
    if (fit.shrunk) onFit?.("shrunk", `代码卡片字号自动缩小 ${fontSize / 2}pt -> ${fit.fontSize / 2}pt 以放下最长行`);
    if (fit.overflow) onFit?.("overflow", `代码块最长行仍放不下（已缩到下限 ${fit.fontSize / 2}pt），该行会折行；可缩短行长或用 {fit=false} 关闭自动缩小`);
    fontSize = fit.fontSize;
  }

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
    b.setAttribute("w:val", showBorder ? "single" : "none");
    if (showBorder) {
      b.setAttribute("w:sz", borderSize);
      b.setAttribute("w:space", "0");
      b.setAttribute("w:color", borderColor);
    }
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
      if (eastAsia) rFonts.setAttribute("w:eastAsia", eastAsia);
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
        if (eastAsia) rFonts.setAttribute("w:eastAsia", eastAsia);
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

function parseHeadingStyleLevel(pStyle: string): number | undefined {
  const match = /(?:heading|标题)\s*(\d+)/i.exec(pStyle);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * 收集文档中所有带 Word 目录书签（`_Toc*` / `__RefHeading___Toc*`）的标题，包含
 * **骨架未提及、原样保留**的章节标题，按文档顺序返回，保证目录完整无遗漏。
 *
 * 等级判定优先级：规则映射出的 pStyle > 渲染时记录的等级 > pStyle 命名解析。
 */
function collectDocumentHeadings(
  doc: VirtualWordDocument,
  info: TemplateInfo,
  profile: TemplateProfile,
  anchorRanges: Map<string, BookmarkRange>,
  renderedHeadings: ReadonlyArray<{ level: number; text: string; bookmarkName: string }>,
): Array<{ level: number; text: string; bookmarkName: string }> {
  const maxLevel = info.toc?.maxLevel ?? 2;
  const styleToLevel = new Map<string, number>();
  for (const rule of profile.rules) {
    if (rule.match.type !== "heading" || !rule.match.level) continue;
    const sample = styleRefToSample(rule.style, profile, anchorRanges);
    const pStyle =
      sample?.inline?.paragraph?.styleId ??
      sample?.paragraphEl?.getElementsByTagName?.("w:pStyle")?.[0]?.getAttribute?.("w:val");
    if (pStyle && !styleToLevel.has(pStyle)) styleToLevel.set(pStyle, rule.match.level);
  }

  const levelByBookmark = new Map(renderedHeadings.map((heading) => [heading.bookmarkName, heading.level] as const));

  const anyDoc = doc as unknown as { partsData?: Array<{ path?: string; xmlDocument?: any }> };
  const root =
    anyDoc.partsData?.find((part) => part.path === "word/document.xml")?.xmlDocument?.documentElement ??
    anyDoc.partsData?.[0]?.xmlDocument?.documentElement;
  if (!root) return renderedHeadings.slice();

  const result: Array<{ level: number; text: string; bookmarkName: string }> = [];
  const seen = new Set<string>();
  const paragraphs = Array.from(root.getElementsByTagName("w:p") ?? []) as XmlElement[];
  for (const paragraph of paragraphs) {
    const bookmarkName = findHeadingBookmarkName(paragraph);
    if (!bookmarkName || seen.has(bookmarkName)) continue;
    const pStyle = paragraph.getElementsByTagName("w:pStyle")?.[0]?.getAttribute?.("w:val") as string | undefined;
    const level =
      (pStyle ? styleToLevel.get(pStyle) : undefined) ??
      levelByBookmark.get(bookmarkName) ??
      (pStyle ? parseHeadingStyleLevel(pStyle) : undefined);
    if (!level || level < 1 || level > maxLevel) continue;
    const text = paragraphText(paragraph).trim();
    if (!text) continue;
    seen.add(bookmarkName);
    result.push({ level, text, bookmarkName });
  }
  return result.length > 0 ? result : renderedHeadings.slice();
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

/** 确保标题段落带 `w:outlineLvl`，使 Word/WPS 的 TOC 域（`\u` 开关）能收录该标题。 */
function ensureOutlineLevel(paragraphEl: XmlElement, level: number): void {
  let pPr = paragraphEl.getElementsByTagName?.("w:pPr")?.[0];
  if (!pPr) {
    pPr = createWordElement(paragraphEl, "w:pPr");
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild);
  }
  let outline = pPr.getElementsByTagName("w:outlineLvl")?.[0];
  if (!outline) {
    outline = createWordElement(pPr, "w:outlineLvl");
    const markRPr = childElementsOf(pPr).find((child) => child.nodeName === "w:rPr");
    if (markRPr) pPr.insertBefore(outline, markRPr);
    else pPr.appendChild(outline);
  }
  outline.setAttribute("w:val", String(Math.max(0, Math.min(8, level - 1))));
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
    } else if (token.startsWith("`")) {
      push(token.slice(1, -1), { code: true });
    } else {
      // 粗/斜/删除线内部还可以嵌套行内代码、链接等：递归解析后统一叠加样式
      const [width, mods]: [number, Omit<InlineRun, "text">] =
        token.startsWith("***") || token.startsWith("___")
          ? [3, { bold: true, italic: true }]
          : token.startsWith("**") || token.startsWith("__")
            ? [2, { bold: true }]
            : token.startsWith("~~")
              ? [2, { strike: true }]
              : [1, { italic: true }];
      for (const inner of parseInline(token.slice(width, -width))) push(inner.text, { ...inner, ...mods });
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

function previewText(block: MarkdownBlock): string {
  const raw =
    block.type === "image"
      ? (block.caption || block.src || "")
      : block.type === "list"
        ? (block.items ?? []).map((item) => item.text).join(" / ")
        : block.type === "table"
          ? (block.rows?.[0] ?? []).join(" | ")
          : block.text;
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
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
  if (info.toc?.enabled) {
    await enableDocxUpdateFields(doc);
  }
  const shouldStripComments = options.stripComments ?? info.stripComments ?? (options.strip ?? true);
  if (shouldStripComments) {
    await stripDocumentComments(doc);
  }
  result.warnings.push(...(await dropDanglingStyleRefs(doc)));
  if (options.strict && result.warnings.length > 0) {
    throw new Error(`--strict：渲染产生 ${result.warnings.length} 条警告，未写出成稿：\n  ${result.warnings.join("\n  ")}`);
  }
  if (!options.dryRun) await doc.saveAs(outputPath);
  return result;
}

/**
 * AI 的内联样式常写 `styleId: "Heading1"` 之类，而原文档 styles.xml 里并没有该样式；
 * 悬空的 `w:pStyle` / `w:rStyle` 在 Word 里等于没设。这里剥掉未定义的引用（标题层级另由 outlineLvl 保证），并返回告警。
 */
export async function dropDanglingStyleRefs(doc: VirtualWordDocument): Promise<string[]> {
  const anyDoc = doc as unknown as {
    zip?: { file: (name: string) => any };
    partsData?: Array<{ path?: string; xmlDocument?: any }>;
  };
  const stylesFile = anyDoc.zip?.file?.("word/styles.xml");
  const root = anyDoc.partsData?.find((part) => part.path === "word/document.xml")?.xmlDocument?.documentElement;
  if (!stylesFile || typeof stylesFile.async !== "function" || !root) return [];
  const stylesXml: string = await stylesFile.async("text");
  const defined = new Set(Array.from(stylesXml.matchAll(/w:styleId="([^"]+)"/g), (m) => m[1]));
  const dropped = new Map<string, number>();
  for (const tag of ["w:pStyle", "w:rStyle"]) {
    for (const el of Array.from(root.getElementsByTagName(tag) ?? []) as XmlElement[]) {
      const id = el.getAttribute("w:val");
      if (!id || defined.has(id)) continue;
      el.parentNode?.removeChild(el);
      dropped.set(id, (dropped.get(id) ?? 0) + 1);
    }
  }
  return [...dropped].map(([id, n]) => `模板样式表里没有样式 “${id}”，已移除 ${n} 处悬空引用（改用直接格式）`);
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

/** 解析图片路径：相对路径优先相对 Markdown 所在目录，其次相对 cwd；不存在返回 null。 */
function resolveImagePath(src: string, markdownDir?: string): string | null {
  if (!src) return null;
  if (markdownDir && !path.isAbsolute(src)) {
    const candidate = path.resolve(markdownDir, src);
    if (existsSync(candidate)) return candidate;
  }
  return existsSync(src) ? src : null;
}

function setParagraphAlign(paragraphEl: XmlElement, align: string): void {
  let pPr = childElementsOf(paragraphEl).find((child) => child.nodeName === "w:pPr") ?? null;
  if (!pPr) {
    pPr = createWordElement(paragraphEl, "w:pPr");
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild);
  }
  let jc = childElementsOf(pPr).find((child) => child.nodeName === "w:jc") ?? null;
  if (!jc) {
    jc = createWordElement(pPr, "w:jc");
    pPr.appendChild(jc);
  }
  jc.setAttribute("w:val", align);
}

function buildImageElement(
  ownerDoc: XmlElement,
  doc: VirtualWordDocument,
  block: MarkdownBlock,
  rule: TemplateRule | null | undefined,
  profile: TemplateProfile,
  anchorRanges: Map<string, BookmarkRange>,
  ctx: {
    settings: ImageSettings;
    /** 已解析且确认存在的图片路径。 */
    imagePath: string;
    docPrId: number;
  },
): { paragraphEl: XmlElement; captionEl: XmlElement | null } {
  const imagePath = ctx.imagePath;

  const buffer = readFileSync(imagePath);
  const dims = getImageDimensions(buffer);

  const { settings } = ctx;
  const align = settings.align.value;
  const emuSize = calculateImageEmuSize(dims, {
    size: settings.size.value,
    width: settings.width,
    height: settings.height,
    maxWidthPt: settings.maxWidth,
  });

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
    // 图注样式同样遵循覆盖准则：块属性 / 使用者配置（样式名、锚点或配方名）> 模板规则的 captionRef/captionStyle > profile 的 caption 规则
    const byName = (name: string): StyleRef =>
      anchorRanges.has(name) ? { anchor: name } : profile.styles?.[name] ? { recipe: name } : { styleName: name };
    let targetStyleRef: StyleRef | undefined;
    const chosen = settings.captionStyle;
    if (chosen && (chosen.from === "block" || chosen.from === "user") && typeof chosen.value === "string") {
      targetStyleRef = byName(chosen.value);
    } else if (chosen?.from === "template") {
      const tpl = chosen.value as { captionRef?: unknown; captionStyle?: unknown };
      if (tpl.captionRef !== undefined) {
        targetStyleRef = typeof tpl.captionRef === "string" ? { anchor: tpl.captionRef } : (tpl.captionRef as StyleRef);
      } else if (tpl.captionStyle !== undefined) {
        targetStyleRef = typeof tpl.captionStyle === "string" ? byName(tpl.captionStyle) : (tpl.captionStyle as StyleRef);
      }
    }
    targetStyleRef ??= matchRule(profile.rules, { type: "caption" } as any)?.style;

    const captionSample = styleRefToSample(targetStyleRef ?? (rule?.style || profile.defaults?.style), profile, anchorRanges);

    const captionAlign = settings.captionAlign.value;

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

/** 找到锚点所在的表格元素（用于复用其样式）。 */
function resolveSampleTable(ref: string, anchorRanges: Map<string, BookmarkRange>): XmlElement | null {
  const range = anchorRanges.get(ref);
  if (!range) return null;
  let node: XmlElement = range.paragraphEl?.parentNode ?? null;
  while (node) {
    if (node.nodeName === "w:tbl") return node;
    if (node.nodeName === "w:body" || node.nodeName === "#document") return null;
    node = node.parentNode;
  }
  return null;
}

/** 克隆样本表的表属性/列宽/边框与单元格格式，生成内容为 rows 的新表。 */
function buildTableFromSample(
  ownerDoc: XmlElement,
  sampleTable: XmlElement,
  rows: string[][],
  colCount: number,
  alignments: Array<"left" | "center" | "right">,
  hasHeader: boolean,
  tableAlign: string,
): XmlElement {
  const tbl = ownerDoc.createElementNS(WORD_NS, "w:tbl");

  const srcTblPr = childElementsOf(sampleTable).find((c) => c.nodeName === "w:tblPr");
  if (srcTblPr) {
    const tblPr = srcTblPr.cloneNode(true) as XmlElement;
    if (tableAlign) {
      let jc = childElementsOf(tblPr).find((c) => c.nodeName === "w:jc");
      if (!jc) {
        jc = createWordElement(tblPr, "w:jc");
        tblPr.appendChild(jc);
      }
      jc.setAttribute("w:val", tableAlign);
    }
    tbl.appendChild(tblPr);
  }

  const srcGrid = childElementsOf(sampleTable).find((c) => c.nodeName === "w:tblGrid");
  const srcCols = srcGrid ? childElementsOf(srcGrid).filter((c) => c.nodeName === "w:gridCol") : [];
  const tblGrid = ownerDoc.createElementNS(WORD_NS, "w:tblGrid");
  if (srcCols.length === colCount) {
    for (const col of srcCols) tblGrid.appendChild(col.cloneNode(true));
  } else {
    const total = srcCols.reduce((sum, c) => sum + (Number(c.getAttribute("w:w")) || 0), 0) || colCount * 1440;
    const each = Math.max(1, Math.floor(total / colCount));
    for (let c = 0; c < colCount; c += 1) {
      const gridCol = createWordElement(tblGrid, "w:gridCol");
      gridCol.setAttribute("w:w", String(each));
      tblGrid.appendChild(gridCol);
    }
  }
  tbl.appendChild(tblGrid);

  const srcRows = childElementsOf(sampleTable).filter((c) => c.nodeName === "w:tr");
  const firstCell = srcRows[0] ? childElementsOf(srcRows[0]).find((c) => c.nodeName === "w:tc") : undefined;
  const lastCell = srcRows.length
    ? childElementsOf(srcRows[srcRows.length - 1]).find((c) => c.nodeName === "w:tc")
    : undefined;
  const headerTcPr = firstCell ? childElementsOf(firstCell).find((c) => c.nodeName === "w:tcPr") : undefined;
  const lastTcPr = lastCell ? childElementsOf(lastCell).find((c) => c.nodeName === "w:tcPr") : undefined;
  const firstParagraph = firstCell ? childElementsOf(firstCell).find((c) => c.nodeName === "w:p") : undefined;
  const samplePPr = firstParagraph ? childElementsOf(firstParagraph).find((c) => c.nodeName === "w:pPr") : undefined;
  const sampleRun = firstParagraph ? childElementsOf(firstParagraph).find((c) => c.nodeName === "w:r") : undefined;
  const sampleRPr = sampleRun ? childElementsOf(sampleRun).find((c) => c.nodeName === "w:rPr") : undefined;
  const trPr0 = srcRows[0] ? childElementsOf(srcRows[0]).find((c) => c.nodeName === "w:trPr") : undefined;
  const headerRepeat = Boolean(trPr0 && childElementsOf(trPr0).some((c) => c.nodeName === "w:tblHeader"));

  const applyCellStyle = (srcTcPr: XmlElement | undefined, tcPr: XmlElement, allowShading: boolean): void => {
    if (!srcTcPr) return;
    const borders = childElementsOf(srcTcPr).find((c) => c.nodeName === "w:tcBorders");
    if (borders) tcPr.appendChild(borders.cloneNode(true));
    if (allowShading) {
      const shd = childElementsOf(srcTcPr).find((c) => c.nodeName === "w:shd");
      if (shd) tcPr.appendChild(shd.cloneNode(true));
    }
    const vAlign = childElementsOf(srcTcPr).find((c) => c.nodeName === "w:vAlign");
    if (vAlign) tcPr.appendChild(vAlign.cloneNode(true));
  };

  for (let r = 0; r < rows.length; r += 1) {
    const isHeader = hasHeader && r === 0;
    const isLast = r === rows.length - 1;
    const tr = ownerDoc.createElementNS(WORD_NS, "w:tr");
    const trPr = ownerDoc.createElementNS(WORD_NS, "w:trPr");
    trPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:cantSplit"));
    if (isHeader && headerRepeat) trPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:tblHeader"));
    tr.appendChild(trPr);

    for (let c = 0; c < colCount; c += 1) {
      const cellText = rows[r]?.[c] ?? "";
      const colAlign = alignments[c] ?? (isHeader ? "center" : "left");

      const tc = ownerDoc.createElementNS(WORD_NS, "w:tc");
      const tcPr = ownerDoc.createElementNS(WORD_NS, "w:tcPr");
      applyCellStyle(isHeader ? headerTcPr : isLast ? lastTcPr : undefined, tcPr, isHeader);
      tc.appendChild(tcPr);

      const p = ownerDoc.createElementNS(WORD_NS, "w:p");
      if (samplePPr) {
        const pPr = samplePPr.cloneNode(true) as XmlElement;
        let jc = childElementsOf(pPr).find((x) => x.nodeName === "w:jc");
        if (!jc) {
          jc = createWordElement(pPr, "w:jc");
          pPr.appendChild(jc);
        }
        jc.setAttribute("w:val", colAlign);
        p.appendChild(pPr);
      } else {
        const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
        const jc = ownerDoc.createElementNS(WORD_NS, "w:jc");
        jc.setAttribute("w:val", colAlign);
        pPr.appendChild(jc);
        p.appendChild(pPr);
      }

      const baseRun = ownerDoc.createElementNS(WORD_NS, "w:r");
      if (sampleRPr) baseRun.appendChild(sampleRPr.cloneNode(true));
      appendInlineCellRuns(p, baseRun, cellText);
      tc.appendChild(p);
      tr.appendChild(tc);
    }
    tbl.appendChild(tr);
  }

  return tbl;
}

/** 单元格支持行内 Markdown（`代码`、**粗**、*斜*、~~删除~~、链接文字），以 baseRun 的格式为底。 */
function appendInlineCellRuns(paragraphEl: XmlElement, baseRun: XmlElement, text: string): void {
  for (const run of parseInline(text)) {
    const runEl = cloneRunWithText(baseRun, run.text, run.link ? { ...run, underline: true, color: run.color ?? "0563C1" } : run);
    if (run.code) setMonospaceFont(runEl);
    paragraphEl.appendChild(runEl);
  }
}

/** 行内代码：把 run 的西文字体设为等宽（中文字体保持不变）。 */
function setMonospaceFont(runEl: XmlElement): void {
  let rPr = childElementsOf(runEl).find((child) => child.nodeName === "w:rPr") ?? null;
  if (!rPr) {
    rPr = createWordElement(runEl, "w:rPr");
    runEl.insertBefore(rPr, runEl.firstChild);
  }
  let fonts = childElementsOf(rPr).find((child) => child.nodeName === "w:rFonts") ?? null;
  if (!fonts) {
    fonts = createWordElement(rPr, "w:rFonts");
    const rStyle = childElementsOf(rPr).find((child) => child.nodeName === "w:rStyle");
    rPr.insertBefore(fonts, rStyle ? rStyle.nextSibling : rPr.firstChild);
  }
  fonts.setAttribute("w:ascii", "Consolas");
  fonts.setAttribute("w:hAnsi", "Consolas");
  fonts.removeAttribute("w:asciiTheme");
  fonts.removeAttribute("w:hAnsiTheme");
}

function buildTableElement(
  ownerDoc: XmlElement,
  block: MarkdownBlock,
  anchorRanges: Map<string, BookmarkRange>,
  settings: TableSettings,
): XmlElement {
  const rows = block.rows || [];
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const alignments = block.alignments || [];

  const theme = settings.theme.value;
  const hasHeader = settings.header.value && rows.length > 0;
  const tableAlign = settings.align.value;

  // 复用文档中已有表格的样式：模板规则里给 options.styleAnchor（表内任一锚点）时，
  // 克隆该表的表属性/列宽/边框与单元格格式（块/使用者显式指定主题时不生效）。
  const styleAnchor = settings.styleAnchor;
  if (styleAnchor) {
    const sampleTable = resolveSampleTable(styleAnchor, anchorRanges);
    if (sampleTable) {
      return buildTableFromSample(ownerDoc, sampleTable, rows, colCount, alignments, hasHeader, tableAlign);
    }
  }

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

      const baseRun = ownerDoc.createElementNS(WORD_NS, "w:r");
      const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
      if (isHeader) {
        rPr.appendChild(ownerDoc.createElementNS(WORD_NS, "w:b"));
      }
      const sz = ownerDoc.createElementNS(WORD_NS, "w:sz");
      sz.setAttribute("w:val", "21"); // 10.5pt (五号)
      rPr.appendChild(sz);
      baseRun.appendChild(rPr);
      appendInlineCellRuns(p, baseRun, cellText);

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
