/**
 * 中英文（CJK 与西文）之间的空格排版。确定性、可配置，不含任何随机成分。
 *
 * 术语（以「我是 Claude Code 助理」为例）：
 *   - lspace：中文 → 西文 的边界（「是」与「Claude」之间），即西文**左侧**的空格
 *   - rspace：西文 → 中文 的边界（「Code」与「助理」之间），即西文**右侧**的空格
 * 每个边界的动作：add（保证恰有一个空格）| remove（去掉空格）| keep（原样保留）。
 * 西文词内部的空格（「Claude Code」）不受影响。
 */

export type SpaceAction = "add" | "remove" | "keep";
export type CjkSpacingMode = "keep" | "space" | "tight";

export interface CjkSpacingConfig {
  /** 预设：keep（默认，不动）/ space（两侧都加空格）/ tight（两侧都不留空格）。 */
  cjkSpacing?: CjkSpacingMode | string;
  /** 中文→西文 边界，覆盖预设。 */
  lspace?: SpaceAction | string;
  /** 西文→中文 边界，覆盖预设。 */
  rspace?: SpaceAction | string;
}

export interface ResolvedCjkSpacing {
  lspace: SpaceAction;
  rspace: SpaceAction;
}

const ACTIONS: Record<string, SpaceAction> = {
  add: "add",
  space: "add",
  on: "add",
  true: "add",
  remove: "remove",
  tight: "remove",
  none: "remove",
  off: "remove",
  false: "remove",
  keep: "keep",
};

/** 解析动作字符串；无法识别时抛错（避免拼写错误被悄悄忽略）。 */
export function parseSpaceAction(value: unknown, name: string): SpaceAction | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const key = String(value).trim().toLowerCase();
  const action = ACTIONS[key];
  if (!action) throw new Error(`${name} 只接受 add | remove | keep（或 space | tight），收到：${String(value)}`);
  return action;
}

/** 合并预设与 lspace/rspace（后者优先）。 */
export function resolveCjkSpacing(config: CjkSpacingConfig | undefined): ResolvedCjkSpacing {
  const preset = parseSpaceAction(config?.cjkSpacing, "cjkSpacing / --cjk-spacing") ?? "keep";
  return {
    lspace: parseSpaceAction(config?.lspace, "lspace") ?? preset,
    rspace: parseSpaceAction(config?.rspace, "rspace") ?? preset,
  };
}

export function isCjkSpacingActive(spacing: ResolvedCjkSpacing): boolean {
  return spacing.lspace !== "keep" || spacing.rspace !== "keep";
}

/** 汉字、假名、谚文（不含全角标点：标点与西文之间不需要空格）。 */
const CJK = "\\u2E80-\\u2FFF\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF";
/** 西文词字符：字母与数字。 */
const LATIN = "A-Za-z0-9";

const CJK_END = new RegExp(`[${CJK}]( *)$`);
const CJK_START = new RegExp(`^( *)[${CJK}]`);
const LATIN_END = new RegExp(`[${LATIN}]( *)$`);
const LATIN_START = new RegExp(`^( *)[${LATIN}]`);
const L_BOUNDARY = new RegExp(`([${CJK}]) *(?=[${LATIN}])`, "g");
const R_BOUNDARY = new RegExp(`([${LATIN}]) *(?=[${CJK}])`, "g");

const sep = (action: SpaceAction, current: string): string => (action === "add" ? " " : action === "remove" ? "" : current);

/** 受保护片段：行内代码、链接/图片目标、行尾块属性 {…}、裸 URL。 */
const PROTECTED = /(`+[^`]*`+|\]\([^)]*\)|\s*\{[^{}]*\}\s*$|https?:\/\/[^\s)]+)/g;

interface Piece {
  text: string;
  kind: "text" | "code" | "fixed";
}

function split(text: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ text: text.slice(last, index), kind: "text" });
    pieces.push({ text: match[0], kind: match[0].startsWith("`") ? "code" : "fixed" });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), kind: "text" });
  return pieces;
}

/**
 * 格式化一段 Markdown 行内文本。行内代码在边界上按西文对待；
 * 链接目标、块属性、URL 原样保留。`**` `*` 等强调标记会隔断相邻关系，不做处理。
 */
export function formatCjkSpacing(text: string, spacing: ResolvedCjkSpacing): string {
  if (!isCjkSpacingActive(spacing) || !text) return text;
  const pieces = split(text);

  // 1) 文本片段内部
  for (const piece of pieces) {
    if (piece.kind !== "text") continue;
    piece.text = piece.text
      .replace(L_BOUNDARY, (m, cjk: string) => cjk + sep(spacing.lspace, m.slice(cjk.length)))
      .replace(R_BOUNDARY, (m, latin: string) => latin + sep(spacing.rspace, m.slice(latin.length)));
  }

  // 2) 文本与行内代码的交界：代码按西文处理
  for (let i = 0; i + 1 < pieces.length; i += 1) {
    const a = pieces[i];
    const b = pieces[i + 1];
    if (a.kind === "text" && b.kind === "code") {
      const m = CJK_END.exec(a.text);
      if (m) a.text = a.text.slice(0, a.text.length - m[1].length) + sep(spacing.lspace, m[1]);
    } else if (a.kind === "code" && b.kind === "text") {
      const m = CJK_START.exec(b.text);
      if (m) b.text = sep(spacing.rspace, m[1]) + b.text.slice(m[1].length);
    }
  }
  return pieces.map((p) => p.text).join("");
}

// 供测试与其它模块判断边界字符。
export const _internal = { CJK_END, CJK_START, LATIN_END, LATIN_START };
