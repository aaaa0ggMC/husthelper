import type { VirtualWordDocument } from "docx-edit";
import { analyzeDocument, type AnalyzeOptions } from "./analyze.ts";
import { AnchorRegistry } from "./anchors.ts";
import { formatSegmentsCsv } from "./csv.ts";
import { openDocx } from "./docx.ts";
import {
  applyEdits,
  selectSegments,
  type AppliedDelete,
  type AppliedEdit,
  type AppliedInsert,
  type DeleteEdit,
  type EditPlan,
  type EditResult,
  type InsertEdit,
  type SegmentSelector,
  type TextEdit,
} from "./edits.ts";
import type { DocumentAnalysis, Segment, StyleEntry } from "./types.ts";

/** 目标可以是：稳定 ref 字符串、`Segment` 对象、选择器，或它们的数组（批量）。 */
export type EditorTarget = string | Segment | SegmentSelector;
export type EditorTargets = EditorTarget | readonly EditorTarget[];

export interface EditorInsertOptions {
  /**
   * 复用哪个已有 XML Style ID。**可省略**：默认复用目标 segment 自己的样式，
   * 因此大多数场景直接 `insertAfter(ref, "文字")` 即可，不必先查样式表。
   */
  useStyleId?: number;
  /** run = 同段落内插入；paragraph = 新建段落。默认 paragraph。 */
  as?: "run" | "paragraph";
  /** 相对目标的位置，默认 after。 */
  position?: "before" | "after";
}

export interface EditorDeleteOptions {
  as?: "run" | "paragraph";
}

export interface EditorOptions {
  /** 只处理这些 part（默认全部）。 */
  partTypes?: readonly string[];
  /** 是否保留空段落。 */
  includeEmptyParagraphs?: boolean;
  maxExamplesPerStyle?: number;
}

export interface EditStats {
  applied: number;
  inserted: number;
  deleted: number;
  warnings: string[];
}

/**
 * 面向调用的文档编辑器门面（也是沙盒 API 的实现）。
 *
 * 所有操作先累积成计划，`commit()` / `save()` 时一次性写回；ref 用会话 anchor，
 * 因此每次 commit 后会重新分析，但已有 segment 的 ref 保持不变。
 *
 * ```ts
 * const editor = await createEditor("a.docx");
 * editor.set({ styleId: 8 }, "张三");                       // 选择器
 * editor.set("a21", "U202612345");                          // 直接 ref
 * editor.insertAfter(editor.find({ match: { contains: "五、源码" } })[0], "六、参考文献");
 * editor.remove({ match: { contains: "占位" } });
 * await editor.save("a.out.docx");
 * ```
 */
export class DocumentEditor {
  readonly doc: VirtualWordDocument;
  readonly anchors = new AnchorRegistry();
  private currentAnalysis: DocumentAnalysis;
  private plan: { set: TextEdit[]; insert: InsertEdit[]; delete: DeleteEdit[] } = { set: [], insert: [], delete: [] };
  private history: EditResult = emptyResult();

  constructor(doc: VirtualWordDocument, analysis?: DocumentAnalysis, options: EditorOptions = {}) {
    this.doc = doc;
    this.currentAnalysis = analysis ?? analyzeDocument(doc, { ...options, registry: this.anchors });
  }

  get analysis(): DocumentAnalysis {
    return this.currentAnalysis;
  }

  get segments(): readonly Segment[] {
    return this.currentAnalysis.segments;
  }

  get styles(): readonly StyleEntry[] {
    return this.currentAnalysis.styles;
  }

  /** 尚未 commit 的操作数。 */
  get pending(): number {
    return this.plan.set.length + this.plan.insert.length + this.plan.delete.length;
  }

  /** 自创建以来累计的编辑统计。 */
  get stats(): EditStats {
    return {
      applied: this.history.applied,
      inserted: this.history.inserted,
      deleted: this.history.deleted,
      warnings: [...this.history.warnings],
    };
  }

  get warnings(): readonly string[] {
    return this.history.warnings;
  }

  /** 按选择器查询 segment。 */
  find(target: EditorTargets): Segment[] {
    const seen = new Set<string>();
    const out: Segment[] = [];
    for (const selector of normalizeTargets(target)) {
      for (const segment of selectSegments(this.currentAnalysis, selector)) {
        if (seen.has(segment.ref.id)) continue;
        seen.add(segment.ref.id);
        out.push(segment);
      }
    }
    return out;
  }

  /** 取第一个匹配 segment 的文本。 */
  text(target: EditorTargets): string | null {
    return this.find(target)[0]?.text ?? null;
  }

