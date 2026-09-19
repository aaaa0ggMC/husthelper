import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";

export interface CodeHighlightRun {
  text: string;
  classes: string[];
}

export interface CodeHighlightLine {
  lineNumber: number;
  runs: CodeHighlightRun[];
}

export interface CodeHighlightResult {
  lang: string;
  lines: CodeHighlightLine[];
}

export interface HighlightOptions {
  lang?: string;
  tabSize?: number;
}

const LANG_ALIASES: Record<string, string> = {
  py: "python",
  python: "python",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  java: "java",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  markup: "markup",
  markdown: "markdown",
  md: "markdown",
  css: "css",
  verilog: "verilog",
  v: "verilog",
  vhdl: "vhdl",
  php: "php",
  ruby: "ruby",
  rb: "ruby",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  scala: "scala",
  matlab: "matlab",
  r: "r",
  diff: "diff",
  patch: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  makefile: "makefile",
  make: "makefile",
  ini: "ini",
  toml: "toml",
  latex: "latex",
  tex: "latex",
};

const loadedLangs = new Set<string>(["markup", "css", "clike", "javascript"]);

function ensureLanguage(lang: string): string {
  const target = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  if (target && !loadedLangs.has(target)) {
    try {
      loadLanguages([target]);
      loadedLangs.add(target);
    } catch {
      // 忽略无法加载的语言，回退纯文本
    }
  }
  return target;
}

/**
 * 使用 Prism 对代码文本进行语法高亮分析，输出带行号和 Token 类型的行流。
 */
export function highlightCode(code: string, options: HighlightOptions = {}): CodeHighlightResult {
  const rawLang = (options.lang ?? "text").trim().toLowerCase();
  const lang = ensureLanguage(rawLang);
  const tabSize = options.tabSize ?? 4;

  // 规范化代码文本，移除末尾多余空行，统一换行符
  const normalizedCode = code.replace(/\r\n|\r/g, "\n").replace(/\n$/, "");

  const grammar = Prism.languages[lang];
  const tokens = grammar ? Prism.tokenize(normalizedCode, grammar) : [normalizedCode];

  const lines: CodeHighlightLine[] = [];
  let currentRuns: CodeHighlightRun[] = [];

  function pushRun(text: string, classes: string[]): void {
    if (!text) return;
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        lines.push({ lineNumber: lines.length + 1, runs: currentRuns });
        currentRuns = [];
      }
      const chunk = parts[i].replace(/\t/g, " ".repeat(tabSize));
      if (chunk.length > 0) {
        currentRuns.push({ text: chunk, classes });
      }
    }
  }

  function walk(token: unknown, currentClasses: string[] = []): void {
    if (typeof token === "string") {
      pushRun(token, currentClasses);
    } else if (Array.isArray(token)) {
      for (const item of token) walk(item, currentClasses);
    } else if (token && typeof token === "object") {
      const t = token as { type: string; alias?: string | string[]; content: unknown };
      const nextClasses = [...currentClasses, t.type];
      if (t.alias) {
        if (Array.isArray(t.alias)) nextClasses.push(...t.alias);
        else nextClasses.push(t.alias);
      }
      walk(t.content, nextClasses);
    }
  }

  walk(tokens);
  lines.push({ lineNumber: lines.length + 1, runs: currentRuns });

  return {
    lang,
    lines,
  };
}
