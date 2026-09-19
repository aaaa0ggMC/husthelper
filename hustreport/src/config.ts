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

export interface ReportConfig {
  code?: CodeBlockConfig;
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
