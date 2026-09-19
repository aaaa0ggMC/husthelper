import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CodeThemeContainer {
  backgroundColor?: string;
  borderColor?: string;
  borderSize?: number;
  fontFamily: string;
  fontSize: number; // OOXML w:sz (半磅，如 19 代表 9.5pt)
  color?: string;
}

export interface CodeThemeGutter {
  backgroundColor?: string;
  color?: string;
  borderRightColor?: string;
  borderRightSize?: number; // OOXML w:sz (八分之一磅)
}

export interface CodeTokenStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface CodeTheme {
  name: string;
  container: CodeThemeContainer;
  gutter: CodeThemeGutter;
  tokens: Record<string, CodeTokenStyle>;
}

const NAMED_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  gray: "808080",
  grey: "808080",
  silver: "C0C0C0",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  purple: "800080",
  cyan: "00FFFF",
  magenta: "FF00FF",
  transparent: "AUTO",
};

/** 把任意 CSS 颜色转成 6 位大写 HEX（或 undefined）。 */
export function normalizeHexColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const clean = raw.replace(/!important/g, "").trim().toLowerCase();
  if (!clean || clean === "none" || clean === "transparent" || clean === "inherit") return undefined;

  if (NAMED_COLORS[clean]) return NAMED_COLORS[clean];

  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(clean);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return (hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]).toUpperCase();
    }
    if (hex.length === 4) {
      return (hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]).toUpperCase();
    }
    return hex.slice(0, 6).toUpperCase();
  }

  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(clean);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10))).toString(16).padStart(2, "0");
    const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10))).toString(16).padStart(2, "0");
    const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10))).toString(16).padStart(2, "0");
    return (r + g + b).toUpperCase();
  }

  return undefined;
}

/** 把 CSS 尺寸（如 9.5pt, 14px）转换为 OOXML 半磅字号（w:sz）。 */
export function parseFontSizeToHalfPoints(raw: string | undefined, fallback = 19): number {
  if (!raw) return fallback;
  const clean = raw.replace(/!important/g, "").trim().toLowerCase();
  const ptMatch = /^([0-9.]+)\s*pt$/.exec(clean);
  if (ptMatch) {
    const pt = parseFloat(ptMatch[1]);
    if (!isNaN(pt) && pt > 0) return Math.round(pt * 2);
  }
  const pxMatch = /^([0-9.]+)\s*px$/.exec(clean);
  if (pxMatch) {
    const px = parseFloat(pxMatch[1]);
    if (!isNaN(px) && px > 0) return Math.round(px * 1.5); // 1px ≈ 0.75pt = 1.5 half-pts
  }
  return fallback;
}

/** 把 CSS 边框宽度（如 1px, 3px, 1pt）转成 OOXML 八分之一磅（w:sz）。 */
export function parseBorderSizeToEighths(raw: string | undefined, fallback = 8): number {
  if (!raw) return fallback;
  const clean = raw.replace(/!important/g, "").trim().toLowerCase();
  const pxMatch = /^([0-9.]+)\s*px$/.exec(clean);
  if (pxMatch) {
    const px = parseFloat(pxMatch[1]);
    if (!isNaN(px) && px > 0) return Math.max(4, Math.round(px * 6)); // 1px ≈ 0.75pt = 6 eighths
  }
  const ptMatch = /^([0-9.]+)\s*pt$/.exec(clean);
  if (ptMatch) {
    const pt = parseFloat(ptMatch[1]);
    if (!isNaN(pt) && pt > 0) return Math.max(4, Math.round(pt * 8));
  }
  return fallback;
}

/** 解析单行 border 简写（如 "3px solid #6ce26c"）。 */
function parseBorderShorthand(value: string): { size?: number; color?: string } {
  let size: number | undefined;
  let color: string | undefined;
  for (const part of value.split(/\s+/)) {
    if (/\d+(px|pt)/i.test(part)) size = parseBorderSizeToEighths(part);
    else {
      const c = normalizeHexColor(part);
      if (c) color = c;
    }
  }
  return { size, color };
}

