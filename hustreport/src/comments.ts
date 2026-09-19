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

/**
 * 从 Word 文档的 DOM 树中同步清除所有批注引用与范围标记（w:commentReference、w:commentRangeStart、w:commentRangeEnd）。
 * 若包裹 commentReference 的 <w:r> 仅包含批注标记或无其它正文文本，同步移除该空 run。
 */
export function stripCommentElements(doc: VirtualWordDocument): number {
  let count = 0;
  const anyDoc = doc as unknown as { partsData?: Array<{ path: string; xmlDocument: XmlElement }> };
  if (!Array.isArray(anyDoc.partsData)) return 0;

  for (const part of anyDoc.partsData) {
    if (!part.xmlDocument) continue;
    const toRemove: XmlElement[] = [];
    for (const tag of ["w:commentReference", "w:commentRangeStart", "w:commentRangeEnd"]) {
      const els = part.xmlDocument.getElementsByTagName(tag);
      for (let i = 0; i < els.length; i += 1) {
        toRemove.push(els[i]);
      }
    }
    for (const el of toRemove) {
      if (el.nodeName === "w:commentReference") count += 1;
      const parent = el.parentNode;
      if (parent) {
        if (parent.nodeName === "w:r") {
          const children = Array.from(parent.childNodes || []) as XmlElement[];
          const meaningful = children.filter((c) => {
            if (c === el) return false;
            if (c.nodeName === "w:rPr") return false;
            if (c.nodeType === 3 && (!c.nodeValue || c.nodeValue.trim() === "")) return false;
            return true;
          });
          if (meaningful.length === 0) {
            parent.parentNode?.removeChild(parent);
            continue;
          }
        }
        parent.removeChild(el);
      }
    }
  }

  return count;
}

/**
 * 从 Word 文档的 DOM 树中定向清除指定 ID 的批注引用与实体。
 */
export function stripCommentElementsById(doc: VirtualWordDocument, commentId: string): boolean {
  let found = false;
  const anyDoc = doc as unknown as { partsData?: Array<{ path: string; xmlDocument: XmlElement }> };
  if (!Array.isArray(anyDoc.partsData)) return false;

  const targetId = String(commentId);

  for (const part of anyDoc.partsData) {
    if (!part.xmlDocument) continue;
    const toRemove: XmlElement[] = [];
    for (const tag of ["w:commentReference", "w:commentRangeStart", "w:commentRangeEnd"]) {
      const els = part.xmlDocument.getElementsByTagName(tag);
      for (let i = 0; i < els.length; i += 1) {
        if (els[i].getAttribute("w:id") === targetId) {
          toRemove.push(els[i]);
        }
      }
    }
    for (const el of toRemove) {
      found = true;
      const parent = el.parentNode;
      if (parent) {
        if (parent.nodeName === "w:r") {
          const children = Array.from(parent.childNodes || []) as XmlElement[];
          const meaningful = children.filter((c) => {
            if (c === el) return false;
            if (c.nodeName === "w:rPr") return false;
            if (c.nodeType === 3 && (!c.nodeValue || c.nodeValue.trim() === "")) return false;
            return true;
          });
          if (meaningful.length === 0) {
            parent.parentNode?.removeChild(parent);
            continue;
          }
        }
        parent.removeChild(el);
      }
    }

    if (part.path === "word/comments.xml") {
      const comments = part.xmlDocument.getElementsByTagName("w:comment");
      const toRemoveComment: XmlElement[] = [];
      for (let i = 0; i < comments.length; i += 1) {
        if (comments[i].getAttribute("w:id") === targetId) {
          toRemoveComment.push(comments[i]);
        }
      }
      for (const c of toRemoveComment) {
        found = true;
        c.parentNode?.removeChild(c);
      }
    }
  }

  return found;
}

/**
 * 按 comment id 从文档中定向彻底清除指定批注，并在批注全部清空时自动清理部件关联。
 */
