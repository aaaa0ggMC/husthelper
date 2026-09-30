import type { CodeBlockConfig, ImageBlockConfig, ReportConfig, TableBlockConfig } from "./config.ts";
import type { TemplateRule } from "./template.ts";

/**
 * 统一覆盖准则 —— 渲染时每一项排版设置都按同一条链取值（高 → 低）：
 *
 *   1. block     fill.md 里该块自己的 `{属性}`                    —— 只影响这一块
 *   2. user      命令行参数 > --extra > 配置文件 > 内置 API 选项   —— 使用者的全局意图
 *   3. template  template.json 中匹配到的规则（AI / 推断产出）      —— 模板的默认决策
 *   4. default   内置默认值                                         —— 兜底
 *
 * 原则：越具体、越接近使用者的设置越优先；AI 的决策永远可以被使用者覆盖，
 * 而且覆盖不需要改 template.json。`user` 层在 renderTemplate 入口一次性合并好，
 * 下游只认 `UserSettings`，不再各自拼 `a || b || c`。
 */
export type SettingLayer = "block" | "user" | "template" | "default";

/** 使用者层（CLI > --extra > 配置文件）合并后的结果；不含内置默认值。 */
export type UserSettings = Pick<ReportConfig, "code" | "image" | "table">;

export const BUILTIN_DEFAULTS = {
  code: { template: "default", lineNumbers: true, border: true, tabSize: 4, lint: true },
  image: { align: "center", size: "max", captionAlign: "center", maxWidth: 430 },
  table: { theme: "academic", header: true, align: "center" },
} as const;

export interface Resolved<T> {
  value: T;
  from: SettingLayer;
}

/** 按 block → user → template → default 取第一个有值的层。空字符串视为未设置。 */
export function pickLayer<T>(block: T | undefined, user: T | undefined, template: T | undefined, fallback: T): Resolved<T> {
  if (isSet(block)) return { value: block, from: "block" };
  if (isSet(user)) return { value: user, from: "user" };
  if (isSet(template)) return { value: template, from: "template" };
  return { value: fallback, from: "default" };
}

