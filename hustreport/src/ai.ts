import OpenAI from "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI 兼容的 chat 接口配置（与仓库其它模块的 openai 段一致）。 */
export interface ChatConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/** 可注入的对话函数，便于测试或替换成别的模型服务。 */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

/** 构造一个调用 OpenAI 兼容 `/chat/completions` 的 `ChatFn`。 */
export function chatCompletion(config: ChatConfig): ChatFn {
  const client = new OpenAI({
    baseURL: config.baseURL.replace(/\/+$/, ""),
    apiKey: config.apiKey,
    timeout: config.timeout ?? 300000,
  });

  return async (messages) => {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.model,
        temperature: config.temperature ?? 0.2,
        max_tokens: config.maxTokens ?? 65536,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    } catch (error: any) {
      const status = error.status ?? error.statusCode ?? "无响应";
      const message = error.message ?? String(error);
      throw new Error(
        `OpenAI 接口请求失败 (${status}) model=${config.model} url=${config.baseURL}: ${message.slice(0, 800)}`,
      );
    }

    const choice = completion.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (!content) {
      const reasoning = (choice?.message as any)?.reasoning_content;
      console.error("AI 响应异常：", JSON.stringify(choice, null, 2));
      throw new Error(
        `AI 返回为空 (finish_reason=${choice?.finish_reason}, reasoning_length=${reasoning?.length ?? 0})`,
      );
    }
    return content;
  };
}

/**
 * 从模型输出里提取 JSON：兼容 ```json 围栏、前后解释文字。
 * 找不到合法 JSON 时返回 null（调用方自行决定降级策略）。
 */
export function extractJson<T = unknown>(text: string): T | null {
  const trimmed = text.trim();
  // 先直接当 JSON 解析：内容里（例如 skeleton 字符串）可能包含 ``` 代码围栏，不能被误当成外层围栏。
  const direct = tryParse<T>(trimmed);
  if (direct !== null) return direct;

  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  return tryParse<T>(candidate) ?? tryParse<T>(sliceBalanced(candidate));
}

/** 从模型输出里提取代码：优先取围栏代码块，否则整段当代码。 */
export function extractCode(text: string): string {
  const fenced = /```(?:js|javascript|ts|typescript)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function tryParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** 截取第一个 `{`/`[` 到对应配对的结尾，容忍模型在 JSON 前后加话。 */
function sliceBalanced(text: string): string {
  const start = text.search(/[[{]/);
  if (start < 0) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}
