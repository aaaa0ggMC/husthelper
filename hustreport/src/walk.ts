import type { VNode } from "docx-edit";
import { cloneStyle } from "./util.ts";
import type { MediaEntry, PartType, StyleObject } from "./types.ts";

export interface CollectedRun {
  node: VNode;
  /** 可见文本（含 tab / 换行 / 公式占位符 / 媒体 handle），已剔除域代码。 */
  text: string;
  /** `props.style`，即 `w:rPr` 直接格式；段落级媒体为 `{}`。 */
  style: StyleObject;
  /** `w:rStyle` 的 val。 */
  ooxmlStyleId: string | null;
}

export interface CollectedParagraph {
  node: VNode;
  part: PartType;
  partIndex: number;
  /** part 内先序段落序号。 */
  paragraph: number;
  /** Word 稳定段落 ID（`w14:paraId`），没有则为 null。 */
  paraId: string | null;
  /** `props.style`，即 `w:pPr` 直接格式。 */
  style: StyleObject;
  /** `w:pStyle` 的 val。 */
  ooxmlStyleId: string | null;
  runs: CollectedRun[];
}

export interface WalkResult {
  paragraphs: CollectedParagraph[];
  /** 文档中遇到的所有多媒体（图片），CSV 里以 `img_xxxx` 形式出现。 */
  media: MediaEntry[];
}

/** 段落的稳定 key：优先 `w14:paraId`，否则退化为 part 内序号。 */
export function paragraphKey(paragraph: CollectedParagraph): string {
  const anchor = paragraph.paraId ? `p@${paragraph.paraId}` : `p${paragraph.paragraph}`;
  return `${paragraph.part}#${paragraph.partIndex}/${anchor}`;
}

/** segment 的稳定 ref：段落 key + 段内第几个 segment。 */
export function segmentRefId(paragraph: CollectedParagraph, segmentIndex: number): string {
  return `${paragraphKey(paragraph)}/s${segmentIndex}`;
}

/** 从 segment ref 取出段落 key（去掉结尾的 `/sN`）。 */
export function paragraphKeyOfRef(ref: string): string {
  return ref.replace(/\/s\d+$/, "");
}

export interface WalkOptions {
  /** 只遍历这些 part 类型；不传表示全部。 */
  partTypes?: readonly string[];
  /** 是否保留纯空段落（默认 false）。 */
  includeEmptyParagraphs?: boolean;
  /**
   * `paraId` 兜底表：`doc.toComponentTree()` 会丢失 `source`，此时用节点的数字 id
   * 从这里取回真实 `w14:paraId`（由带 source 的原树 walk 得到）。
   */
  paraIdById?: ReadonlyMap<number, string>;
}

/** 先序遍历 part 子树，按文档顺序收集段落、run 与多媒体。 */
export function walkParagraphs(root: VNode, options: WalkOptions = {}): WalkResult {
  const paragraphs: CollectedParagraph[] = [];
  const media: MediaEntry[] = [];
  const partCounters = new Map<string, number>();
  let mediaSequence = 0;

  const createMedia = (node: VNode, part: PartType, partIndex: number, paragraph: number, run: number): string => {
    mediaSequence += 1;
    const handle = `img_${String(mediaSequence).padStart(4, "0")}`;
    media.push({
      handle,
      kind: "image",
      node,
      part,
      partIndex,
      paragraph,
      run,
      relId: (node.props.relId as string | undefined) ?? null,
      filename: (node.props.filename as string | undefined) ?? null,
      contentType: (node.props.contentType as string | undefined) ?? null,
      mediaPath: (node.props.mediaPath as string | undefined) ?? null,
      width: (node.props.width as string | undefined) ?? null,
      height: (node.props.height as string | undefined) ?? null,
      alt: (node.props.alt as string | undefined) ?? null,
      layout: node.props.layout ?? null,
    });
    return handle;
  };

  for (const partNode of root.children) {
    const partType = partNode.type;
    const partIndex = partCounters.get(partType) ?? 0;
    partCounters.set(partType, partIndex + 1);

    if (options.partTypes && !options.partTypes.includes(partType)) continue;

    let paragraphOrdinal = 0;
    for (const paragraphNode of collectParagraphNodes(partNode)) {
      const runs = collectRuns(paragraphNode, (node, runIndex) =>
        createMedia(node, partType, partIndex, paragraphOrdinal, runIndex),
      );
      const hasContent = runs.some((run) => run.text.length > 0);
      if (!options.includeEmptyParagraphs && !hasContent) {
        paragraphOrdinal += 1;
        continue;
      }

      paragraphs.push({
        node: paragraphNode,
        part: partType,
        partIndex,
        paragraph: paragraphOrdinal,
        paraId: readParaId(paragraphNode, options.paraIdById),
        style: cloneStyle(paragraphNode.props.style ?? {}),
        ooxmlStyleId: readOoxmlStyleId(paragraphNode.props.style),
        runs,
      });
      paragraphOrdinal += 1;
    }
  }

  return { paragraphs, media };
}

