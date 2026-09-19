import type { VirtualWordDocument } from "docx-edit";
import { childElementsOf, type XmlElement } from "./ooxml.ts";

/**
 * 表格样式识别：从 OOXML 的 `w:tbl` 中提取表级样式（tblStyle / 边框 / 列宽 / 单元格边距）
 * 与单元格文字格式，供 AI 识别并回传到模板 DSL。
 */

export interface TableBorders {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  insideH?: string;
  insideV?: string;
}

export interface TableCellMargin {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}

export interface TableStyleInfo {
  /** `w:tblStyle` 的 val（命名表样式 id，如 "12"）。 */
  styleId?: string;
  columns: number;
  rows: number;
  /** `w:tblGrid/gridCol` 的列宽（dxa）。 */
  gridWidths?: number[];
  tableAlign?: string;
  cellMargin?: TableCellMargin;
  /** 边框描述，如 "single sz=12 color=auto"。 */
  borders?: TableBorders;
  /** 首行是否跨页重复表头。 */
  headerRepeat?: boolean;
  /** 首行底纹填充色（无 `#`）。 */
  headerShading?: string;
  cellFontEastAsia?: string;
  cellFontAscii?: string;
  /** 半磅字号值（字符串），如 "21"。 */
  cellSize?: string;
  cellColor?: string;
  cellAlign?: string;
  verticalAlign?: string;
}

function attr(el: XmlElement | undefined | null, name: string): string | undefined {
  const value = el?.getAttribute?.(`w:${name}`);
  return value ? value : undefined;
}

