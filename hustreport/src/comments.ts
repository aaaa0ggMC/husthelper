import type { VirtualWordDocument } from "docx-edit";

/* eslint-disable @typescript-eslint/no-explicit-any */
type XmlElement = any;

export interface DocumentComment {
  id: string;
  author?: string;
  text: string;
  paragraphRef?: string;
  paragraphText?: string;
}

/**
 * 从 Word 文档中提取批注（Comments），并尝试关联到具体的段落文本与锚点 (hrseg)。
 */
export function extractDocumentComments(doc: VirtualWordDocument): DocumentComment[] {
  const anyDoc = doc as unknown as { partsData?: Array<{ path: string; xmlDocument: XmlElement }> };
  if (!Array.isArray(anyDoc.partsData)) return [];

  const commentsPart = anyDoc.partsData.find((p) => p.path === "word/comments.xml");
  if (!commentsPart?.xmlDocument) return [];

  const commentNodes = commentsPart.xmlDocument.getElementsByTagName("w:comment");
  if (!commentNodes || commentNodes.length === 0) return [];

  // 1. 扫描 document.xml 中引用批注的段落
  const documentPart = anyDoc.partsData.find((p) => p.path === "word/document.xml");
  const commentParagraphMap = new Map<string, { anchorRef?: string; text: string }>();

  if (documentPart?.xmlDocument) {
    const pList = documentPart.xmlDocument.getElementsByTagName("w:p");
    for (let i = 0; i < pList.length; i += 1) {
      const p = pList[i];
      const refs = p.getElementsByTagName("w:commentReference");
      const ranges = p.getElementsByTagName("w:commentRangeStart");
      const ids: string[] = [];

      for (let j = 0; j < refs.length; j += 1) {
        const id = refs[j].getAttribute("w:id");
        if (id) ids.push(id);
      }
      for (let j = 0; j < ranges.length; j += 1) {
        const id = ranges[j].getAttribute("w:id");
        if (id) ids.push(id);
      }

      if (ids.length > 0) {
        const fullText = (p.textContent ? p.textContent.replace(/\s+/g, " ").trim() : "").slice(0, 80);
        const bms = p.getElementsByTagName("w:bookmarkStart");
        let anchorRef: string | undefined;
        for (let k = 0; k < bms.length; k += 1) {
          const name = bms[k].getAttribute("w:name");
          if (name && (name.startsWith("hrseg") || name.startsWith("hr"))) {
            anchorRef = name;
            break;
          }
        }
        for (const id of ids) {
          if (!commentParagraphMap.has(id)) {
            commentParagraphMap.set(id, { anchorRef, text: fullText });
          }
        }
      }
    }
  }

  // 2. 构造批注列表
  const comments: DocumentComment[] = [];
  for (let i = 0; i < commentNodes.length; i += 1) {
    const node = commentNodes[i];
    const id = node.getAttribute("w:id");
    if (!id) continue;
    const author = node.getAttribute("w:author") || undefined;
    const text = node.textContent ? node.textContent.replace(/\s+/g, " ").trim() : "";
    const target = commentParagraphMap.get(id);

    comments.push({
      id,
      author,
      text,
      paragraphRef: target?.anchorRef,
      paragraphText: target?.text,
    });
  }

  return comments;
}
