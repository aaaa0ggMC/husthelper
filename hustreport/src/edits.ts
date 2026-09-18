import type { VirtualWordDocument, VNode } from "docx-edit";
import type { CollectedParagraph, CollectedRun } from "./walk.ts";
import { paragraphKey, paragraphKeyOfRef, walkParagraphs } from "./walk.ts";
import { analyzeDocument } from "./analyze.ts";
import { canonicalize } from "./util.ts";
import type { AnchorRegistry } from "./anchors.ts";
import type { DocumentAnalysis, Segment, StyleObject } from "./types.ts";

/** 公共定位：任选一个即可；`styleId` 会命中多条时用 `match` 过滤。 */
export interface SegmentSelector {
  /** CSV 里的 `Index`。 */
  index?: number;
  /** 稳定路径索引，如 `body#0/p@4E2EFCDF/s1`。 */
  ref?: string;
  /** XML Style ID。 */
  styleId?: number;
  /** 在候选 segment 里按文本过滤。 */
  match?: { contains?: string; regex?: string };
}

/** 改写已有 segment 的文本。 */
export interface TextEdit extends SegmentSelector {
  text: string;
  mode?: "replace" | "append" | "prepend";
}

/**
 * 插入一个新 segment。
 *
 * **不新建任何样式**：`useStyleId` 必须指向已存在的样式，新节点通过
 * **深拷贝该样式已有的 run/paragraph OOXML 元素**得到，连 `w:rStyle`/`w:pStyle` 引用都原样复用。
 */
export interface InsertEdit extends SegmentSelector {
  text: string;
  /**
   * 复用哪个已有 XML Style ID。省略时默认复用**目标 segment 自己的样式**，
   * 这样调用方/AI 不必先查样式表。
   */
  useStyleId?: number;
  /** 相对目标 segment 的位置，默认 after。 */
  position?: "before" | "after";
  /** `run` = 同段落内插入 run；`paragraph` = 新建段落（完整套用该样式）。默认 paragraph。 */
  as?: "run" | "paragraph";
}

/** 删除 segment。 */
export interface DeleteEdit extends SegmentSelector {
  /** `run` = 删除该 segment 的 run；`paragraph` = 删除整个段落。默认 run。 */
  as?: "run" | "paragraph";
}

export interface EditPlan {
  set?: readonly TextEdit[];
  insert?: readonly InsertEdit[];
  delete?: readonly DeleteEdit[];
}

export interface ApplyEditsOptions {
  analysis?: DocumentAnalysis;
  /** 会话内 anchor 注册表；传入后按 `segment.ref.anchor` 精确定位。 */
  registry?: AnchorRegistry;
}

export interface AppliedEdit {
  ref: string;
  index: number;
  styleId: number;
  before: string;
  after: string;
}

export interface AppliedInsert {
  styleId: number;
  as: "run" | "paragraph";
  position: "before" | "after";
  anchorRef: string;
  text: string;
}

export interface AppliedDelete {
  ref: string;
  index: number;
  styleId: number;
  text: string;
  as: "run" | "paragraph";
}

