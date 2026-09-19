import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadDocx } from "docx-edit";
import type { VirtualWordDocument } from "docx-edit";
import { analyzeDocument, type AnalyzeOptions, type AnalyzableDocument } from "./analyze.ts";
import type { DocumentAnalysis } from "./types.ts";

export type { VirtualWordDocument };

const execFileAsync = promisify(execFile);
const OLE2_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isDocFormat(input: string | Buffer): boolean {
  if (typeof input === "string") {
    return input.toLowerCase().endsWith(".doc") && !input.toLowerCase().endsWith(".docx");
  }
  if (Buffer.isBuffer(input) && input.length >= 8) {
    return input.subarray(0, 8).equals(OLE2_HEADER);
  }
  return false;
}

export async function convertDocToDocx(input: string | Buffer): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "hustreport-doc-"));
  try {
    let sourcePath = "";
    if (typeof input === "string" && existsSync(input)) {
      sourcePath = path.resolve(input);
    } else {
      sourcePath = path.join(tempDir, "input.doc");
      await writeFile(sourcePath, Buffer.isBuffer(input) ? input : await readFile(input));
    }

    try {
      await execFileAsync("soffice", [
        "--headless",
        "--convert-to",
        "docx",
        "--outdir",
        tempDir,
        sourcePath,
      ]);
    } catch (err: any) {
      throw new Error(
        `检测到旧版 Word .doc 格式，自动转换为 .docx 失败（需安装 LibreOffice / soffice）：${err.message || String(err)}`,
      );
    }

    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const targetDocx = path.join(tempDir, `${baseName}.docx`);
    if (!existsSync(targetDocx)) {
      throw new Error(`LibreOffice 转换未产出预期文件: ${targetDocx}`);
    }
    return await readFile(targetDocx);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 读取 docx 或自动转换旧版 .doc（路径或 Buffer）。 */
export async function openDocx(input: string | Buffer): Promise<VirtualWordDocument> {
  if (isDocFormat(input)) {
    const docxBuffer = await convertDocToDocx(input);
    return loadDocx(docxBuffer);
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