export async function stripCommentById(doc: VirtualWordDocument, commentId: string): Promise<boolean> {
  const found = stripCommentElementsById(doc, commentId);
  const anyDoc = doc as unknown as { partsData?: Array<{ path: string; xmlDocument: XmlElement }> };
  const commentsPart = anyDoc.partsData?.find((p) => p.path === "word/comments.xml");
  if (commentsPart?.xmlDocument) {
    const remaining = commentsPart.xmlDocument.getElementsByTagName("w:comment");
    if (!remaining || remaining.length === 0) {
      await stripDocumentComments(doc);
    }
  }
  return found;
}

/**
 * 从 Word 文档中彻底清除所有批注（Comments）及其引用，包括：
 * 1. 清除正文及各 part 中的 <w:commentReference>、<w:commentRangeStart>、<w:commentRangeEnd> 及空 run；
 * 2. 从 partsData / parts 中移除 word/comments*.xml 部件；
 * 3. 从 zip 中移除 word/comments.xml 等相关文件；
 * 4. 从 word/_rels/document.xml.rels 中移除对 comments 的关联；
 * 5. 从 [Content_Types].xml 中清理 comments 相关 Override。
 */
export async function stripDocumentComments(doc: VirtualWordDocument): Promise<number> {
  const count = stripCommentElements(doc);
  const anyDoc = doc as unknown as {
    partsData?: Array<{ path: string; xmlDocument: XmlElement }>;
    parts?: any[];
    zip?: {
      file: (name: string, content?: string) => any;
      remove: (name: string) => any;
    };
    relationshipsByPartPath?: Map<string, any>;
  };

  // 2. 从 partsData 与 parts 中移除 comments 部件
  if (Array.isArray(anyDoc.partsData)) {
    anyDoc.partsData = anyDoc.partsData.filter((p) => !/^word\/comments.*\.xml$/.test(p.path));
  }
  if (Array.isArray(anyDoc.parts)) {
    anyDoc.parts = anyDoc.parts.filter((p) => p.type !== "comments");
  }

  // 3. 从 zip 中移除 comments 文件
  if (anyDoc.zip && typeof anyDoc.zip.remove === "function") {
    anyDoc.zip.remove("word/comments.xml");
    anyDoc.zip.remove("word/commentsExtended.xml");
    anyDoc.zip.remove("word/commentsIds.xml");
  }

  // 4. 清理 relationshipsByPartPath 与 word/_rels/document.xml.rels 中的关联
  if (anyDoc.relationshipsByPartPath) {
    for (const rels of anyDoc.relationshipsByPartPath.values()) {
      if (rels?.relationships instanceof Map) {
        for (const [id, rel] of rels.relationships.entries()) {
          if (rel?.target && /comments.*\.xml$/.test(rel.target)) {
            rels.relationships.delete(id);
          }
        }
      }
    }
  }

  if (anyDoc.zip && typeof anyDoc.zip.file === "function") {
    const relsFile = anyDoc.zip.file("word/_rels/document.xml.rels");
    if (relsFile && typeof relsFile.async === "function") {
      let relsText: string = await relsFile.async("text");
      if (relsText.includes("comments")) {
        relsText = relsText.replace(/<Relationship[^>]*Target="comments[^"]*"[^>]*\/>/g, "");
        anyDoc.zip.file("word/_rels/document.xml.rels", relsText);
      }
    }

    // 5. 清理 [Content_Types].xml 中的 Override
    const ctFile = anyDoc.zip.file("[Content_Types].xml");
    if (ctFile && typeof ctFile.async === "function") {
      let ctText: string = await ctFile.async("text");
      if (ctText.includes("comments")) {
        ctText = ctText.replace(/<Override[^>]*PartName="\/word\/comments[^"]*"[^>]*\/>/g, "");
        anyDoc.zip.file("[Content_Types].xml", ctText);
      }
    }
  }

  return count;
}