function isSet<T>(value: T | undefined): value is T {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

/** 解析布尔型属性（true/1/yes/on 与 false/0/no/off/none）；无法识别返回 undefined。 */
export function attrBool(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off", "none"].includes(v)) return false;
  return undefined;
}

function ruleOptions(rule: TemplateRule | null | undefined): Record<string, unknown> {
  return (rule?.options as Record<string, unknown> | undefined) ?? {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/* --------------------------------- 代码块 --------------------------------- */

type Attrs = Record<string, string>;

/** 块级属性里声明的代码模式：mode=native/paragraph → native；mode=card/table/box 或出现 border/line/lineNumbers/theme → card。 */
export function blockCodeMode(attrs: Attrs, blockTheme?: string): "native" | "card" | undefined {
  const mode = (attrs.mode ?? "").trim().toLowerCase();
  if (mode === "native" || mode === "paragraph") return "native";
  if (mode === "card" || mode === "table" || mode === "box") return "card";
  if (attrs.border !== undefined || attrs.line !== undefined || attrs.lineNumbers !== undefined || blockTheme) return "card";
  return undefined;
}

/** 块级属性是否强制卡片模式（纯文本代码块据此决定是否仍按卡片渲染）。 */
export function codeAttrsForceCard(attrs: Attrs): boolean {
  return blockCodeMode(attrs) === "card";
}

export interface CodeSettings {
  mode: Resolved<"native" | "card">;
  theme: Resolved<string>;
  lineNumbers: Resolved<boolean>;
  border: Resolved<boolean>;
  lint: Resolved<boolean>;
  tabSize: number;
  fontFamily?: string;
  fontEastAsia?: string;
  fontSize?: number | string;
  /** 请求 native 但模板没有原生代码样式时的回退说明。 */
  note?: string;
}

/** 样式引用是否指向文档里**真实存在**的段落样式（有示例代码段落）。inline / recipe 只是字体规格，不算。 */
export function isDocumentStyleRef(ref: unknown): boolean {
  return Boolean(ref && typeof ref === "object" && ("anchor" in ref || "ooxmlStyleId" in ref || "styleName" in ref));
}

/**
 * 从规则里取“只有字体要求”的代码字体：`options.fontFamily`（西文）/ `options.fontEastAsia`（中文）/ `options.fontSize` 优先，
 * 字号其次取 `inline.run.fontSize`（半磅值）。未指定字体时由渲染器复制文档正文样式。
 */
export function ruleCodeFont(rule: TemplateRule | null | undefined): {
  fontFamily?: string;
  fontEastAsia?: string;
  fontSize?: number | string;
} {
  const opts = (rule?.options ?? {}) as Record<string, unknown>;
  const ref = rule?.style as { inline?: { run?: Record<string, any> } } | undefined;
  const run = ref?.inline?.run ?? {};
  // AI 拼的 inline 字体不作数（应复制文档正文样式）；字体只认显式的 options，inline 里只取字号
  const ascii = str(opts.fontFamily);
  const eastAsia = str(opts.fontEastAsia);
  const rawSize = opts.fontSize ?? run.fontSize;
  const size = typeof rawSize === "number" ? rawSize : typeof rawSize === "string" && /^\d+$/.test(rawSize) ? Number(rawSize) : undefined;
  return {
    ...(ascii ? { fontFamily: ascii } : {}),
    ...(eastAsia ? { fontEastAsia: eastAsia } : {}),
    ...(size ? { fontSize: size } : {}),
  };
}

export function resolveCodeSettings(input: {
  attrs: Attrs;
  blockTheme?: string;
  rule: TemplateRule | null | undefined;
  user: CodeBlockConfig | undefined;
  /** 模板里是否存在可用的原生代码段落样式。 */
  hasDocumentStyle: boolean;
}): CodeSettings {
  const { attrs, rule, hasDocumentStyle } = input;
  const user = input.user ?? {};
  const ruleTheme = str(rule?.theme);

  const userMode = user.mode && user.mode !== "auto" ? user.mode : undefined;
  // 模板层：规则给了主题 → 卡片；绑定了原生样式 → 原生；都没有 → 卡片
  const templateMode: "native" | "card" | undefined = ruleTheme ? "card" : hasDocumentStyle ? "native" : undefined;
  let mode = pickLayer<"native" | "card">(blockCodeMode(attrs, input.blockTheme), userMode, templateMode, "card");
  let note: string | undefined;
  if (mode.value === "native" && !hasDocumentStyle) {
    note = "要求原生段落模式，但模板没有原生代码样式，已回退卡片模式";
    mode = { value: "card", from: "default" };
  }

  return {
    mode,
    theme: pickLayer(str(input.blockTheme), str(user.template), ruleTheme, BUILTIN_DEFAULTS.code.template),
    lineNumbers: pickLayer(attrBool(attrs.line ?? attrs.lineNumbers), user.lineNumbers, undefined, BUILTIN_DEFAULTS.code.lineNumbers),
    border: pickLayer(attrBool(attrs.border), user.border, undefined, BUILTIN_DEFAULTS.code.border),
    lint: pickLayer(attrBool(attrs.lint), user.lint, rule?.lint, BUILTIN_DEFAULTS.code.lint),
    tabSize: user.tabSize ?? BUILTIN_DEFAULTS.code.tabSize,
    fontFamily: user.fontFamily ?? ruleCodeFont(rule).fontFamily,
    fontEastAsia: user.fontEastAsia ?? ruleCodeFont(rule).fontEastAsia,
    fontSize: user.fontSize ?? ruleCodeFont(rule).fontSize,
    ...(note ? { note } : {}),
  };
}

/* ---------------------------------- 图片 ---------------------------------- */

export interface ImageSettings {
  align: Resolved<string>;
  size: Resolved<string | number>;
  width?: string | number;
  height?: string | number;
  maxWidth: number;
  captionAlign: Resolved<string>;
  /** 图注样式：block/user 给的是样式名/锚点/配方名；template 给的是 captionRef 或 captionStyle。 */
  captionStyle?: Resolved<unknown>;
}

export function resolveImageSettings(input: {
  attrs: Attrs;
  rule: TemplateRule | null | undefined;
  user: ImageBlockConfig | undefined;
}): ImageSettings {
  const { attrs } = input;
  const user = input.user ?? {};
  const opts = ruleOptions(input.rule);
  const templateCaption = opts.captionRef !== undefined ? { captionRef: opts.captionRef } : opts.captionStyle !== undefined ? { captionStyle: opts.captionStyle } : undefined;
  const captionStyle = pickLayer<unknown>(attrs.captionStyle || attrs.style, user.captionStyle, templateCaption, undefined);
  return {
    align: pickLayer(attrs.align, user.align, str(opts.align), BUILTIN_DEFAULTS.image.align),
    size: pickLayer<string | number>(attrs.size, user.size, opts.size as string | number | undefined, BUILTIN_DEFAULTS.image.size),
    width: pickLayer<string | number | undefined>(attrs.width, user.width, opts.width as string | number | undefined, undefined).value,
    height: pickLayer<string | number | undefined>(attrs.height, user.height, opts.height as string | number | undefined, undefined).value,
    maxWidth: user.maxWidth ?? BUILTIN_DEFAULTS.image.maxWidth,
    captionAlign: pickLayer(attrs.captionAlign, user.captionAlign, str(opts.captionAlign), BUILTIN_DEFAULTS.image.captionAlign),
    ...(captionStyle.value !== undefined ? { captionStyle } : {}),
  };
}

/* ---------------------------------- 表格 ---------------------------------- */

export interface TableSettings {
  theme: Resolved<string>;
  header: Resolved<boolean>;
  align: Resolved<string>;
  /** 模板层的「复用文档已有表格」锚点；仅当主题也来自模板/默认层时生效。 */
  styleAnchor?: string;
}

export function resolveTableSettings(input: {
  attrs: Attrs;
  rule: TemplateRule | null | undefined;
  user: TableBlockConfig | undefined;
}): TableSettings {
  const { attrs } = input;
  const user = input.user ?? {};
  const opts = ruleOptions(input.rule);
  const theme = pickLayer(attrs.theme, user.theme, str(opts.theme), BUILTIN_DEFAULTS.table.theme);
  const userHeader = user.header === "auto" ? undefined : user.header;
  const templateHeader = typeof opts.header === "boolean" ? opts.header : undefined;
  const styleAnchor = str(opts.styleAnchor);
  return {
    theme,
    header: pickLayer(attrBool(attrs.header), userHeader, templateHeader, BUILTIN_DEFAULTS.table.header),
    align: pickLayer(attrs.align, user.align, str(opts.align), BUILTIN_DEFAULTS.table.align),
    // 使用者（块/全局）显式指定了主题，就不再克隆模板里的样板表
    ...(styleAnchor && (theme.from === "template" || theme.from === "default") ? { styleAnchor } : {}),
  };
}

/** 把 CLI / API 的零散选项并入使用者层（优先级：CLI > --extra > 配置文件）。 */
export function buildUserSettings(
  fileAndExtra: Partial<ReportConfig>,
  cli: { code?: CodeBlockConfig; image?: ImageBlockConfig; table?: TableBlockConfig },
): UserSettings {
  const strip = <T extends object>(obj: T | undefined): Partial<T> =>
    Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
  return {
    code: { ...(fileAndExtra.code ?? {}), ...strip(cli.code) },
    image: { ...(fileAndExtra.image ?? {}), ...strip(cli.image) },
    table: { ...(fileAndExtra.table ?? {}), ...strip(cli.table) },
  };
}