function child(el: XmlElement | undefined | null, name: string): XmlElement | undefined {
  return el ? childElementsOf(el).find((c) => c.nodeName === name) : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 从元素向上找最近的 `w:tbl`。 */
export function findAncestorTable(element: XmlElement | null | undefined): XmlElement | null {
  let node: XmlElement = element?.parentNode ?? null;
  while (node) {
    if (node.nodeName === "w:tbl") return node;
    if (node.nodeName === "w:body" || node.nodeName === "#document") return null;
    node = node.parentNode;
  }
  return null;
}

function describeBorder(side: XmlElement | undefined): string | undefined {
  if (!side) return undefined;
  const val = attr(side, "val");
  if (!val || val === "none" || val === "nil") return "none";
  const sz = attr(side, "sz");
  const color = attr(side, "color");
  return [val, sz && `sz=${sz}`, color && color !== "auto" && `color=${color}`].filter(Boolean).join(" ");
}

function readBorders(bordersEl: XmlElement | undefined): TableBorders {
  if (!bordersEl) return {};
  return {
    top: describeBorder(child(bordersEl, "w:top")),
    bottom: describeBorder(child(bordersEl, "w:bottom")),
    left: describeBorder(child(bordersEl, "w:left")),
    right: describeBorder(child(bordersEl, "w:right")),
    insideH: describeBorder(child(bordersEl, "w:insideH")),
    insideV: describeBorder(child(bordersEl, "w:insideV")),
  };
}

function hasAnyBorder(borders: TableBorders): boolean {
  return Object.values(borders).some((value) => value !== undefined);
}

function extractCellBorders(cell: XmlElement | undefined): TableBorders {
  const tcPr = child(cell, "w:tcPr");
  return readBorders(child(tcPr, "w:tcBorders"));
}

/** 提取一张表的样式摘要。 */
export function extractTableStyle(tableEl: XmlElement): TableStyleInfo {
  const tblPr = child(tableEl, "w:tblPr");
  const grid = child(tableEl, "w:tblGrid");
  const rows = childElementsOf(tableEl).filter((c) => c.nodeName === "w:tr");
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const firstCell = firstRow ? childElementsOf(firstRow).find((c) => c.nodeName === "w:tc") : undefined;
  const lastCell = lastRow ? childElementsOf(lastRow).find((c) => c.nodeName === "w:tc") : undefined;

  const gridWidths = grid
    ? childElementsOf(grid)
        .filter((c) => c.nodeName === "w:gridCol")
        .map((c) => toNumber(c.getAttribute("w:w")))
        .filter((n): n is number => n !== undefined)
    : undefined;

  // 表级边框优先；缺失时从首/末行的单元格边框归纳（三线表常见写法）。
  let borders = readBorders(child(tblPr, "w:tblBorders"));
  if (!hasAnyBorder(borders)) {
    const firstBorders = extractCellBorders(firstCell);
    const lastBorders = extractCellBorders(lastCell);
    borders = {
      top: firstBorders.top,
      bottom: lastBorders.bottom,
      insideH: firstBorders.bottom,
      left: firstBorders.left ?? lastBorders.left,
      right: firstBorders.right ?? lastBorders.right,
      insideV: firstBorders.insideV,
    };
  }

  const tcPr = child(firstCell, "w:tcPr");
  const vAlign = attr(child(tcPr, "w:vAlign"), "val");

  const cellP = child(firstCell, "w:p");
  const pPr = child(cellP, "w:pPr");
  const cellAlign = attr(child(pPr, "w:jc"), "val");

  const cellRuns = cellP ? childElementsOf(cellP).filter((c) => c.nodeName === "w:r") : [];
  const firstRun = cellRuns[0];
  const rPr = child(firstRun, "w:rPr");
  const rFonts = child(rPr, "w:rFonts");

  const headerShading = attr(child(tcPr, "w:shd"), "fill");

  const topMargin = child(tblPr, "w:tblCellMar");
  const margin: TableCellMargin = topMargin
    ? {
        top: toNumber(attr(child(topMargin, "w:top"), "w")),
        left: toNumber(attr(child(topMargin, "w:left"), "w")),
        bottom: toNumber(attr(child(topMargin, "w:bottom"), "w")),
        right: toNumber(attr(child(topMargin, "w:right"), "w")),
      }
    : {};

  return {
    styleId: attr(child(tblPr, "w:tblStyle"), "val"),
    columns: gridWidths?.length ?? childElementsOf(firstRow ?? tableEl).filter((c) => c.nodeName === "w:tc").length,
    rows: rows.length,
    gridWidths,
    tableAlign: attr(child(tblPr, "w:jc"), "val"),
    cellMargin: margin,
    borders,
    headerRepeat: firstRow ? Boolean(child(child(firstRow, "w:trPr"), "w:tblHeader")) : undefined,
    headerShading,
    cellFontEastAsia: attr(rFonts, "eastAsia"),
    cellFontAscii: attr(rFonts, "ascii") ?? attr(rFonts, "hAnsi"),
    cellSize: attr(child(rPr, "w:sz"), "val"),
    cellColor: attr(child(rPr, "w:color"), "val"),
    cellAlign,
    verticalAlign: vAlign,
  };
}

/** 把表样式摘要压成一行可读文本，供 AI 阅读。 */
export function summarizeTableStyle(style: TableStyleInfo): string {
  const parts: string[] = [];
  if (style.styleId) parts.push(`tblStyle=${style.styleId}`);
  parts.push(`${style.rows}行×${style.columns}列`);
  if (style.gridWidths?.length) parts.push(`列宽=[${style.gridWidths.join(",")}]`);
  if (style.tableAlign) parts.push(`表对齐=${style.tableAlign}`);
  const borderBits = Object.entries(style.borders ?? {})
    .filter(([, value]) => value && value !== "none")
    .map(([side, value]) => `${side}:${value}`);
  if (borderBits.length) parts.push(`边框(${borderBits.join("; ")})`);
  if (style.headerRepeat) parts.push("首行跨页重复");
  if (style.headerShading) parts.push(`表头底纹=#${style.headerShading}`);
  const font = [style.cellFontEastAsia && `中:${style.cellFontEastAsia}`, style.cellFontAscii && `西:${style.cellFontAscii}`]
    .filter(Boolean)
    .join("/");
  if (font) parts.push(`单元格字体=${font}`);
  if (style.cellSize) parts.push(`单元格字号=${style.cellSize}(半磅)`);
  if (style.cellColor) parts.push(`单元格颜色=#${style.cellColor}`);
  if (style.cellAlign) parts.push(`单元格对齐=${style.cellAlign}`);
  if (style.verticalAlign) parts.push(`垂直对齐=${style.verticalAlign}`);
  const margin = style.cellMargin;
  if (margin && (margin.top || margin.left || margin.bottom || margin.right)) {
    parts.push(`单元格边距=[上${margin.top ?? 0}/左${margin.left ?? 0}/下${margin.bottom ?? 0}/右${margin.right ?? 0}]`);
  }
  return parts.join("; ");
}

export interface CollectedTable {
  id: string;
  element: XmlElement;
  style: TableStyleInfo;
}

/** 按文档顺序收集全部表格，分配稳定 id（tbl1、tbl2…）。 */
export function collectTables(doc: VirtualWordDocument): CollectedTable[] {
  const parts = (doc as unknown as { partsData?: Array<{ path?: string; xmlDocument?: any }> }).partsData;
  if (!Array.isArray(parts)) return [];
  // document.xml 优先，保证主文档表格编号稳定。
  const ordered = [...parts].sort((a, b) => (a.path === "word/document.xml" ? -1 : b.path === "word/document.xml" ? 1 : 0));
  const out: CollectedTable[] = [];
  for (const part of ordered) {
    const root = part.xmlDocument?.documentElement;
    if (!root) continue;
    const tables = Array.from(root.getElementsByTagName?.("w:tbl") ?? []) as XmlElement[];
    for (const element of tables) {
      out.push({ id: `tbl${out.length + 1}`, element, style: extractTableStyle(element) });
    }
  }
  return out;
}
