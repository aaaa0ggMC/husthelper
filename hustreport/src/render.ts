import { readFile } from "node:fs/promises";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * 渲染器。
 *
 * 填空：`[文字](ref:锚点)` 把文字写进对应 hole（保留样式）。
 * 结构化：标题 / 正文 / 代码 / 列表 / 引用块按 `rules` 匹配到已有样式，
 * 克隆该样式的段落+run 元素插入到锚点位置；样式全部复用，不新建。
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

export type BlockType = "heading" | "paragraph" | "code" | "list" | "quote" | "table" | "hr";

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
  /** 插入锚点。 */
  ref?: string;
  profile?: string;
  position?: "before" | "after";
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
    const fence = /^\s*```+\s*(\S*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", lang, text: buffer.join("\n"), profile: sectionProfile });
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

    // 表格（先解析出来，渲染阶段提示暂不支持）
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows: string[][] = [parseTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", text: "", rows, profile: sectionProfile });
      continue;
    }

    // 普通段落
    const buffer = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|```|>|<!--|([-*+]|\d+\.)\s)/.test(lines[i])
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
  const parsed = parseDocument(markdown, options);
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
  if (options.structured ?? true) {
    inserted = renderBlocks(doc, info, parsed, anchorRanges, warnings, options.appendUnanchored ?? false);
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
): number {
  let count = 0;
  let cursorLast: XmlElement | null = null;
  let cursorFallback: XmlElement | null = null;
  const profileCache = new Map<string, TemplateProfile>();
  const defaultContainer = findDefaultContainer(anchorRanges);
  const ownerDoc: XmlElement =
    defaultContainer?.ownerDocument ?? (anchorRanges.values().next().value as BookmarkRange | undefined)?.paragraphEl?.ownerDocument;

  for (const block of parsed.blocks) {
    if (block.type === "paragraph" && (FILL_ONLY.test(block.text) || HAS_REF_LINK.test(block.text))) continue; // ref 链接按填空处理
    if (block.type === "table") {
      warnings.push("表格暂未支持，已跳过");
      continue;
    }

    const profileName = block.profile ?? parsed.profile ?? info.defaultProfile;
    let profile = profileCache.get(profileName);
    if (!profile) {
      profile = resolveProfile(info, profileName);
      profileCache.set(profileName, profile);
    }

    const rule = matchRule(profile.rules, block);
    const sample = styleRefToSample(rule?.style ?? profile.defaults?.style, profile, anchorRanges);
    if (!sample) {
      warnings.push(`${describeBlock(block)} 找不到可用样式（rules/profile 未覆盖），已跳过`);
      continue;
    }
    const inlineCodeRule = matchRule(profile.rules, { type: "inlineCode" });
    const inlineCodeSample = inlineCodeRule ? styleRefToSample(inlineCodeRule.style, profile, anchorRanges) : null;

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
  return rules.find((rule) => matchesRule(rule, target));
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
  const result = renderTemplate(doc, info, markdown, options);
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
