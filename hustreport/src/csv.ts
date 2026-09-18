import type { MediaEntry, Segment } from "./types.ts";

/**
 * 自定义 CSV 方言（与需求样例一致）：
 *
 * ```
 * Index , Segments , XML Style ID , Ref
 * 0 , "你好啊，这里转义\"" , 0 , body#0/p0/r0-1
 * ```
 *
 * - 字段以 `,` 分隔，允许两侧空白；
 * - 文本字段始终用双引号包裹；
 * - 转义：`\\` → `\\\\`、`"` → `\"`、换行 → `\n`、CR → `\r`、Tab → `\t`。
 */

export type SegmentCsvColumn = "index" | "text" | "styleId" | "ref";

export interface SegmentCsvOptions {
  /** 列顺序，默认 `["index", "text", "styleId", "ref"]`。 */
  columns?: SegmentCsvColumn[];
  /** 分隔符，默认 `,`。 */
  delimiter?: string;
  /** 是否在分隔符两侧加空格（默认 true，输出 `a , b`）。 */
  paddedDelimiter?: boolean;
  /** 是否输出表头，默认 true。 */
  header?: boolean;
  /** 行尾，默认 `\n`。 */
  eol?: string;
}

export interface ParsedCsvRow {
  index?: number;
  text: string;
  styleId?: number;
  ref?: string;
}

const HEADERS: Record<SegmentCsvColumn, string> = {
  index: "Index",
  text: "Segments",
  styleId: "XML Style ID",
  ref: "Ref",
};

const DEFAULT_COLUMNS: SegmentCsvColumn[] = ["index", "text", "styleId", "ref"];

/** 生成 segments CSV 文本。 */
export function formatSegmentsCsv(segments: readonly Segment[], options: SegmentCsvOptions = {}): string {
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const delimiter = options.delimiter ?? ",";
  const pad = options.paddedDelimiter ?? true;
  const eol = options.eol ?? "\n";
  const sep = pad ? ` ${delimiter} ` : delimiter;

  const lines: string[] = [];
  if (options.header ?? true) {
    lines.push(columns.map((column) => HEADERS[column]).join(sep));
  }

  for (const segment of segments) {
    lines.push(
      columns
        .map((column) => {
          switch (column) {
            case "index":
              return formatField(String(segment.index));
            case "text":
              return formatField(segment.text, { alwaysQuote: true });
            case "styleId":
              return formatField(String(segment.styleId));
            case "ref":
              return formatField(segment.ref.id);
          }
        })
        .join(sep),
    );
  }

  return lines.join(eol) + (lines.length > 0 ? eol : "");
}

/** 生成媒体清单 CSV：`Handle , Ref , Filename , Content-Type , Width , Height , Alt`。 */
export function formatMediaCsv(media: readonly MediaEntry[], options: SegmentCsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const pad = options.paddedDelimiter ?? true;
  const eol = options.eol ?? "\n";
  const sep = pad ? ` ${delimiter} ` : delimiter;
  const header = ["Handle", "Ref", "Filename", "Content-Type", "Width", "Height", "Alt"].join(sep);

  const lines = [header];
  for (const entry of media) {
    lines.push(
      [
        formatField(entry.handle),
        formatField(`${entry.part}#${entry.partIndex}/p${entry.paragraph}/r${entry.run}`),
        formatField(entry.filename ?? ""),
        formatField(entry.contentType ?? ""),
        formatField(entry.width ?? ""),
        formatField(entry.height ?? ""),
        formatField(entry.alt ?? ""),
      ].join(sep),
    );
  }
  return lines.join(eol) + eol;
}

export interface ParseCsvOptions {
  delimiter?: string;
  /** 是否把首行当表头（默认自动判断：首行含 `Segments` 即视为表头）。 */
  header?: boolean;
}

/** 解析由 `formatSegmentsCsv()` 产出的 CSV；列顺序由表头决定，无表头时按默认顺序。 */
export function parseSegmentsCsv(csv: string, options: ParseCsvOptions = {}): ParsedCsvRow[] {
  const delimiter = options.delimiter ?? ",";
  const rows = parseRows(csv, delimiter);
  if (rows.length === 0) return [];

  const hasHeader = options.header ?? rows[0].some((cell) => cell.trim() === "Segments");
  const dataRows = hasHeader ? rows.slice(1) : rows;

  let columns: SegmentCsvColumn[] = DEFAULT_COLUMNS;
  if (hasHeader) {
    columns = rows[0].map((cell) => {
      const normalized = cell.trim();
      const found = (Object.keys(HEADERS) as SegmentCsvColumn[]).find((key) => HEADERS[key] === normalized);
      return found ?? (normalized.toLowerCase() as SegmentCsvColumn);
    });
  }

  return dataRows
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row) => {
      const record: ParsedCsvRow = { text: "" };
      columns.forEach((column, position) => {
        const raw = (row[position] ?? "").trim();
        switch (column) {
          case "index":
            if (raw !== "") record.index = Number(raw);
            break;
          case "text":
            record.text = row[position] ?? "";
            break;
          case "styleId":
            if (raw !== "") record.styleId = Number(raw);
            break;
          case "ref":
            record.ref = raw || undefined;
            break;
          default:
            break;
        }
      });
      return record;
    });
}

interface FieldOptions {
  alwaysQuote?: boolean;
}

function formatField(value: string, options: FieldOptions = {}): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  if (options.alwaysQuote) return `"${escaped}"`;
  // 非文本列：仅在必要时加引号，保持数字/ref 简洁。
  return /[",\n\r\t\\]/.test(value) ? `"${escaped}"` : value;
}

function unescapeField(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i += 1;
          continue;
        case "r":
          out += "\r";
          i += 1;
          continue;
        case "t":
          out += "\t";
          i += 1;
          continue;
        case "\\":
        case '"':
          out += next;
          i += 1;
          continue;
        default:
          break;
      }
    }
    out += char;
  }
  return out;
}

/** 逐字符解析，正确处理引号内的分隔符与换行，并忽略分隔符两侧的空白。 */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quotedField = false;
  let afterQuote = false;

  const push = (): void => {
    const value = unescapeField(field);
    row.push(quotedField ? value : value.trim());
    field = "";
    quotedField = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === "\\" && i + 1 < text.length) {
        field += char + text[i + 1];
        i += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        afterQuote = true;
        continue;
      }
      field += char;
      continue;
    }

    if (afterQuote) {
      if (char === delimiter) {
        push();
        afterQuote = false;
        continue;
      }
      if (char === "\n") {
        push();
        rows.push(row);
        row = [];
        afterQuote = false;
        continue;
      }
      if (char === "\r" || char === " " || char === "\t") continue;
      afterQuote = false;
      field += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      quotedField = true;
      if (field.trim() === "") field = "";
      continue;
    }
    if (char === delimiter) {
      push();
      continue;
    }
    if (char === "\n") {
      push();
      rows.push(row);
      row = [];
      continue;
    }
    if (char === "\r") continue;
    field += char;
  }

  if (field.length > 0 || row.length > 0 || quotedField) {
    push();
    rows.push(row);
  }

  return rows;
}
