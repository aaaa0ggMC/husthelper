import type { StyleObject, StyleSnapshot } from "./types.ts";

/** 深拷贝样式对象。 */
export function cloneStyle<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneStyle(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneStyle(inner);
    }
    return out as T;
  }
  return value;
}

/** 深度合并样式，后面的参数覆盖前面的；嵌套对象递归合并。 */
export function mergeStyles(...parts: Array<StyleObject | undefined | null>): StyleObject {
  const out: StyleObject = {};
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    for (const [key, value] of Object.entries(part)) {
      const current = out[key];
      if (isPlainObject(value) && isPlainObject(current)) {
        out[key] = mergeStyles(current, value);
      } else if (value !== undefined) {
        out[key] = cloneStyle(value);
      }
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is StyleObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 生成稳定签名：对象键按字典序排序，数组保持原顺序，忽略 undefined。
 * 用于把样式对象归一成可比较、可去重的字符串。
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = normalize((value as Record<string, unknown>)[key]);
      if (inner !== undefined) out[key] = inner;
    }
    return out;
  }
  return value;
}

/** 中文字号名（Word 的 `w:sz` 以半磅为单位）。 */
const CHINESE_FONT_SIZES: Array<[string, number]> = [
  ["初号", 42],
  ["小初", 36],
  ["一号", 26],
  ["小一", 24],
  ["二号", 22],
  ["小二", 18],
  ["三号", 16],
  ["小三", 15],
  ["四号", 14],
  ["小四", 12],
  ["五号", 10.5],
  ["小五", 9],
  ["六号", 7.5],
  ["小六", 6.5],
  ["七号", 5.5],
  ["八号", 5],
];

/** 把 `w:sz` 的半磅值描述成 “五号 (10.5pt)”。 */
export function describeFontSize(raw: unknown): string | null {
  if (raw == null) return null;
  const halfPoints = Number(raw);
  if (!Number.isFinite(halfPoints)) return String(raw);
  const pt = halfPoints / 2;
  const named = CHINESE_FONT_SIZES.find(([, size]) => Math.abs(size - pt) < 0.01);
  const ptLabel = Number.isInteger(pt) ? `${pt}pt` : `${pt}pt`;
  return named ? `${named[0]} (${ptLabel})` : ptLabel;
}

function describeFontFamily(fontFamily: unknown): string | null {
  if (!isPlainObject(fontFamily)) return null;
  const parts: string[] = [];
  const eastAsia = fontFamily.eastAsia ?? fontFamily.eastAsiaTheme;
  const ascii = fontFamily.ascii ?? fontFamily.asciiTheme ?? fontFamily.hAnsi ?? fontFamily.hAnsiTheme;
  if (eastAsia) parts.push(`中文=${eastAsia}`);
  if (ascii) parts.push(`西文=${ascii}`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function describeRunEffective(effective: StyleObject): string {
  const bits: string[] = [];
  const font = describeFontFamily(effective.fontFamily);
  if (font) bits.push(font);
  const size = describeFontSize(effective.fontSize);
  if (size) bits.push(`字号=${size}`);
  if (effective.styleId) bits.push(`rStyle=${effective.styleId}`);
  if (effective.bold) bits.push("加粗");
  if (effective.italic) bits.push("斜体");
  if (effective.underline) bits.push(`下划线=${effective.underline}`);
  if (effective.color) bits.push(`颜色=#${effective.color}`);
  if (effective.highlight) bits.push(`高亮=${effective.highlight}`);
  if (effective.vertAlign) bits.push(`对齐=${effective.vertAlign}`);
  return bits.join(" ");
}

function describeParagraphEffective(effective: StyleObject, headingLevel?: number | null): string {
  const bits: string[] = [];
  if (headingLevel) bits.push(`标题${headingLevel}`);
  if (effective.styleId) bits.push(`pStyle=${effective.styleId}`);
  if (effective.alignment) bits.push(`对齐=${effective.alignment}`);
  const spacing = effective.spacing;
  if (isPlainObject(spacing) && (spacing.before || spacing.after || spacing.line)) {
    bits.push(`间距=${[spacing.before && `before:${spacing.before}`, spacing.after && `after:${spacing.after}`, spacing.line && `line:${spacing.line}`].filter(Boolean).join(",")}`);
  }
  const indent = effective.indent;
  if (isPlainObject(indent) && Object.keys(indent).length > 0) {
    bits.push(`缩进=${JSON.stringify(indent)}`);
  }
  return bits.join(" ");
}

/** 段落 + run 组合快照的摘要，供 AI 与人工查看。 */
export function summarizeStylePair(paragraph: StyleSnapshot, run: StyleSnapshot): string {
  const paragraphText = describeParagraphEffective(paragraph.effective, paragraph.headingLevel);
  const runText = describeRunEffective(run.effective);
  const left = paragraphText || "段落:默认";
  const right = runText || "运行:默认";
  return `${left}；${right}`;
}
