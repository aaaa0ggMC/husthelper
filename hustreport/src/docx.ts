import { loadDocx } from "docx-edit";
import type { VirtualWordDocument } from "docx-edit";
import { analyzeDocument, type AnalyzeOptions, type AnalyzableDocument } from "./analyze.ts";
import type { DocumentAnalysis } from "./types.ts";

export type { VirtualWordDocument };

const OLE2_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * 旧版 `.doc` 是 OLE2 复合二进制格式，纯 JS 无法无损解析（只有「提取纯文本」这类有损方案，
 * 与 hustreport「保格式」的前提冲突），因此本系统不处理 `.doc`。
 *
 * 该函数仅用于检测并给出可操作的错误提示。
 */
export function isDocFormat(input: string | Buffer): boolean {
  if (typeof input === "string") {
    return input.toLowerCase().endsWith(".doc") && !input.toLowerCase().endsWith(".docx");
  }
  if (Buffer.isBuffer(input) && input.length >= 8) {
    return input.subarray(0, 8).equals(OLE2_HEADER);
  }
  return false;
}

/** 遇到旧版 `.doc` 时的统一提示。 */
export const DOC_FORMAT_HINT =
  "hustreport 只处理 .docx。检测到旧版 .doc 格式（OLE2 二进制），无法无损解析；" +
  "请在 WPS / Word 中打开后「另存为」或「导出」为 .docx 再重试。";

/** 读取 `.docx`（路径或字节）。传入旧版 `.doc` 会抛出可操作的错误。 */
export async function openDocx(input: string | Buffer): Promise<VirtualWordDocument> {
  if (isDocFormat(input)) {
    throw new Error(DOC_FORMAT_HINT);
  }
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