/** 从 CSS 文本解析出 CodeTheme。 */
export function parseCodeThemeCss(cssText: string, themeName = "custom"): CodeTheme {
  const container: CodeThemeContainer = {
    fontFamily: "Consolas",
    fontSize: 19, // 9.5pt
  };
  const gutter: CodeThemeGutter = {
    backgroundColor: "F6F8FA",
    color: "959DA5",
    borderRightColor: "52C41A",
    borderRightSize: 18, // ~2.25pt
  };
  const tokens: Record<string, CodeTokenStyle> = {};

  // 1. 去除注释
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. 逐块解析选择器与声明
  const blockRegex = /([^{}]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(stripped)) !== null) {
    const rawSelectors = match[1];
    const rawDeclarations = match[2];

    const decls: Record<string, string> = {};
    for (const line of rawDeclarations.split(";")) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const prop = line.slice(0, colon).trim().toLowerCase();
      const val = line.slice(colon + 1).trim();
      decls[prop] = val;
    }

    const selectors = rawSelectors.split(",").map((s) => s.trim().toLowerCase());

    for (const sel of selectors) {
      const isContainer = sel.includes("syntaxhighlighter") || sel.includes("code-block") || sel.startsWith("pre");
      const isGutter = sel.includes("gutter") || sel.includes("line-numbers");

      if (isContainer && !isGutter) {
        if (decls["background-color"]) container.backgroundColor = normalizeHexColor(decls["background-color"]);
        else if (decls["background"]) container.backgroundColor = normalizeHexColor(decls["background"]);

        if (decls["color"]) container.color = normalizeHexColor(decls["color"]);

        if (decls["font-family"]) {
          const firstFont = decls["font-family"].split(",")[0].replace(/["\']/g, "").trim();
          if (firstFont) container.fontFamily = firstFont;
        }

        if (decls["font-size"]) container.fontSize = parseFontSizeToHalfPoints(decls["font-size"], container.fontSize);

        if (decls["border"]) {
          const b = parseBorderShorthand(decls["border"]);
          if (b.color) container.borderColor = b.color;
          if (b.size) container.borderSize = b.size;
        }
        if (decls["border-color"]) container.borderColor = normalizeHexColor(decls["border-color"]);
      }

      if (isGutter) {
        if (decls["background-color"]) gutter.backgroundColor = normalizeHexColor(decls["background-color"]);
        else if (decls["background"]) gutter.backgroundColor = normalizeHexColor(decls["background"]);

        if (decls["color"]) gutter.color = normalizeHexColor(decls["color"]);

        if (decls["border-right"]) {
          const b = parseBorderShorthand(decls["border-right"]);
          if (b.color) gutter.borderRightColor = b.color;
          if (b.size) gutter.borderRightSize = b.size;
        }
        if (decls["border-right-color"]) gutter.borderRightColor = normalizeHexColor(decls["border-right-color"]);
      }

      // 提取 Token 类名
      const classMatches = sel.match(/\.[a-z0-9_-]+/g);
      if (classMatches) {
        for (const rawClass of classMatches) {
          const className = rawClass.slice(1);
          if (["syntaxhighlighter", "code-block", "gutter", "line-numbers", "code", "line", "token"].includes(className)) {
            continue;
          }

          const style: CodeTokenStyle = tokens[className] ?? {};
          if (decls["color"]) {
            const col = normalizeHexColor(decls["color"]);
            if (col) style.color = col;
          }
          if (decls["font-weight"]) {
            if (/bold|[6-9]00/i.test(decls["font-weight"])) style.bold = true;
            else if (/normal|[1-4]00/i.test(decls["font-weight"])) style.bold = false;
          }
          if (decls["font-style"]) {
            if (/italic/i.test(decls["font-style"])) style.italic = true;
            else if (/normal/i.test(decls["font-style"])) style.italic = false;
          }

          tokens[className] = style;
        }
      }
    }
  }

  // 规范化别名补全
  if (tokens["comment"] && !tokens["comments"]) tokens["comments"] = tokens["comment"];
  if (tokens["comments"] && !tokens["comment"]) tokens["comment"] = tokens["comments"];
  if (tokens["function"] && !tokens["functions"]) tokens["functions"] = tokens["function"];
  if (tokens["functions"] && !tokens["function"]) tokens["function"] = tokens["functions"];
  if (tokens["number"] && !tokens["value"]) tokens["value"] = tokens["number"];
  if (tokens["value"] && !tokens["number"]) tokens["number"] = tokens["value"];

  return {
    name: themeName,
    container,
    gutter,
    tokens,
  };
}