export interface EditResult {
  applied: number;
  inserted: number;
  deleted: number;
  edits: AppliedEdit[];
  inserts: AppliedInsert[];
  deletes: AppliedDelete[];
  /** 未命中 / 无可用样式等非致命问题（不会中断整批编辑）。 */
  warnings: string[];
  /** 供调试：本实现直接改 OOXML，不经过虚拟树 patch，故为空数组。 */
  operations: unknown[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * 统一编辑入口：改写 / 插入 / 删除。
 *
 * 直接操作 docx-edit 底层的 OOXML DOM：
 * - 改写只改目标 run 的 `w:t`，`w:rPr` 不动；
 * - 插入深拷贝已有样式的元素，不新建样式；
 * - 删除直接摘除对应 run / 段落元素。
 */
export function applyEdits(
  doc: VirtualWordDocument,
  plan: EditPlan,
  options: ApplyEditsOptions = {},
): EditResult {
  const analysis = options.analysis ?? analyzeDocument(doc, { registry: options.registry });
  const rawWalk = walkParagraphs(resolveRawTree(doc), { includeEmptyParagraphs: true });
  const paragraphsByKey = new Map<string, CollectedParagraph>();
  for (const paragraph of rawWalk.paragraphs) paragraphsByKey.set(paragraphKey(paragraph), paragraph);

  const appliedEdits: AppliedEdit[] = [];
  const inserts: AppliedInsert[] = [];
  const deletes: AppliedDelete[] = [];
  const warnings: string[] = [];

  const samples = collectSamples(analysis, rawWalk.paragraphs);
  const resolve = (segment: Segment): ResolvedSegment | null =>
    resolveSegment(segment, options.registry, paragraphsByKey);

  for (const edit of plan.set ?? []) {
    const matches = selectSegments(analysis, edit);
    if (matches.length === 0) warnings.push(`set 未命中任何 segment: ${describeSelector(edit)}`);
    for (const segment of matches) {
      const target = resolve(segment);
      if (!target || target.runEls.length === 0) continue;
      const before = segment.text;
      if (!writeRunElements(target.runEls, edit.text, edit.mode ?? "replace")) continue;
      appliedEdits.push({ ref: segment.ref.id, index: segment.index, styleId: segment.styleId, before, after: edit.text });
    }
  }

  // 同一锚点上连续插入时，记录“最后插入的元素”，保证最终顺序与计划顺序一致。
  const insertCursors = new Map<XmlElement, XmlElement>();

  for (const edit of plan.insert ?? []) {
    const matches = selectSegments(analysis, edit);
    if (matches.length === 0) warnings.push(`insert 未命中任何 segment: ${describeSelector(edit)}`);
    for (const segment of matches) {
      const target = resolve(segment);
      if (!target) continue;
      const styleId = edit.useStyleId ?? segment.styleId;
      const sample = samples.get(styleId);
      if (!sample) {
        warnings.push(`insert 跳过：样式 ${styleId} 没有可复用的 run 样例（ref=${segment.ref.id}）`);
        continue;
      }
      const as = edit.as ?? "paragraph";
      const position = edit.position ?? "after";
      const anchorEl = (position === "before" ? target.runEls[0] : target.runEls[target.runEls.length - 1]) as XmlElement | undefined;
      if (!anchorEl) continue;
      const ok =
        as === "run"
          ? insertRunDom(anchorEl, sample.run, edit.text, position, insertCursors)
          : insertParagraphDom(target.paragraphEl as XmlElement, sample, edit.text, position, insertCursors);
      if (ok) inserts.push({ styleId, as, position, anchorRef: segment.ref.id, text: edit.text });
    }
  }

  for (const edit of plan.delete ?? []) {
    const matches = selectSegments(analysis, edit);
    if (matches.length === 0) warnings.push(`delete 未命中任何 segment: ${describeSelector(edit)}`);
    for (const segment of matches) {
      const target = resolve(segment);
      if (!target) continue;
      const as = edit.as ?? "run";
      const ok = as === "run" ? deleteRunElements(target.runEls) : deleteParagraphElement(target.paragraphEl as XmlElement);
      if (ok) deletes.push({ ref: segment.ref.id, index: segment.index, styleId: segment.styleId, text: segment.text, as });
    }
  }

  // 用会话 anchor 时无需往文档写任何 ID；只在“无 registry 的跨会话场景”才补 paraId。
  if (inserts.length > 0 && !options.registry) assignMissingParaIds(doc);
  (doc as unknown as { rebuildFromXml?: () => void }).rebuildFromXml?.();

  return {
    applied: appliedEdits.length,
    inserted: inserts.length,
    deleted: deletes.length,
    edits: appliedEdits,
    inserts,
    deletes,
    warnings,
    operations: [],
  };
}

function describeSelector(selector: SegmentSelector): string {
  const parts: string[] = [];
  if (selector.ref !== undefined) parts.push(`ref=${selector.ref}`);
  if (selector.index !== undefined) parts.push(`index=${selector.index}`);
  if (selector.styleId !== undefined) parts.push(`styleId=${selector.styleId}`);
  if (selector.match?.contains !== undefined) parts.push(`contains=${JSON.stringify(selector.match.contains)}`);
  if (selector.match?.regex !== undefined) parts.push(`regex=${selector.match.regex}`);
  return parts.join(" ") || "(空选择器)";
}

/** 仅改写文本（等价于 `applyEdits(doc, { set })`，保留旧入口）。 */
export function applyTextEdits(
  doc: VirtualWordDocument,
  edits: readonly TextEdit[],
  options: ApplyEditsOptions = {},
): EditResult {
  return applyEdits(doc, { set: edits }, options);
}

/** 读取 docx → 应用编辑计划 → 另存。 */
export async function editDocx(
  doc: VirtualWordDocument,
  plan: EditPlan,
  outputPath: string,
  options: ApplyEditsOptions = {},
): Promise<EditResult> {
  const result = applyEdits(doc, plan, options);
  await doc.saveAs(outputPath);
  return result;
}

/* ------------------------------ 选择 / 定位 ------------------------------ */

/** 按选择器筛选 segment（`ref` / `index` / `styleId` + `match`）。 */
export function selectSegments(analysis: DocumentAnalysis, selector: SegmentSelector): Segment[] {
  return analysis.segments.filter((segment) => {
    if (selector.index !== undefined && segment.index !== selector.index) return false;
    if (selector.ref !== undefined && segment.ref.id !== selector.ref) return false;
    if (selector.styleId !== undefined && segment.styleId !== selector.styleId) return false;
    if (selector.match?.contains !== undefined && !segment.text.includes(selector.match.contains)) return false;
    if (selector.match?.regex !== undefined && !new RegExp(selector.match.regex).test(segment.text)) return false;
    return true;
  });
}

interface ResolvedSegment {
  paragraphEl: unknown;
  runEls: unknown[];
}

/**
 * 定位 segment 对应的 DOM 元素。
 * 优先走会话 anchor（精确、不受边界漂移影响），否则回退到 paraId/序号 + run 区间。
 */
function resolveSegment(
  segment: Segment,
  registry: AnchorRegistry | undefined,
  paragraphsByKey: Map<string, CollectedParagraph>,
): ResolvedSegment | null {
  if (segment.ref.anchor && registry) {
    const record = registry.get(segment.ref.anchor);
    if (record && record.paragraphEl) return { paragraphEl: record.paragraphEl, runEls: record.runEls };
  }

  const paragraph = paragraphsByKey.get(paragraphKeyFromRef(segment.ref));
  if (!paragraph) return null;
  const runs = paragraph.runs.slice(segment.ref.runStart, segment.ref.runEnd);
  return {
    paragraphEl: paragraph.node.source,
    runEls: runs.map((run) => run.node.source).filter(Boolean),
  };
}

/** 由 ref 反推段落 key（不依赖 id 是 anchor 还是 paraId 方案）。 */
function paragraphKeyFromRef(ref: Segment["ref"]): string {
  const anchor = ref.paraId ? `p@${ref.paraId}` : `p${ref.paragraph}`;
  return `${ref.part}#${ref.partIndex}/${anchor}`;
}

function resolveRawTree(doc: VirtualWordDocument): VNode {
  const candidate = (doc as unknown as { rootVNode?: VNode }).rootVNode;
  return candidate ?? doc.toComponentTree();
}

/** 每个样式取一个已存在的 run / paragraph 元素作为克隆模板（保证复用而非新建样式）。 */
function collectSamples(
  analysis: DocumentAnalysis,
  paragraphs: readonly CollectedParagraph[],
): Map<number, { run: XmlElement; paragraph: XmlElement }> {
  const idByKey = new Map(analysis.styles.map((style) => [style.key, style.id]));
  const samples = new Map<number, { run: XmlElement; paragraph: XmlElement }>();

  for (const paragraph of paragraphs) {
    for (const run of paragraph.runs) {
      if (run.node.type !== "run") continue;
      const id = idByKey.get(canonicalize({ p: paragraph.style, r: run.style }));
      if (id === undefined || samples.has(id)) continue;
      const runEl = run.node.source as XmlElement | null;
      const paragraphEl = paragraph.node.source as XmlElement | null;
      if (runEl && paragraphEl) samples.set(id, { run: runEl, paragraph: paragraphEl });
    }
  }

  return samples;
}

/* -------------------------------- 改写 -------------------------------- */

export function writeRunElements(runElements: readonly XmlElement[], text: string, mode: "replace" | "append" | "prepend" = "replace"): boolean {
  if (runElements.length === 0) return false;

  const textElements: XmlElement[] = [];
  for (const runEl of runElements) textElements.push(...directChildrenNamed(runEl, "w:t"));

  if (textElements.length === 0) {
    const target = createWordElement(runElements[0], "w:t");
    setElementText(target, text);
    runElements[0].appendChild(target);
    return true;
  }

  if (mode === "append") {
    const last = textElements[textElements.length - 1];
    setElementText(last, `${readElementText(last)}${text}`);
    return true;
  }
  if (mode === "prepend") {
    setElementText(textElements[0], `${text}${readElementText(textElements[0])}`);
    return true;
  }

  setElementText(textElements[0], text);
  for (let i = 1; i < textElements.length; i += 1) setElementText(textElements[i], "");
  return true;
}

/* -------------------------------- 插入 -------------------------------- */

function insertRunDom(
  anchorRunEl: XmlElement,
  sampleRunEl: XmlElement,
  text: string,
  position: "before" | "after",
  cursors: Map<XmlElement, XmlElement>,
): boolean {
  const parent = anchorRunEl.parentNode;
  if (!parent) return false;
  const runEl = cloneRunWithText(sampleRunEl, text);
  parent.insertBefore(runEl, nextInsertionRef(anchorRunEl, position, cursors));
  cursors.set(anchorRunEl, runEl);
  return true;
}

function insertParagraphDom(
  anchorEl: XmlElement,
  sample: { run: XmlElement; paragraph: XmlElement },
  text: string,
  position: "before" | "after",
  cursors: Map<XmlElement, XmlElement>,
): boolean {
  const parent = anchorEl?.parentNode;
  if (!anchorEl || !parent) return false;

  const paragraphEl = sample.paragraph.cloneNode(true) as XmlElement;
  // 不能复用模板段落的 paraId，否则会产生重复 ID；清掉交给 assignMissingParaIds 重新分配。
  paragraphEl.removeAttribute("w14:paraId");
  paragraphEl.removeAttribute("w14:textId");
  for (const child of childElementsOf(paragraphEl)) {
    if (child.nodeName !== "w:pPr") paragraphEl.removeChild(child);
  }
  paragraphEl.appendChild(cloneRunWithText(sample.run, text));
  parent.insertBefore(paragraphEl, nextInsertionRef(anchorEl, position, cursors));
  cursors.set(anchorEl, paragraphEl);
  return true;
}

/** 同一锚点连续插入时的参考节点：接着上次插入的元素往后放。 */
function nextInsertionRef(anchorEl: XmlElement, position: "before" | "after", cursors: Map<XmlElement, XmlElement>): XmlElement | null {
  const last = cursors.get(anchorEl);
  if (last) return last.nextSibling;
  return position === "before" ? anchorEl : anchorEl.nextSibling;
}

/** 行内文本片段（渲染器解析 `**粗**`、`` `code` ``、`[链接](url)` 等得到）。 */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** 行内代码：渲染时可换成等宽 run 样板。 */
  code?: boolean;
  /** 链接目标（http(s) 或 `#书签`）；为空则不是链接。 */
  link?: string;
  underline?: boolean;
  color?: string;
}

/**
 * 深拷贝样板的段落 + run，生成一个只含新文本的新段落元素：
 * 保留 `w:pPr` / `w:rPr`（即复用已有样式），不产生新的 styles.xml 条目。
 */
export function createParagraphFromSample(paragraphEl: XmlElement, runEl: XmlElement, text: string): XmlElement {
  return createParagraphFromInline(paragraphEl, runEl, [{ text }]);
}

/** 用同一份 run 样板生成含多段行内格式的段落。 */
export function createParagraphFromInline(paragraphEl: XmlElement, runEl: XmlElement, runs: readonly InlineRun[]): XmlElement {
  const clone = paragraphEl.cloneNode(true) as XmlElement;
  clone.removeAttribute("w14:paraId");
  clone.removeAttribute("w14:textId");
  for (const child of childElementsOf(clone)) {
    if (child.nodeName !== "w:pPr") clone.removeChild(child);
  }
  for (const run of runs) clone.appendChild(cloneRunWithText(runEl, run.text, run));
  return clone;
}

/** 深拷贝模板 run，仅保留 `w:rPr`，再写入新文本并按需加上加粗/斜体/删除线。 */
export function cloneRunWithText(sampleRunEl: XmlElement, text: string, mods: Omit<InlineRun, "text"> = {}): XmlElement {
  const runEl = sampleRunEl.cloneNode(true) as XmlElement;
  for (const child of childElementsOf(runEl)) {
    if (child.nodeName !== "w:rPr") runEl.removeChild(child);
  }
  if (mods.bold || mods.italic || mods.strike || mods.underline || mods.color) applyInlineMods(runEl, mods);
  const textEl = createWordElement(runEl, "w:t");
  setElementText(textEl, text);
  runEl.appendChild(textEl);
  return runEl;
}

/** `w:rPr` 子元素的 schema 顺序（只用到前几项，用于把 b/i/strike 插到合法位置）。 */
const RPR_ORDER = [
  "w:rStyle",
  "w:rFonts",
  "w:b",
  "w:bCs",
  "w:i",
  "w:iCs",
  "w:caps",
  "w:smallCaps",
  "w:strike",
  "w:dstrike",
  "w:color",
  "w:spacing",
  "w:sz",
  "w:szCs",
  "w:highlight",
  "w:u",
];

function applyInlineMods(runEl: XmlElement, mods: Omit<InlineRun, "text">): void {
  let rPr = childElementsOf(runEl).find((child) => child.nodeName === "w:rPr") ?? null;
  if (!rPr) {
    rPr = createWordElement(runEl, "w:rPr");
    runEl.insertBefore(rPr, runEl.firstChild);
  }
  if (mods.bold) setRPrChild(rPr, "w:b");
  if (mods.italic) setRPrChild(rPr, "w:i");
  if (mods.strike) setRPrChild(rPr, "w:strike");
  if (mods.underline) setRPrChild(rPr, "w:u", { val: "single" });
  if (mods.color) setRPrChild(rPr, "w:color", { val: mods.color });
}

/** 用样板 run 的 `w:rPr` 覆盖目标 run 的格式（填空时可按指定样式重排）。 */
export function replaceRunStyle(targetRunEl: XmlElement, sampleRunEl: XmlElement): boolean {
  const sampleRPr = childElementsOf(sampleRunEl).find((child) => child.nodeName === "w:rPr");
  for (const child of childElementsOf(targetRunEl)) {
    if (child.nodeName === "w:rPr") targetRunEl.removeChild(child);
  }
  if (!sampleRPr) return false;
  targetRunEl.insertBefore(sampleRPr.cloneNode(true), targetRunEl.firstChild);
  return true;
}

/** 用内联样式对象从零构造段落（没有可克隆的锚点元素时用）。 */
export function createParagraphFromStyles(
  ownerDoc: XmlElement,
  paragraphStyle: StyleObject,
  runStyle: StyleObject,
  runs: readonly InlineRun[],
): XmlElement {
  const paragraphEl = ownerDoc.createElementNS(WORD_NS, "w:p");
  const pPr = buildPPr(ownerDoc, paragraphStyle);
  if (pPr) paragraphEl.appendChild(pPr);
  for (const run of runs) {
    const runEl = ownerDoc.createElementNS(WORD_NS, "w:r");
    const rPr = buildRPr(ownerDoc, { ...runStyle, ...run });
    if (rPr) runEl.appendChild(rPr);
    const textEl = ownerDoc.createElementNS(WORD_NS, "w:t");
    setElementText(textEl, run.text);
    runEl.appendChild(textEl);
    paragraphEl.appendChild(runEl);
  }
  return paragraphEl;
}

function buildPPr(ownerDoc: XmlElement, style: StyleObject): XmlElement | null {
  const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
  let any = false;
  const child = (name: string, value: string, attr = "val"): void => {
    const el = ownerDoc.createElementNS(WORD_NS, name);
    el.setAttribute(`w:${attr}`, String(value));
    pPr.appendChild(el);
    any = true;
  };
  if (style.styleId) child("w:pStyle", String(style.styleId));
  if (style.spacing && typeof style.spacing === "object") {
    const el = ownerDoc.createElementNS(WORD_NS, "w:spacing");
    for (const key of ["before", "after", "line", "lineRule"]) {
      if (style.spacing[key] !== undefined) el.setAttribute(`w:${key}`, String(style.spacing[key]));
    }
    pPr.appendChild(el);
    any = true;
  }
  if (style.indent && typeof style.indent === "object") {
    const el = ownerDoc.createElementNS(WORD_NS, "w:ind");
    for (const key of ["left", "right", "firstLine", "hanging"]) {
      if (style.indent[key] !== undefined) el.setAttribute(`w:${key}`, String(style.indent[key]));
    }
    pPr.appendChild(el);
    any = true;
  }
  if (style.alignment) child("w:jc", String(style.alignment));
  if (style.outlineLevel !== undefined) child("w:outlineLvl", String(style.outlineLevel));
  if (style.keepNext) any = appendEmpty(pPr, ownerDoc, "w:keepNext") || any;
  if (style.keepLines) any = appendEmpty(pPr, ownerDoc, "w:keepLines") || any;
  if (style.pageBreakBefore) any = appendEmpty(pPr, ownerDoc, "w:pageBreakBefore") || any;
  return any ? pPr : null;
}

function appendEmpty(parent: XmlElement, ownerDoc: XmlElement, name: string): boolean {
  parent.appendChild(ownerDoc.createElementNS(WORD_NS, name));
  return true;
}

function buildRPr(ownerDoc: XmlElement, style: StyleObject): XmlElement | null {
  const rPr = ownerDoc.createElementNS(WORD_NS, "w:rPr");
  const set = (name: string, attrs: Record<string, string> = {}): void => {
    const el = ownerDoc.createElementNS(WORD_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(`w:${key}`, value);
    const order = RPR_ORDER.indexOf(name);
    const before = childElementsOf(rPr).find((c) => {
      const i = RPR_ORDER.indexOf(c.nodeName);
      return i >= 0 && order >= 0 && i > order;
    });
    rPr.insertBefore(el, before ?? null);
  };
  if (style.styleId) set("w:rStyle", { val: String(style.styleId) });
  if (style.bold) set("w:b");
  if (style.italic) set("w:i");
  if (style.strike) set("w:strike");
  if (style.underline) set("w:u", { val: typeof style.underline === "string" ? style.underline : "single" });
  if (style.color) set("w:color", { val: String(style.color) });
  if (style.highlight) set("w:highlight", { val: String(style.highlight) });
  if (style.fontSize) set("w:sz", { val: String(style.fontSize) });
  if (style.vertAlign) set("w:vertAlign", { val: String(style.vertAlign) });
  if (style.fontFamily && typeof style.fontFamily === "object") {
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(style.fontFamily)) attrs[key] = String(value);
    if (Object.keys(attrs).length > 0) set("w:rFonts", attrs);
  }
  return childElementsOf(rPr).length > 0 ? rPr : null;
}

/** 按 `w:rPr` 的 schema 顺序插入/更新子元素。 */
function setRPrChild(rPr: XmlElement, name: string, attributes: Record<string, string> = {}): void {
  const existing = childElementsOf(rPr).find((child) => child.nodeName === name);
  if (existing) {
    for (const [key, value] of Object.entries(attributes)) existing.setAttribute(`w:${key}`, value);
    return;
  }
  const element = createWordElement(rPr, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(`w:${key}`, value);
  const order = RPR_ORDER.indexOf(name);
  const before = childElementsOf(rPr).find((child) => {
    const index = RPR_ORDER.indexOf(child.nodeName);
    return index >= 0 && order >= 0 && index > order;
  });
  rPr.insertBefore(element, before ?? null);
}

/* -------------------------------- 删除 -------------------------------- */

function deleteRunElements(runEls: readonly unknown[]): boolean {
  let removed = false;
  for (const run of runEls) {
    const el = run as XmlElement;
    if (el?.parentNode) {
      el.parentNode.removeChild(el);
      removed = true;
    }
  }
  return removed;
}

function deleteParagraphElement(el: XmlElement): boolean {
  if (!el?.parentNode) return false;
  el.parentNode.removeChild(el);
  return true;
}

/* ------------------------------ OOXML 小工具 ------------------------------ */

function childElementsOf(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = element?.childNodes;
  if (!nodes) return out;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.nodeType === 1) out.push(nodes[i]);
  }
  return out;
}

