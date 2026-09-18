import axios from "axios";

export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeout?: number;
}

const SYSTEM_PROMPT =
  "你是验证码识别助手。用户会给出一张经过多帧时域合成处理的验证码图片，" +
  "请只输出图中的字符本身，不要输出任何解释、标点或空格。";

const USER_PROMPT = "识别这张图片中的验证码，直接给出字符。";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function recognizeCaptcha(image: Buffer, config: AIConfig): Promise<string> {
  const dataUrl = `data:image/jpeg;base64,${image.toString("base64")}`;

  let response;
  try {
    response = await axios.post<ChatCompletionResponse>(
      `${config.baseURL.replace(/\/+$/, "")}/chat/completions`,
      {
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens ?? 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: USER_PROMPT },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      },
      {
        timeout: config.timeout ?? 60000,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? "无响应";
      const body =
        typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data);
      throw new Error(
        `AI 接口请求失败 (${status}) model=${config.model} url=${config.baseURL}: ${
          (body && body !== "undefined" ? body : error.message).slice(0, 800)
        }`,
      );
    }
    throw error;
  }

  const content = response.data.choices?.[0]?.message?.content ?? "";
  const code = content.replace(/[^0-9a-zA-Z]/g, "");
  if (!code) throw new Error(`AI 未能识别出验证码，原始返回: ${JSON.stringify(content)}`);
  return code;
}