/** 获取代码模板查找目录（hustreport/code_templates）。 */
export function getCodeTemplatesDir(): string {
  // 当前文件位于 hustreport/src/code-theme.ts
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../code_templates");
}

/** 同步解析并加载指定名称或路径的代码模板。 */
export function loadCodeThemeSync(nameOrPath = "default"): CodeTheme {
  const templatesDir = getCodeTemplatesDir();

  if (existsSync(nameOrPath)) {
    const raw = readFileSync(nameOrPath, "utf-8");
    return parseCodeThemeCss(raw, path.basename(nameOrPath, path.extname(nameOrPath)));
  }

  const candidate1 = path.join(templatesDir, nameOrPath.endsWith(".css") ? nameOrPath : `${nameOrPath}.css`);
  if (existsSync(candidate1)) {
    const raw = readFileSync(candidate1, "utf-8");
    return parseCodeThemeCss(raw, path.basename(nameOrPath, ".css"));
  }

  const defaultFile = path.join(templatesDir, "default.css");
  if (existsSync(defaultFile)) {
    const raw = readFileSync(defaultFile, "utf-8");
    return parseCodeThemeCss(raw, "default");
  }

  return defaultFallbackTheme();
}

/** 解析并加载指定名称或路径的代码模板。 */
export async function loadCodeTheme(nameOrPath = "default"): Promise<CodeTheme> {
  const templatesDir = getCodeTemplatesDir();

  // 1. 如果直接是已有文件路径
  if (existsSync(nameOrPath)) {
    const raw = await readFile(nameOrPath, "utf-8");
    return parseCodeThemeCss(raw, path.basename(nameOrPath, path.extname(nameOrPath)));
  }

  // 2. 检查 hustreport/code_templates/<name>.css 或 <name>
  const candidate1 = path.join(templatesDir, nameOrPath.endsWith(".css") ? nameOrPath : `${nameOrPath}.css`);
  if (existsSync(candidate1)) {
    const raw = await readFile(candidate1, "utf-8");
    return parseCodeThemeCss(raw, path.basename(nameOrPath, ".css"));
  }

  // 3. 回退检查 default.css
  const defaultFile = path.join(templatesDir, "default.css");
  if (existsSync(defaultFile)) {
    const raw = await readFile(defaultFile, "utf-8");
    return parseCodeThemeCss(raw, "default");
  }

  // 4. 极致回退：内置硬编码 default
  return defaultFallbackTheme();
}

function defaultFallbackTheme(): CodeTheme {
  return {
    name: "default",
    container: {
      backgroundColor: "FAFBFC",
      borderColor: "E1E4E8",
      borderSize: 8,
      fontFamily: "Consolas",
      fontSize: 19,
      color: "24292E",
    },
    gutter: {
      backgroundColor: "F6F8FA",
      color: "959DA5",
      borderRightColor: "52C41A",
      borderRightSize: 18,
    },
    tokens: {
      keyword: { color: "D73A49", bold: true },
      string: { color: "032F62" },
      comment: { color: "6A737D", italic: true },
      function: { color: "6F42C1" },
      number: { color: "005CC5" },
      operator: { color: "D73A49" },
      variable: { color: "E36209" },
    },
  };
}

