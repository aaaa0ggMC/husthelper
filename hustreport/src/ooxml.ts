/**
 * OOXML 命名空间与小工具集合。
 *
 * 这些函数在 `render` / `edits` / `stamp` / `comments` 等模块里被反复使用，
 * 之前各文件各自复制了一份。集中到这里，既减少重复，也保证命名空间常量唯一。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type XmlElement = any;

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
export const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";

/** 返回元素的所有元素子节点（跳过文本/注释节点）。 */
export function childElementsOf(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = element?.childNodes;
  if (!nodes) return out;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.nodeType === 1) out.push(nodes[i]);
  }
  return out;
}

/** 某元素的直接子元素里，指定本地名（如 `w:t`）的部分。 */
export function directChildrenNamed(element: XmlElement, name: string): XmlElement[] {
  return childElementsOf(element).filter((child) => child.nodeName === name);
}

/** 用参考元素的 ownerDocument 创建一个带命名空间的 Word 元素。 */
export function createWordElement(reference: XmlElement, name: string): XmlElement {
  return reference.ownerDocument.createElementNS(WORD_NS, name);
}

/**
 * 把 xmldom 的 LiveNodeList 转成普通数组（它不实现 Symbol.iterator）。
 * 兼容 `undefined` / `null`。
 */
export function elementList(list: { length: number; [index: number]: any } | undefined | null): XmlElement[] {
  const out: XmlElement[] = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i += 1) out.push(list[i]);
  return out;
}