/** 找出 part 子树里所有段落（遇到段落即停止下钻，避免收集到嵌套段落）。 */
function collectParagraphNodes(node: VNode): VNode[] {
  const out: VNode[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      out.push(child);
    } else {
      out.push(...collectParagraphNodes(child));
    }
  }
  return out;
}

/**
 * 收集段落内的 run（含超链接 / sdt 内嵌 run），保持文档顺序；
 * 段落级浮动图片（不在 run 内）会以伪 run 形式加入，保证媒体仍出现在文本流里。
 */
function collectRuns(
  paragraph: VNode,
  createMedia: (node: VNode, runIndex: number) => string,
): CollectedRun[] {
  const runs: CollectedRun[] = [];

  const visit = (node: VNode): void => {
    for (const child of node.children) {
      if (child.type === "run") {
        const runIndex = runs.length;
        runs.push({
          node: child,
          text: extractRunText(child, (imageNode) => createMedia(imageNode, runIndex)),
          style: cloneStyle(child.props.style ?? {}),
          ooxmlStyleId: readOoxmlStyleId(child.props.style),
        });
      } else if (child.type === "image") {
        if (!isMediaImage(child)) continue; // 无 relId 的 drawing 是形状/文本框，不是图片
        const runIndex = runs.length;
        runs.push({
          node: child,
          text: createMedia(child, runIndex),
          style: {},
          ooxmlStyleId: null,
        });
      } else if (child.type === "paragraph") {
        continue;
      } else {
        visit(child);
      }
    }
  };

  visit(paragraph);
  return runs;
}

function extractRunText(run: VNode, mediaHandle: (imageNode: VNode) => string): string {
  let out = "";
  const visit = (node: VNode): void => {
    switch (node.type) {
      case "text":
      case "tab":
      case "break":
        out += node.props.text ?? "";
        return;
      case "math":
        out += node.props.placeholder ?? node.props.text ?? "";
        return;
      case "image":
        if (isMediaImage(node)) out += mediaHandle(node);
        return;
      case "instrText":
      case "fldChar":
      case "footnoteReference":
      case "endnoteReference":
      case "footnoteRef":
      case "endnoteRef":
        return;
      default:
        for (const child of node.children) visit(child);
    }
  };
  visit(run);
  return out;
}

/** 从真实 `w:p` 元素读取 `w14:paraId`；克隆树丢 source 时用兜底表。 */
function readParaId(node: VNode, fallback?: ReadonlyMap<number, string>): string | null {
  const source = node.source as { getAttribute?: (name: string) => string | null } | null;
  const fromSource = source && typeof source.getAttribute === "function" ? source.getAttribute("w14:paraId") : null;
  if (fromSource) return fromSource;
  return fallback?.get(node.id) ?? null;
}

/** 只有带 relId 的 drawing 才是真正的图片；否则是形状/文本框。 */
function isMediaImage(node: VNode): boolean {
  return Boolean(node.props && node.props.relId);
}

function readOoxmlStyleId(style: unknown): string | null {
  if (style && typeof style === "object" && typeof (style as StyleObject).styleId === "string") {
    return (style as StyleObject).styleId as string;
  }
  return null;
}
