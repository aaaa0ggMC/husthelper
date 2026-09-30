import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface CodeBlockConfig {
  /** 代码高亮模板名称或 CSS 路径（如 "default", "classic", "eclipse", "dark" 或 "./my-theme.css"）。 */
  template?: string;
  /** 字体名称，设为 "inherit" 时自动跟随文档模板正文/代码样式字体。 */
  fontFamily?: string;
  /** 中文字体（w:eastAsia），如 "宋体"；"inherit" 跟随正文；不填则不写 eastAsia（沿用文档默认）。`fontFamily` 只管西文。 */
  fontEastAsia?: string;
  /** 字号：半磅数值（如 19）或 "9.5pt"、"10pt"，设为 "inherit" 时自动跟随文档正文字号。 */
  fontSize?: number | string;
  /** 是否展示行号，默认 true。 */
  lineNumbers?: boolean;
  /**
   * 代码块排版模式：auto（默认：模板有原生代码样式就用原生段落，否则卡片）、
   * native（强制原生段落）、card（强制行号卡片表格）。块级 `{mode=...}` 优先。
   */
  mode?: "auto" | "native" | "card";
  /** 卡片模式是否画外边框，默认 true。 */
  border?: boolean;
  /** 原生段落模式下是否做语法着色，默认 true。 */
  lint?: boolean;
  /** Tab 展开空格数，默认 4。 */
  tabSize?: number;
}

export interface ImageBlockConfig {
  /** 默认对齐方式，默认 "center"。 */
  align?: "left" | "center" | "right";
  /** 默认尺寸：如 "max" (适合版心的合适最大宽度), "80%", "400px", "300pt"。默认 "max"。 */
  size?: string | number;
  /** 显式指定宽度。 */
  width?: string | number;
  /** 显式指定高度。 */
  height?: string | number;
  /** 最大版心宽度（单位 pt），默认 430。 */
  maxWidth?: number;
  /** 图注样式：用户指定的 recipe 名或样式名（若 AI 指定了 refId/样式，AI 优先）。 */
  captionStyle?: string;
  /** 图注对齐方式：默认跟随图片对齐或 "center"。 */
  captionAlign?: "left" | "center" | "right";
}

export interface TableBlockConfig {
  /** 表格主题：academic (学术三线表), grid (标准全网格), striped (斑马纹), clean (极简无竖线)。默认 academic。 */
  theme?: "academic" | "grid" | "striped" | "clean";
  /** 是否包含表头行。true: 首行为表头；false: 无表头；"auto": 自动根据 markdown 格式判断。默认 "auto"。 */
  header?: boolean | "auto";
  /** 表格整体对齐方式，默认 "center"。 */
  align?: "left" | "center" | "right";
  /** 单元格内边距 (磅数或半磅)。 */
  cellPadding?: number;
}

/** 中英文空格排版（详见 typography.ts）。 */
export interface FormatConfig {
  /** 预设：keep（默认）/ space / tight。 */
  cjkSpacing?: string;
  /** 中文→西文 边界的空格：add | remove | keep。 */
  lspace?: string;
  /** 西文→中文 边界的空格：add | remove | keep。 */
  rspace?: string;
}

export interface ReportConfig {
  code?: CodeBlockConfig;
  format?: FormatConfig;
  image?: ImageBlockConfig;
  table?: TableBlockConfig;
  profile?: string;
  strip?: boolean;
  decodeEntities?: boolean;
  structured?: boolean;
  appendUnanchored?: boolean;
  /** 实际加载的配置文件路径（不可枚举，仅供日志展示）。 */
  source?: string;
  [key: string]: unknown;
}

/** 解析 --extra 参数字符串，支持 JSON 格式或 key.subkey=val 扁平语法。 */
export function parseExtraConfig(extra: string | undefined): Partial<ReportConfig> {
  if (!extra || !extra.trim()) return {};
  const trimmed = extra.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed) as Partial<ReportConfig>;
    } catch {
      // 降级继续尝试键值对解析
    }
  }

  const result: Record<string, any> = {};
  for (const part of trimmed.split(/[,;\n]/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let val: any = part.slice(eq + 1).trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);

    const keys = key.split(".");
    let curr = result;
    for (let i = 0; i < keys.length - 1; i += 1) {
      curr[keys[i]] = curr[keys[i]] || {};
      curr = curr[keys[i]];
    }
    curr[keys[keys.length - 1]] = val;
  }
  return result as Partial<ReportConfig>;
}

/** 深度合并配置对象（后者覆盖前者）。 */
export function mergeConfig<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const output = { ...base } as any;
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined && v !== null) {
      if (typeof v === "object" && !Array.isArray(v) && typeof output[k] === "object" && !Array.isArray(output[k])) {
        output[k] = mergeConfig(output[k], v);
      } else {
        output[k] = v;
      }
    }
  }
  return output;
}

/** 渲染配置文件名（按优先级）。`hustreport.config.json` 可同时容纳渲染段与 `openai` 段。 */
export const REPORT_CONFIG_NAMES = ["hustreport.config.json", "report.config.json"];

/**
 * 从 `cwd` 开始逐级向上查找第一个存在的配置文件（到文件系统根为止）。
 * `accept` 可进一步过滤（例如要求文件里含 `openai` 段），不满足则继续向上找。
 */
export function findConfigUpwards(
  names: readonly string[],
  cwd: string = process.cwd(),
  accept?: (raw: Record<string, unknown>, file: string) => boolean,
): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      if (!accept) return file;
      try {
        if (accept(JSON.parse(readFileSync(file, "utf-8")), file)) return file;
      } catch {
        // 解析失败的文件不作为候选，继续查找
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** 定位渲染配置：显式 --config 必须存在（否则报错），未指定则向上回溯查找。 */
export function locateReportConfig(options: { configFile?: string; cwd?: string } = {}): string | undefined {
  if (options.configFile) {
    const file = path.resolve(options.cwd ?? process.cwd(), options.configFile);
    if (!existsSync(file)) throw new Error(`配置文件不存在：${file}`);
    return file;
  }
  return findConfigUpwards(REPORT_CONFIG_NAMES, options.cwd);
}

function loadReportConfig(configFile: string | undefined, extra: string | undefined): ReportConfig {
  let fileConfig: Partial<ReportConfig> = {};
  if (configFile) {
    try {
      fileConfig = JSON.parse(readFileSync(configFile, "utf-8"));
    } catch (e) {
      console.warn(`读取配置文件 ${configFile} 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    // AI 段与渲染段可共存于同一文件；渲染不需要（也不应携带）密钥
    delete (fileConfig as Record<string, unknown>).openai;
    delete (fileConfig as Record<string, unknown>).ai;
  }

  // 只合并「使用者层」（配置文件 < --extra）；内置默认值统一在 settings.ts 的 BUILTIN_DEFAULTS，
  // 否则默认值会冒充使用者设置，压过模板规则。
  const merged = mergeConfig(fileConfig as ReportConfig, parseExtraConfig(extra));
  if (configFile) Object.defineProperty(merged, "source", { value: configFile, enumerable: false });
  return merged;
}

/** 同步读取配置文件并结合 --extra 合并出「使用者层」配置（不含内置默认；来源路径见不可枚举的 `source` 字段）。 */
export function resolveReportConfigSync(options: { configFile?: string; extra?: string; cwd?: string } = {}): ReportConfig {
  return loadReportConfig(locateReportConfig(options), options.extra);
}

/** 异步加载配置。 */
export async function resolveReportConfig(
  options: { configFile?: string; extra?: string; cwd?: string } = {},
): Promise<ReportConfig> {
  return resolveReportConfigSync(options);
}
