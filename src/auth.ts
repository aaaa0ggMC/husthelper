import crypto from "node:crypto";
import type { AIConfig } from "./openai.ts";
import { Session } from "./http.ts";
import { fetchCaptchaGif, gifToJpeg } from "./captcha.ts";
import { recognizeCaptcha } from "./openai.ts";
import { recognizeStdCharPipe, type StdCharOptions } from "./stdchar-pipe.ts";
import { defaultLogger, type Logger } from "./logger.ts";

export const CAS_ORIGIN = "https://pass.hust.edu.cn";
export const CAS_LOGIN = `${CAS_ORIGIN}/cas/login`;
export const CAS_RSA = `${CAS_ORIGIN}/cas/rsa`;
export const CAS_CODE = `${CAS_ORIGIN}/cas/code`;

export const ECARD_HOST = "ecard.m.hust.edu.cn";
export const ECARD_BASE = "http://ecard.m.hust.edu.cn:80/wechat-web";
export const ECARD_SERVICE = `${ECARD_BASE}/`;

export const LOGIN_URL = `${CAS_LOGIN}?service=${encodeURIComponent(ECARD_SERVICE)}`;

export interface Credentials {
  un: string;
  pwd: string;
}

export type RawOcr = (gif: Buffer) => string | Promise<string>;
export type ParsedOcr = (jpg: Buffer) => string | Promise<string>;

export interface AiOcr {
  config: AIConfig;
  onImage?: (jpg: Buffer) => void;
}

export interface OcrStrategy {
  kind: "raw" | "parsed" | "ai" | "stdchar";
  raw?: RawOcr;
  parsed?: ParsedOcr;
  ai?: AiOcr;
  stdChar?: StdCharOptions;
}

export interface LoginOptions {
  logger?: Logger;
}

function encryptField(publicKey: string, text: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(text, "utf-8"),
  );
  return encrypted.toString("base64");
}

function hiddenValue(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i"));
  if (!match) throw new Error(`登录页缺少表单字段: ${name}`);
  return match[1];
}

async function resolveCode(
  session: Session,
  ocr: OcrStrategy,
  logger: Logger,
): Promise<string> {
  logger.debug("拉取验证码 GIF...");
  const gif = await fetchCaptchaGif(session, CAS_CODE);
  logger.debug(`验证码 GIF ${gif.length} 字节，进行时域合成...`);

  if (ocr.kind === "raw") {
    if (!ocr.raw) throw new Error("缺少 raw OCR 回调");
    return ocr.raw(gif);
  }

  if (ocr.kind === "stdchar") {
    logger.debug("调用 stdchar 子进程识别...");
    return recognizeStdCharPipe(gif, ocr.stdChar);
  }

  const jpg = gifToJpeg(gif, { scale: 4, quality: 92 });

  if (ocr.kind === "parsed") {
    if (!ocr.parsed) throw new Error("缺少 parsed OCR 回调");
    return ocr.parsed(jpg);
  }

  if (!ocr.ai) throw new Error("缺少 AI OCR 配置");
  ocr.ai.onImage?.(jpg);
  logger.debug(`合成 JPG ${jpg.length} 字节，发送给 AI 识别...`);
  return recognizeCaptcha(jpg, ocr.ai.config);
}

export async function exchangeTicket(session: Session, location: string): Promise<string> {
  await session.get(location, { responseType: "text", omitCookies: true });
  const jsessionId = session.getCookie("JSESSIONID", ECARD_HOST);
  if (!jsessionId) throw new Error(`未在 ${ECARD_HOST} 的 set-cookie 中找到 JSESSIONID`);
  return jsessionId;
}

export async function fullLogin(
  session: Session,
  credentials: Credentials,
  ocr: OcrStrategy,
  options: LoginOptions = {},
): Promise<string> {
  const logger = options.logger ?? defaultLogger;

  logger.info("开始完整登录流程...");
  logger.debug(`访问一卡通入口 ${ECARD_SERVICE}`);
  await session.get(ECARD_SERVICE);

  logger.debug("获取 CAS 登录页 / lt / execution");
  const page = await session.get<string>(LOGIN_URL, { responseType: "text" });
  const lt = hiddenValue(page.data, "lt");
  const execution = hiddenValue(page.data, "execution");

  logger.debug("获取 RSA 公钥并加密账号密码");
  const rsa = await session.post<{ publicKey: string }>(CAS_RSA);
  const ul = encryptField(rsa.data.publicKey, credentials.un);
  const pl = encryptField(rsa.data.publicKey, credentials.pwd);

  const code = await resolveCode(session, ocr, logger);
  logger.info(`验证码识别结果: ${code}`);

  const form = new URLSearchParams({
    un: credentials.un,
    pd: "",
    ul,
    pl,
    code,
    lt,
    execution,
    _eventId: "submit",
  });

  const login = await session.post<string>(LOGIN_URL, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    responseType: "text",
  });

  const location = login.headers["location"] as string | undefined;
  if (!location) throw new Error("登录失败，响应中没有 Location 字段，未拿到通行凭证");
  logger.info(`登录成功，拿到通行凭证: ${location}`);

  const jsessionId = await exchangeTicket(session, location);
  logger.info(`JSESSIONID: ${jsessionId}`);
  return jsessionId;
}

export async function tryCasRenew(
  session: Session,
  logger: Logger = defaultLogger,
): Promise<string | null> {
  logger.info("尝试用 CASTGC 免密续期...");
  const response = await session.get<string>(LOGIN_URL, { responseType: "text" });
  const location = response.headers["location"] as string | undefined;

  if (response.status >= 300 && response.status < 400 && location?.includes("ticket=")) {
    logger.debug("CASTGC 有效，拿到新 ticket");
    return exchangeTicket(session, location);
  }
  return null;
}
