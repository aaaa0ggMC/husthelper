import type { VirtualWordDocument, VNode } from "docx-edit";
import { analyzeDocument } from "./analyze.ts";
import { paragraphKey, paragraphKeyOfRef, walkParagraphs } from "./walk.ts";
import type { Segment } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DEFAULT_PREFIX = "hrseg";

/** 注入到文档里的持久锚点（书签）元数据。 */
export interface StampedAnchor {
  /** 书签名，同时作为稳定 ref。 */
  ref: string;
  /** slot = 原地填空；insert = 可在此处插入内容。 */
  kind: "slot" | "insert";
  /** 便于人和 AI 理解的示例文本。 */
  label: string;
  /** 建议套用的样式（segment 自己的样式）。 */
  styleId: number;
  part: string;
  paragraph: number;
  paragraphText?: string;
}

export interface StampOptions {
  /** 书签名前缀，默认 `hrseg`。 */
  prefix?: string;
  /** 只给满足条件的 segment 打锚；默认全部非空 segment。 */
  filter?: (segment: Segment) => boolean;
}

/**
 * 给每个 segment 注入一对隐藏书签（core OOXML，Word/WPS/LibreOffice 都会保留）。
 *
 * 这是**跨进程/跨次编辑**才需要的持久锚点；只在会话内编辑用 `AnchorRegistry` 即可。
 * 产出最终文档前记得 `stripAnchors()`。
 */
export function stampAnchors(doc: VirtualWordDocument, options: StampOptions = {}): StampedAnchor[] {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const analysis = analyzeDocument(doc);
  const rawWalk = walkParagraphs(resolveRawTree(doc), { includeEmptyParagraphs: true });
  const byKey = new Map(rawWalk.paragraphs.map((paragraph) => [paragraphKey(paragraph), paragraph]));

  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  collectExistingBookmarks(doc, usedIds, usedNames);

  let counter = 0;
  const stamped: StampedAnchor[] = [];

  for (const segment of analysis.segments) {
    if (segment.text.length === 0) continue;
    if (options.filter && !options.filter(segment)) continue;

    const paragraph = byKey.get(paragraphKeyOfRef(segment.ref.id));
    if (!paragraph) continue;
    const paragraphEl = paragraph.node.source as XmlElement | null;
    if (!paragraphEl) continue;

    const runs = paragraph.runs.slice(segment.ref.runStart, segment.ref.runEnd);
    const firstRun = runs[0]?.node.source as XmlElement | undefined;
    const lastRun = runs[runs.length - 1]?.node.source as XmlElement | undefined;
    if (!firstRun || !lastRun) continue;

    counter += 1;
    const name = allocateName(prefix, counter, usedNames);
    const id = allocateId(usedIds);
    insertBookmarkPair(paragraphEl, firstRun, lastRun, id, name);

    const fullParagraphText = paragraph.runs.map((r) => r.text).join("");
    stamped.push({
      ref: name,
      kind: isPlaceholder(segment.text) ? "slot" : "insert",
      label: segment.text.slice(0, 40),
      styleId: segment.styleId,
      part: segment.ref.part,
      paragraph: segment.ref.paragraph,
      paragraphText: fullParagraphText,
    });
  }

  (doc as unknown as { rebuildFromXml?: () => void }).rebuildFromXml?.();
  return stamped;
}

/** 读回文档里的锚点（渲染时用）。 */
export interface BookmarkRange {
  ref: string;
  start: XmlElement;
  end: XmlElement | null;
  paragraphEl: XmlElement;
  /** start..end 之间的 `w:r` 元素。 */
  runEls: XmlElement[];
}

export function readAnchors(doc: VirtualWordDocument, prefix: string = DEFAULT_PREFIX): BookmarkRange[] {
  const roots = partRoots(doc);
  const starts = new Map<string, XmlElement>();
  const ends = new Map<string, XmlElement>();

  for (const root of roots) {
    for (const element of elementList(root.getElementsByTagName?.("w:bookmarkStart"))) {
      const name = element.getAttribute("w:name") || element.getAttribute("name");
      const id = element.getAttribute("w:id") || element.getAttribute("id");
      if (name && name.startsWith(prefix) && id) starts.set(id, element);
    }
    for (const element of elementList(root.getElementsByTagName?.("w:bookmarkEnd"))) {
      const id = element.getAttribute("w:id") || element.getAttribute("id");
      if (id && starts.has(id)) ends.set(id, element);
    }
  }

  const ranges: BookmarkRange[] = [];
  for (const [id, start] of starts) {
    const end = ends.get(id) ?? null;
    const paragraphEl = start.parentNode;
    if (!paragraphEl) continue;
    ranges.push({
      ref: start.getAttribute("w:name"),
      start,
      end,
      paragraphEl,
      runEls: runsBetween(paragraphEl, start, end),
    });
  }
  return ranges;
}