  /** 改写文本；target 可以是数组（批量）。 */
  set(target: EditorTargets, text: string, mode: TextEdit["mode"] = "replace"): this {
    for (const selector of normalizeTargets(target)) this.plan.set.push({ ...selector, text, mode });
    return this;
  }

  /** 在目标 segment 之后插入（默认新建段落、复用目标样式）。 */
  insertAfter(target: EditorTarget, text: string, options: Omit<EditorInsertOptions, "position"> = {}): this {
    return this.insert(target, text, { ...options, position: "after" });
  }

  /** 在目标 segment 之前插入。 */
  insertBefore(target: EditorTarget, text: string, options: Omit<EditorInsertOptions, "position"> = {}): this {
    return this.insert(target, text, { ...options, position: "before" });
  }

  /** 插入：只复用已有样式，不新建。 */
  insert(target: EditorTarget, text: string, options: EditorInsertOptions = {}): this {
    for (const selector of normalizeTargets(target)) this.plan.insert.push({ ...selector, text, ...options });
    return this;
  }

  /** 在同一个锚点后按顺序插入多段（一次 commit 完成，顺序与数组一致）。 */
  insertManyAfter(target: EditorTarget, items: ReadonlyArray<{ text: string; useStyleId?: number; as?: "run" | "paragraph" }>): this {
    for (const item of items) this.insertAfter(target, item.text, { useStyleId: item.useStyleId, as: item.as });
    return this;
  }

  /** 删除；target 可以是数组。 */
  remove(target: EditorTargets, options: EditorDeleteOptions = {}): this {
    for (const selector of normalizeTargets(target)) this.plan.delete.push({ ...selector, ...options });
    return this;
  }

  /** 与沙盒 API 对齐的别名。 */
  delete(target: EditorTargets, options: EditorDeleteOptions = {}): this {
    return this.remove(target, options);
  }

  /** 便于喂给 AI 的当前 segments CSV。 */
  segmentsCsv(): string {
    return formatSegmentsCsv(this.currentAnalysis.segments);
  }

  /** 应用计划并刷新分析（可继续追加操作）。返回本批次结果。 */
  commit(): EditResult {
    const result = applyEdits(this.doc, this.plan, { analysis: this.currentAnalysis, registry: this.anchors });
    this.plan = { set: [], insert: [], delete: [] };
    this.history = mergeResults(this.history, result);
    // 底层 XML 元素未被替换，注册表能复用同一批 anchor；新插入的段落会分到新 anchor。
    this.currentAnalysis = analyzeDocument(this.doc, { registry: this.anchors });
    return result;
  }

  /** commit + 另存，返回累计结果。 */
  async save(outputPath: string): Promise<EditResult> {
    this.commit();
    await this.doc.saveAs(outputPath);
    return this.history;
  }
}

/** 打开文档并创建编辑器。 */
export async function createEditor(input: string | Buffer, options: EditorOptions = {}): Promise<DocumentEditor> {
  const doc = await openDocx(input);
  return new DocumentEditor(doc, undefined, options);
}

/** 兼容旧名。 */
export function summarize(result: EditResult): { set: AppliedEdit[]; insert: AppliedInsert[]; delete: AppliedDelete[] } {
  return { set: result.edits, insert: result.inserts, delete: result.deletes };
}

function normalizeTargets(target: EditorTargets): SegmentSelector[] {
  const list = Array.isArray(target) ? target : [target];
  return list.map(toSelector);
}

function toSelector(target: EditorTarget): SegmentSelector {
  if (typeof target === "string") return { ref: target };
  if (isSegment(target)) return { ref: target.ref.id };
  return target;
}

function isSegment(value: unknown): value is Segment {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Segment).styleId === "number" &&
    typeof (value as Segment).ref === "object" &&
    (value as Segment).ref !== null &&
    typeof (value as Segment).ref.id === "string"
  );
}

function emptyResult(): EditResult {
  return { applied: 0, inserted: 0, deleted: 0, edits: [], inserts: [], deletes: [], warnings: [], operations: [] };
}

function mergeResults(a: EditResult, b: EditResult): EditResult {
  return {
    applied: a.applied + b.applied,
    inserted: a.inserted + b.inserted,
    deleted: a.deleted + b.deleted,
    edits: [...a.edits, ...b.edits],
    inserts: [...a.inserts, ...b.inserts],
    deletes: [...a.deletes, ...b.deletes],
    warnings: [...a.warnings, ...b.warnings],
    operations: [...a.operations, ...b.operations],
  };
}
