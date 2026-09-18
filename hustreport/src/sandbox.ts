import vm from "node:vm";
import type { DocumentEditor, EditorTarget, EditorTargets } from "./editor.ts";

/**
 * 给“第二个 AI”看的沙盒 API 文档。会原样嵌入代码生成 prompt，
 * 因此这里同时是给模型看的说明，也是沙盒实际暴露的能力。
 */
export const EDITOR_API_DOC = `# 沙盒编辑 API（JavaScript）

沙盒是受限的 JS 环境：不能 require/import、不能读写文件、不能访问网络。可用全局：

- \`api\`：唯一允许产生修改的入口
- \`segments\`：数组，元素 \`{ index, ref, text, styleId }\`
- \`styles\`：数组，元素 \`{ id, summary, paragraph, run }\`
- \`data\`：上一步 AI 的分析结果（任意 JSON）
- \`markdown\`：用户提供的 Markdown 原文
- \`console.log(...)\` / \`api.log(...)\`：写日志

## target：怎么指一段内容

以下任意一种都行，**数组也可以**（批量）：

- segment 对象（\`segments\` 里的元素）——最推荐，直接 \`api.set(seg, "…")\`
- ref 字符串：\`seg.ref\`
- 选择器：\`{ ref }\` / \`{ index }\` / \`{ styleId, match: { contains | regex } }\`

## 方法

查询：

- \`api.find(target)\` → 匹配的 segment 数组
- \`api.text(target)\` → 第一个匹配的文本，找不到返回 \`null\`
- \`api.ref(target)\` → 稳定 ref 字符串

修改：

- \`api.set(target, text, mode?)\` → 改写；\`mode\` 为 \`"replace"\`(默认) / \`"append"\` / \`"prepend"\`
- \`api.insertAfter(target, text, opts?)\` → 在目标后插入
- \`api.insertBefore(target, text, opts?)\` → 在目标前插入
- \`api.insertMany(target, items)\` → 在目标后**按数组顺序**插入多段
- \`api.remove(target, opts?)\` / \`api.delete(target, opts?)\` → 删除
- \`api.commit()\` → 立即应用（可选，结束时会自动应用剩余操作）

其中：

- \`opts\`（insert）= \`{ useStyleId?, as? }\`；**\`useStyleId\` 可省略**，默认复用目标 segment 自己的样式；
  \`as\` 为 \`"paragraph"\`(默认，新建段落) / \`"run"\`(同段落内加一段文字)
- \`opts\`（remove）= \`{ as?: "run"(默认，只删内容) | "paragraph"(删整段) }\`
- \`items\`（insertMany）= \`[{ text, useStyleId?, as? }, ...]\`

## 约定（重要）

- 只调用 \`api.*\`，不要有其它副作用。
- **选择器未命中不会报错**，只会记为 warning 并跳过：可以放心用条件筛选，不用担心抛异常。
- 代码是 JS，支持 \`const/let\`、循环、\`await\`、\`return\`。
- 结尾用 \`console.log\` 汇报，并 \`return\` 一个简短摘要对象。

## 示例

\`\`\`js
// 1) 按下划线空白样式填入数据
const blanks = api.find({ styleId: 8 });
["U202612345", "张三", "李四"].forEach((v, i) => blanks[i] && api.set(blanks[i], v));

// 2) 删除占位（“此处填写”“XXX”“____”等；找不到也不报错）
api.remove(api.find({ match: { regex: "^[\\\\s_]*$" } }), { as: "run" });

// 3) 在“五、源码”段后，按顺序追加整节内容（样式 12=正文，21=代码）
const anchor = api.find({ match: { contains: "五、源码" } })[0];
api.insertMany(anchor, [
  { text: "六、参考文献", useStyleId: 26 },
  { text: "1. 深入理解计算机系统（第 3 版）" },
  { text: "2. 计算机系统基础实验指导书" },
]);

// 4) 同段落内补一句话（复用该段样式）
api.insertAfter(api.find({ match: { contains: "运行结果" } })[0], "（详见调试记录）", { as: "run" });

return { done: true };
\`\`\``;

export interface SandboxRunOptions {
  markdown?: string;
  /** 第一个 AI 的分析结果，作为 `data` 暴露。 */
  data?: unknown;
  timeoutMs?: number;
}

export interface SandboxRunResult {
  logs: string[];
  /** 沙盒代码的 `return` 值。 */
  value: unknown;
  error?: string;
}

/**
 * 在 `node:vm` 沙盒里执行 AI 生成的编辑代码。
 *
 * 说明：`vm` 不是强安全边界，但足以阻止误用 `fs` / `process` / 网络；适用于“用户自己的 AI
 * + 自己的文档”这一场景。
 */
export function runEditSandbox(
  editor: DocumentEditor,
  code: string,
  options: SandboxRunOptions = {},
): SandboxRunResult {
  const logs: string[] = [];
  const context: Record<string, unknown> = {
    api: createSandboxApi(editor, logs),
    segments: editor.segments,
    styles: editor.styles.map((style) => ({ id: style.id, summary: style.summary, paragraph: style.paragraph, run: style.run })),
    data: options.data,
    markdown: options.markdown ?? "",
    console: {
      log: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
      info: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
      warn: (...args: unknown[]) => logs.push(`WARN ${args.map(stringify).join(" ")}`),
      error: (...args: unknown[]) => logs.push(`ERROR ${args.map(stringify).join(" ")}`),
    },
  };

  const sandbox = vm.createContext(context);
  const wrapped = `"use strict";\n(async () => {\n${code}\n})()`;

  try {
    const script = new vm.Script(wrapped, { filename: "ai-edit.js" });
    const result = script.runInContext(sandbox, { timeout: options.timeoutMs ?? 10000 });
    // 沙盒代码是同步 API，正常情况下 result 是已 resolve 的 Promise。
    return { logs, value: result };
  } catch (error) {
    return { logs, value: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function createSandboxApi(editor: DocumentEditor, logs: string[]): Record<string, unknown> {
  const insertAfter = (target: EditorTarget, text: string, options: { useStyleId?: number; as?: "run" | "paragraph" } = {}) => {
    editor.insertAfter(target, text, options);
    return true;
  };
  const insertBefore = (target: EditorTarget, text: string, options: { useStyleId?: number; as?: "run" | "paragraph" } = {}) => {
    editor.insertBefore(target, text, options);
    return true;
  };

  return {
    // 查询
    find: (target: EditorTargets) => editor.find(target),
    text: (target: EditorTargets) => editor.text(target),
    ref: (target: EditorTargets) => editor.find(target)[0]?.ref.id ?? null,

    // 修改
    set: (target: EditorTargets, text: string, mode?: "replace" | "append" | "prepend") => {
      editor.set(target, text, mode);
      return true;
    },
    insertAfter,
    insertBefore,
    insertMany: (target: EditorTarget, items: ReadonlyArray<{ text: string; useStyleId?: number; as?: "run" | "paragraph" }>) => {
      editor.insertManyAfter(target, items);
      return true;
    },
    remove: (target: EditorTargets, options?: { as?: "run" | "paragraph" }) => {
      editor.remove(target, options);
      return true;
    },
    delete: (target: EditorTargets, options?: { as?: "run" | "paragraph" }) => {
      editor.remove(target, options);
      return true;
    },

    // 其它
    log: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
    commit: () => {
      const result = editor.commit();
      return { applied: result.applied, inserted: result.inserted, deleted: result.deleted, warnings: result.warnings };
    },
  };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
