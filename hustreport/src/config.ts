import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface CodeBlockConfig {
  /** 代码高亮模板名称或 CSS 路径（如 "default", "classic", "eclipse", "dark" 或 "./my-theme.css"）。 */
  template?: string;
  /** 字体名称，设为 "inherit" 时自动跟随文档模板正文/代码样式字体。 */
  fontFamily?: string;
  /** 字号：半磅数值（如 19）或 "9.5pt"、"10pt"，设为 "inherit" 时自动跟随文档正文字号。 */
  fontSize?: number | string;
  /** 是否展示行号，默认 true。 */
  lineNumbers?: boolean;
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

export interface ReportConfig {
  code?: CodeBlockConfig;
  image?: ImageBlockConfig;
  table?: TableBlockConfig;
  profile?: string;
  strip?: boolean;
  decodeEntities?: boolean;
  structured?: boolean;
  appendUnanchored?: boolean;
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

/** 同步读取配置文件并结合 --extra 合并出最终 ReportConfig。 */
export function resolveReportConfigSync(options: { configFile?: string; extra?: string } = {}): ReportConfig {
  let fileConfig: Partial<ReportConfig> = {};
  const configCandidate =
    options.configFile ??
    (existsSync("hustreport.config.json")
      ? "hustreport.config.json"
      : existsSync("report.config.json")
        ? "report.config.json"
        : undefined);

  if (configCandidate && existsSync(configCandidate)) {
    try {
      const raw = readFileSync(configCandidate, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch (e) {
      console.warn(`读取配置文件 ${configCandidate} 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const extraConfig = parseExtraConfig(options.extra);
  const baseDefaults: ReportConfig = {
    code: {
      template: "default",
      lineNumbers: true,
      tabSize: 4,
    },
  };

  return mergeConfig(mergeConfig(baseDefaults, fileConfig), extraConfig);
}

/** 异步加载配置。 */
export async function resolveReportConfig(options: { configFile?: string; extra?: string } = {}): Promise<ReportConfig> {
  let fileConfig: Partial<ReportConfig> = {};
  const configCandidate =
    options.configFile ??
    (existsSync("hustreport.config.json")
      ? "hustreport.config.json"
      : existsSync("report.config.json")
        ? "report.config.json"
        : undefined);

  if (configCandidate && existsSync(configCandidate)) {
    try {
      const raw = await readFile(configCandidate, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch (e) {
      console.warn(`读取配置文件 ${configCandidate} 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const extraConfig = parseExtraConfig(options.extra);
  const baseDefaults: ReportConfig = {
    code: {
      template: "default",
      lineNumbers: true,
      tabSize: 4,
    },
  };

  return mergeConfig(mergeConfig(baseDefaults, fileConfig), extraConfig);
}
