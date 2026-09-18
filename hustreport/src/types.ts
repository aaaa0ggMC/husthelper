/** 样式对象：docx-edit 解析出的 `w:pPr` / `w:rPr` 直接格式（结构见 docx-edit 的样式模型）。 */
export type StyleObject = Record<string, any>;

/** docx-edit 虚拟树里的 part 根类型。未知类型也会被当作 part 处理。 */
export type PartType = string;

export const KNOWN_PART_TYPES = [
  "body",
  "header",
  "footer",
  "footnotes",
  "endnotes",
  "comments",
] as const;

/**
 * 一个位置上的样式快照。
 *
 * `direct` 是文档里真实写在 `w:pPr` / `w:rPr` 上的内容（含 `styleId` 引用），
 * `effective` 则是 `docDefaults → 命名样式继承链 → 直接格式` 合并后的结果，
 * 用于让 AI 理解“这块内容看起来是什么样”。
 */
export interface StyleSnapshot {
  /** `w:pStyle` / `w:rStyle` 的 `w:val`，没有则为 null。 */
  ooxmlStyleId: string | null;
  /** 直接格式，来自虚拟树节点的 `props.style`。 */
  direct: StyleObject;
  /** 解析后的有效样式。 */
  effective: StyleObject;
  /** 段落专有：由大纲级别 / 样式名解析出的标题级别（1-9），非标题为 null。 */
  headingLevel?: number | null;
}

/**
 * 段落的稳定定位。
 *
 * 稳定性来自 Word 的 `w14:paraId`（每段唯一、跨保存不变），而不是会随编辑漂移的
 * 段落序号 / run 序号；段内再用「该段第几个 segment」（`s<index>`）定位。
 * 这样改文本、重载、插入/删除其它段落都不会让已有 ref 失效。
 *
 * `id` 形如 `body#0/p@4E2EFCDF/s1`；文档没有 `paraId` 时退化为 `body#0/p12/s1`。
 */
export interface SegmentRef {
  /** part 类型，如 body / header / footer / footnotes。 */
  part: PartType;
  /** 同类型 part 的序号（例如第 2 个 header 为 1）。 */
  partIndex: number;
  /** part 内按先序（深度优先）排列的段落序号，从 0 开始（仅可读/兜底，非身份）。 */
  paragraph: number;
  /** Word 稳定段落 ID（`w14:paraId`），没有则为 null。 */
  paraId: string | null;
  /** 段内第几个 segment（0 开始，按样式切分后的顺序）。 */
  segment: number;
  /**
   * 会话内 anchor（`a1`、`a2`…）。由 `AnchorRegistry` 分配，只在单次
   * analyze → AI → 编辑流程内有效；为 null 时退回 paraId/序号定位。
   */
  anchor: string | null;
  /** 段内 run 序号区间起点（含），run 按先序排列（内部定位用，不参与身份）。 */
  runStart: number;
  /** 段内 run 序号区间终点（不含）（内部定位用，不参与身份）。 */
  runEnd: number;
  /** 稳定定位串。 */
  id: string;
}

/** 一种“段落样式 + run 样式”组合，对应 CSV 里的一个 XML Style ID。 */
export interface StyleEntry {
  /** 从 0 开始的数字 ID，即导出 CSV 里的 `XML Style ID`。 */
  id: number;
  /** 归一化签名，用于去重。 */
  key: string;
  /** 段落级样式快照。 */
  paragraph: StyleSnapshot;
  /** run 级样式快照。 */
  run: StyleSnapshot;
  /** 使用该样式的 segment 数量。 */
  segmentCount: number;
  /** 供 AI 参考的少量文本样例。 */
  examples: string[];
  /** 首次出现时的 segment 全局序号。 */
  firstSegmentIndex: number;
  /** 人类可读摘要（字体/字号/加粗/对齐等）。 */
  summary: string;
}

/** 多媒体（图片等）在 CSV 里以 `img_xxxx` handle 出现，详细元数据存这里。 */
export interface MediaEntry {
  /** 文本流里的 handle，例如 `img_0001`。 */
  handle: string;
  kind: "image";
  /** 原始虚拟树节点，供引擎后续复制/替换使用。 */
  node: unknown;
  part: PartType;
  partIndex: number;
  paragraph: number;
  /** 段内 run 序号；段落级浮动图片为加入伪 run 后的序号。 */
  run: number;
  relId: string | null;
  filename: string | null;
  contentType: string | null;
  /** docx 包内路径，如 `word/media/image1.png`。 */
  mediaPath: string | null;
  /** EMU 宽度/高度。 */
  width: string | null;
  height: string | null;
  alt: string | null;
  layout: unknown;
}

/** 一段样式一致、连续的内容。 */
export interface Segment {
  /** 全局递增序号，即 CSV 的 `Index`。 */
  index: number;
  /** 文档定位。 */
  ref: SegmentRef;
  /** 文本内容。 */
  text: string;
  /** 所属样式 ID，即 CSV 的 `XML Style ID`。 */
  styleId: number;
}

/** `analyzeDocument()` 的完整产物。 */
export interface DocumentAnalysis {
  segments: Segment[];
  styles: StyleEntry[];
  media: MediaEntry[];
  meta: {
    segmentCount: number;
    styleCount: number;
    charCount: number;
    /** 各 part 的段落数量，便于快速了解文档结构。 */
    partParagraphCounts: Record<string, number>;
  };
}
