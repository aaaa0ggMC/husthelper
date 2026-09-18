import { loadDocx } from "docx-edit";
import type { VirtualWordDocument } from "docx-edit";
import { analyzeDocument, type AnalyzeOptions, type AnalyzableDocument } from "./analyze.ts";
import type { DocumentAnalysis } from "./types.ts";

export type { VirtualWordDocument };

/** 读取 docx（路径或 Buffer）。 */
export async function openDocx(input: string | Buffer): Promise<VirtualWordDocument> {
  return loadDocx(input);
}

export interface AnalyzedDocx {
  doc: VirtualWordDocument;
  analysis: DocumentAnalysis;
}

/** 读取 docx 并直接完成样式分段分析。 */
export async function analyzeDocx(input: string | Buffer, options: AnalyzeOptions = {}): Promise<AnalyzedDocx> {
  const doc = await openDocx(input);
  return { doc, analysis: analyzeDocument(doc as unknown as AnalyzableDocument, options) };
}