function directChildrenNamed(element: XmlElement, name: string): XmlElement[] {
  return childElementsOf(element).filter((child) => child.nodeName === name);
}

function createWordElement(reference: XmlElement, name: string): XmlElement {
  return reference.ownerDocument.createElementNS(WORD_NS, name);
}

function readElementText(element: XmlElement): string {
  return element.textContent ?? "";
}

function setElementText(element: XmlElement, text: string): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  element.appendChild(element.ownerDocument.createTextNode(text));
  if (/^\s|\s$/.test(text)) element.setAttribute("xml:space", "preserve");
  else element.removeAttribute("xml:space");
}

const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";

/** 给缺少 `w14:paraId` 的段落补上稳定 ID（Word 2010+ 兼容，不可见）。 */
function assignMissingParaIds(doc: VirtualWordDocument): void {
  const parts = (doc as unknown as { partsData?: Array<{ xmlDocument?: any }> }).partsData;
  if (!Array.isArray(parts)) return;

  const used = new Set<string>();
  for (const part of parts) {
    const paragraphs = elementList(part.xmlDocument?.getElementsByTagName?.("w:p"));
    for (let i = 0; i < paragraphs.length; i += 1) {
      const id = paragraphs[i].getAttribute("w14:paraId");
      if (id) used.add(id);
    }
  }

  let seed = (Date.now() & 0xfffffff0) >>> 0;
  for (const part of parts) {
    const xmlDocument = part.xmlDocument;
    const root = xmlDocument?.documentElement;
    if (!root || typeof root.getAttribute !== "function") continue;
    if (!root.getAttribute("xmlns:w14") && typeof root.setAttributeNS === "function") {
      root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:w14", W14_NS);
    }

    const paragraphs = elementList(xmlDocument.getElementsByTagName?.("w:p"));
    for (let i = 0; i < paragraphs.length; i += 1) {
      const paragraph = paragraphs[i];
      if (paragraph.getAttribute("w14:paraId")) continue;
      let candidate: string;
      do {
        seed = (seed + 1) >>> 0;
        candidate = seed.toString(16).toUpperCase().padStart(8, "0");
      } while (used.has(candidate));
      used.add(candidate);
      paragraph.setAttribute("w14:paraId", candidate);
    }
  }
}

/** 把 xmldom 的 LiveNodeList 转成普通数组（它不实现 Symbol.iterator）。 */
function elementList(list: { length: number; [index: number]: any } | undefined | null): XmlElement[] {
  const out: XmlElement[] = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i += 1) out.push(list[i]);
  return out;
}
