import type { EffectiveStyle, VNode } from "docx-edit";
import type {
  DocumentAnalysis,
  MediaEntry,
  Segment,
  SegmentRef,
  StyleEntry,
  StyleSnapshot,
} from "./types.ts";
import { canonicalize, mergeStyles, summarizeStylePair } from "./util.ts";
import { segmentRefId, walkParagraphs } from "./walk.ts";
import type { AnchorRegistry } from "./anchors.ts";

/** `analyzeDocument()` 只需要 docx-edit 文档的这些能力，便于测试时注入假对象。 */
export interface AnalyzableDocument {
  toComponentTree(): VNode;
  resolveEffectiveStyle(styleId: string | null): EffectiveStyle;
  resolveHeadingLevel(styleId: string | null): number | null;
}

export interface AnalyzeOptions {
  /** 只分析这些 part 类型（默认全部，含 body/header/footer/footnotes/endnotes/comments）。 */
  partTypes?: readonly string[];
  /** 是否保留纯空段落（默认 false）。 */
  includeEmptyParagraphs?: boolean;
  /** 每个样式保留多少条文本样例（默认 3）。 */
  maxExamplesPerStyle?: number;
  /**
   * 会话内 anchor 注册表。传入时 ref 用会话 anchor（`a1`…），
   * 在 analyze → AI → 编辑流程内恒定；不传则退回 paraId/序号。
   */
  registry?: AnchorRegistry;
}

interface PendingSegment {
  text: string;
  runStart: number;
  runEnd: number;
  segment: number;
}

/**
 * 优先用带 `source` 的原树（能读到 `w14:paraId`）；测试注入的假对象没有 `rootVNode`，
 * 退回 `toComponentTree()`。
 */
function resolveTree(doc: AnalyzableDocument): VNode {
  const candidate = (doc as unknown as { rootVNode?: VNode }).rootVNode;
  return candidate ?? doc.toComponentTree();
}

/**
 * 解析文档，按“段落样式 + run 样式”组合切分内容，输出 segment 列表与样式表。
 *
 * 同一个段落内，连续且样式相同的 run 会合并成一段；不同段落即使样式相同也不会跨段合并。
 */
export function analyzeDocument(doc: AnalyzableDocument, options: AnalyzeOptions = {}): DocumentAnalysis {
  const includeEmpty = options.includeEmptyParagraphs ?? false;
  const maxExamples = options.maxExamplesPerStyle ?? 3;
  const { paragraphs, media } = walkParagraphs(resolveTree(doc), {
    partTypes: options.partTypes,
    includeEmptyParagraphs: includeEmpty,
  });

  const effectiveCache = new Map<string | null, EffectiveStyle>();
  const effective = (styleId: string | null): EffectiveStyle => {
    const cached = effectiveCache.get(styleId);
    if (cached) return cached;
    const resolved = doc.resolveEffectiveStyle(styleId);
    effectiveCache.set(styleId, resolved);
    return resolved;
  };

  const entries: StyleEntry[] = [];
  const idByKey = new Map<string, number>();
  const segments: Segment[] = [];
  const partParagraphCounts: Record<string, number> = {};

  const internStyle = (paragraph: StyleSnapshot, run: StyleSnapshot): StyleEntry => {
    const key = canonicalize({ p: paragraph.direct, r: run.direct });
    const existingId = idByKey.get(key);
    if (existingId !== undefined) return entries[existingId];

    const entry: StyleEntry = {
      id: entries.length,
      key,
      paragraph,
      run,
      segmentCount: 0,
      examples: [],
      firstSegmentIndex: segments.length,
      summary: summarizeStylePair(paragraph, run),
    };
    entries.push(entry);
    idByKey.set(key, entry.id);
    return entry;
  };

  for (const paragraph of paragraphs) {
    const partKey = `${paragraph.part}#${paragraph.partIndex}`;
    partParagraphCounts[partKey] = Math.max(partParagraphCounts[partKey] ?? 0, paragraph.paragraph + 1);

    const paragraphEffective = effective(paragraph.ooxmlStyleId);
    const paragraphSnapshot: StyleSnapshot = {
      ooxmlStyleId: paragraph.ooxmlStyleId,
      direct: paragraph.style,
      effective: mergeStyles(paragraphEffective.paragraphStyle, paragraph.style),
      headingLevel: doc.resolveHeadingLevel(paragraph.ooxmlStyleId),
    };

    const makeRef = (segment: number, runStart: number, runEnd: number): SegmentRef => {
      const runEls = paragraph.runs
        .slice(runStart, runEnd)
        .map((run) => run.node.source)
        .filter((source): source is object => Boolean(source) && typeof source === "object");
      const key = runEls[0] ?? (typeof paragraph.node.source === "object" ? paragraph.node.source : null);

      let anchor: string | null = null;
      if (options.registry && key) {
        anchor = options.registry.assign(key, paragraph.node.source ?? null, runEls);
      }

      return {
        part: paragraph.part,
        partIndex: paragraph.partIndex,
        paragraph: paragraph.paragraph,
        paraId: paragraph.paraId,
        segment,
        anchor,
        runStart,
        runEnd,
        id: anchor ?? segmentRefId(paragraph, segment),
      };
    };

    let segmentOrdinal = 0;

    if (includeEmpty && paragraph.runs.length === 0) {
      const runSnapshot: StyleSnapshot = {
        ooxmlStyleId: null,
        direct: {},
        effective: mergeStyles(paragraphEffective.runStyle),
      };
      const entry = internStyle(paragraphSnapshot, runSnapshot);
      segments.push({ index: segments.length, ref: makeRef(segmentOrdinal, 0, 0), text: "", styleId: entry.id });
      entry.segmentCount += 1;
      continue;
    }

    let pending: PendingSegment | null = null;
    let pendingEntry: StyleEntry | null = null;

    const flush = (): void => {
      if (!pending || !pendingEntry) return;
      const ref = makeRef(pending.segment, pending.runStart, pending.runEnd);
      const segment: Segment = { index: segments.length, ref, text: pending.text, styleId: pendingEntry.id };
      segments.push(segment);
      pendingEntry.segmentCount += 1;
      if (pendingEntry.examples.length < maxExamples && pending.text.trim().length > 0) {
        pendingEntry.examples.push(pending.text);
      }
      pending = null;
      pendingEntry = null;
    };

    for (let runIndex = 0; runIndex < paragraph.runs.length; runIndex += 1) {
      const run = paragraph.runs[runIndex];
      if (!includeEmpty && run.text.length === 0) continue;

      const runEffective = effective(run.ooxmlStyleId);
      const runSnapshot: StyleSnapshot = {
        ooxmlStyleId: run.ooxmlStyleId,
        direct: run.style,
        effective: mergeStyles(paragraphEffective.runStyle, runEffective.runStyle, run.style),
      };
      const entry = internStyle(paragraphSnapshot, runSnapshot);

      if (pending && pendingEntry && pendingEntry.id === entry.id) {
        pending.text += run.text;
        pending.runEnd = runIndex + 1;
      } else {
        flush();
        pending = { text: run.text, runStart: runIndex, runEnd: runIndex + 1, segment: segmentOrdinal };
        pendingEntry = entry;
        segmentOrdinal += 1;
      }
    }

    flush();
  }

  const charCount = segments.reduce((total, segment) => total + segment.text.length, 0);

  return {
    segments,
    styles: entries,
    media: media as MediaEntry[],
    meta: {
      segmentCount: segments.length,
      styleCount: entries.length,
      charCount,
      partParagraphCounts,
    },
  };
}
