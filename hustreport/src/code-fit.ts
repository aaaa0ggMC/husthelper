/**
 * 代码卡片的“自动适配宽度”：按最长行的估算显示宽度缩小字号，避免一行被折成两行（折行会破坏对齐）。
 * 估算与字体无关且偏保守：西文/数字/符号按 0.6 em，中日韩与全角字符按 1 em。
 */

/** 单元格左右内边距合计（twips），从可用宽度里扣除。 */
const CELL_PADDING_TWIPS = 230;
const ASCII_EM = 0.6;

/** 一行文本的估算宽度（单位 em）。 */
export function lineWidthEm(line: string): number {
  let em = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0;
    em += code < 0x80 ? ASCII_EM : 1;
  }
  return em;
}

export interface FitInput {
  /** 当前字号（半磅）。 */
  fontSize: number;
  /** 代码列宽度（twips）。 */
  codeWidthTwips: number;
  /** 允许缩到的最小字号（半磅）。 */
  minFontSize: number;
}

export interface FitResult {
  /** 适配后的字号（半磅）。 */
  fontSize: number;
  /** 是否缩小过。 */
  shrunk: boolean;
  /** 缩到下限后最长行仍然放不下（会折行）。 */
  overflow: boolean;
  /** 最长行的估算宽度（em）。 */
  maxEm: number;
}

/** 计算能让最长行放进一行的字号。整数半磅，向下取整（保守）。 */
export function fitFontSize(lines: readonly string[], input: FitInput): FitResult {
  const maxEm = lines.reduce((m, line) => Math.max(m, lineWidthEm(line)), 0);
  const availablePt = Math.max(1, (input.codeWidthTwips - CELL_PADDING_TWIPS) / 20);
  if (maxEm <= 0) return { fontSize: input.fontSize, shrunk: false, overflow: false, maxEm };
  const neededHalf = Math.floor((availablePt / maxEm) * 2);
  if (neededHalf >= input.fontSize) return { fontSize: input.fontSize, shrunk: false, overflow: false, maxEm };
  const min = Math.min(input.minFontSize, input.fontSize);
  if (neededHalf >= min) return { fontSize: neededHalf, shrunk: true, overflow: false, maxEm };
  return { fontSize: min, shrunk: min < input.fontSize, overflow: true, maxEm };
}