/** 移除本系统注入的书签（产出最终文档前调用）。返回删除数量。 */
export function stripAnchors(doc: VirtualWordDocument, prefix: string = DEFAULT_PREFIX): number {
  let removed = 0;
  for (const root of partRoots(doc)) {
    const starts = elementList(root.getElementsByTagName?.("w:bookmarkStart")).filter((el) => {
      const name = el.getAttribute("w:name") || el.getAttribute("name");
      return name && name.startsWith(prefix);
    });
    const ids = new Set(starts.map((el) => el.getAttribute("w:id") || el.getAttribute("id")));
    for (const el of starts) {
      el.parentNode?.removeChild(el);
      removed += 1;
    }
    for (const el of elementList(root.getElementsByTagName?.("w:bookmarkEnd"))) {
      const id = el.getAttribute("w:id") || el.getAttribute("id");
      if (ids.has(id)) {
        el.parentNode?.removeChild(el);
        removed += 1;
      }
    }
  }
  return removed;
}

/* ------------------------------- 内部实现 ------------------------------- */

export function insertBookmarkPair(paragraphEl: XmlElement, firstRun: XmlElement, lastRun: XmlElement, id: string, name: string): void {
  const owner = paragraphEl.ownerDocument;
  const start = owner.createElementNS(WORD_NS, "w:bookmarkStart");
  start.setAttribute("w:id", id);
  start.setAttribute("w:name", name);
  const end = owner.createElementNS(WORD_NS, "w:bookmarkEnd");
  end.setAttribute("w:id", id);

  const topFirst = topLevelChild(paragraphEl, firstRun);
  const topLast = topLevelChild(paragraphEl, lastRun);
  paragraphEl.insertBefore(start, topFirst);
  paragraphEl.insertBefore(end, topLast.nextSibling);
}

/** 从 run 往上找到作为 paragraph 直接子节点的元素（超链接/sdt 内的 run 也能正确包住）。 */
function topLevelChild(paragraphEl: XmlElement, runEl: XmlElement): XmlElement {
  let node: XmlElement = runEl;
  while (node.parentNode && node.parentNode !== paragraphEl) node = node.parentNode;
  return node;
}

export function runsBetween(paragraphEl: XmlElement, start: XmlElement, end: XmlElement | null): XmlElement[] {
  const children = elementList(paragraphEl.childNodes);
  const startIndex = children.indexOf(start);
  const endIndex = end ? children.indexOf(end) : children.length;
  if (startIndex < 0) return [];
  const slice = children.slice(startIndex + 1, endIndex < 0 ? undefined : endIndex);
  const runs: XmlElement[] = [];
  const visit = (element: XmlElement): void => {
    if (element.nodeName === "w:r") {
      runs.push(element);
      return;
    }
    for (const child of elementList(element.childNodes)) visit(child);
  };
  for (const element of slice) visit(element);
  return runs;
}

function collectExistingBookmarks(doc: VirtualWordDocument, usedIds: Set<string>, usedNames: Set<string>): void {
  for (const root of partRoots(doc)) {
    for (const element of elementList(root.getElementsByTagName?.("w:bookmarkStart"))) {
      const id = element.getAttribute("w:id") || element.getAttribute("id");
      const name = element.getAttribute("w:name") || element.getAttribute("name");
      if (id) usedIds.add(id);
      if (name) usedNames.add(name);
    }
  }
}

function allocateName(prefix: string, counter: number, used: Set<string>): string {
  let n = counter;
  let name = `${prefix}${String(n).padStart(4, "0")}`;
  while (used.has(name)) {
    n += 1;
    name = `${prefix}${String(n).padStart(4, "0")}`;
  }
  used.add(name);
  return name;
}

function allocateId(used: Set<string>): string {
  let id = 1;
  while (used.has(String(id))) id += 1;
  used.add(String(id));
  return String(id);
}

function isPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || /^[_\-—\s.．。·]+$/.test(trimmed) || /^(此处|待填|填写|xxx|XXX|todo)/i.test(trimmed);
}

function resolveRawTree(doc: VirtualWordDocument): VNode {
  const candidate = (doc as unknown as { rootVNode?: VNode }).rootVNode;
  return candidate ?? doc.toComponentTree();
}

function partRoots(doc: VirtualWordDocument): XmlElement[] {
  const parts = (doc as unknown as { partsData?: Array<{ xmlDocument?: any }> }).partsData;
  if (!Array.isArray(parts)) return [];
  return parts.map((part) => part.xmlDocument?.documentElement).filter(Boolean);
}

function elementList(list: { length: number; [index: number]: any } | undefined | null): XmlElement[] {
  const out: XmlElement[] = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i += 1) out.push(list[i]);
  return out;
}
