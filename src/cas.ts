import crypto from "node:crypto";
import type { AIConfig } from "./openai.ts";
import { Session } from "./http.ts";
import { fetchCaptchaGif, gifToJpeg } from "./captcha.ts";
import { recognizeCaptcha } from "./openai.ts";
import { recognizeStdCharPipe, type StdCharOptions } from "./stdchar-pipe.ts";
import { defaultLogger, type Logger } from "./logger.ts";

/**
 * HUST 统一身份认证（CAS）门面。
 *
 * pass.hust.edu.cn 是整个 HUST 登录的唯一入口，登录成功后由 CAS 签发长期票据
 * `CASTGC`；ecard / mhub / hkwxy / wechat / one.hust 等都属于「受 CAS 保护的应用
 * （service）」——它们各自的会话（JSESSIONID 等）都是拿 `CASTGC` 换 ticket 后
 * 兑换得到的。因此本文件只描述 CAS 协议本身与通用的应用会话获取流程，具体应用
 * 只需在各自模块里声明一个 `CasService`。
 */

/* ------------------------------ CAS 门面常量 ------------------------------ */

export const CAS_HOST = "pass.hust.edu.cn";
export const CAS_ORIGIN = `https://${CAS_HOST}`;
export const CAS_LOGIN = `${CAS_ORIGIN}/cas/login`;
export const CAS_RSA = `${CAS_ORIGIN}/cas/rsa`;
export const CAS_CODE = `${CAS_ORIGIN}/cas/code`;

/** CAS 长期票据 cookie：所有应用共用的登录门面凭据 */
export const CASTGC_COOKIE = "CASTGC";

/* ------------------------------- 凭据 / OCR ------------------------------- */

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

export interface LoginContext {
  credentials: Credentials;
  ocr: OcrStrategy;
}

export type LoginContextProvider = () => LoginContext;

/* ------------------------------ CAS 应用描述 ------------------------------ */

export interface CasResponse {
  status: number;
  headers: Record<string, unknown>;
  data?: unknown;
}

/** 一个受 CAS 保护的应用（ecard / mhub / hkwxy / wechat / one.hust ...） */
export interface CasService {
  /** 日志与错误信息里的短名，如 "ecard" */
  readonly name: string;
  /** 应用域名，用于读写该应用的会话 cookie */
  readonly host: string;
  /** 应用根地址，用于解析相对跳转 */
  readonly base: string;
  /** 传入 CAS 的 service 参数（通常是应用入口 URL） */
  readonly service: string;
  /** 应用自己的会话 cookie 名，如 "JSESSIONID" */
  readonly sessionCookie: string;
  /** 完整登录前可选的引导地址（先访问一次，建立应用侧初始 cookie） */
  readonly bootstrapUrl?: string;
  /** ticket 兑换时最多跟随的跳转次数，默认 8 */
  readonly ticketHops?: number;
  /** 可选的「被重定向回 CAS」判定，默认使用 {@link isCasLoginResponse} */
  readonly isLoginRedirect?: (response: CasResponse) => boolean;
}

export function casLoginUrl(service: string): string {
  return `${CAS_LOGIN}?service=${encodeURIComponent(service)}`;
}

export function serviceUrl(service: CasService, path: string): string {
  if (path.startsWith("http")) return path;
  return `${service.base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 判断响应是否表示会话失效、需要重新走 CAS（通用判定） */
export function isCasLoginResponse(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    location.includes("/cas/login")
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  const body = typeof response.data === "string" ? response.data : "";
  return (
    contentType.includes("text/html") &&
    (body.includes('name="_eventId"') || body.includes("/cas/login?redirectUrl="))
  );
}

/* -------------------------------- 内部工具 -------------------------------- */

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

/* ------------------------------ 通用应用会话 ------------------------------ */

/**
 * 带 `CASTGC` 访问 CAS，尝试免密换票。
 * @returns 带 ticket 的 Location；若 `CASTGC` 缺失/失效则返回 null（需要完整登录）
 */
export async function requestCasTicket(
  session: Session,
  service: CasService,
  logger: Logger = defaultLogger,
): Promise<string | null> {
  logger.debug(`${service.name}: 尝试用 CASTGC 免密换票`);
  const response = await session.get<string>(casLoginUrl(service.service), {
    responseType: "text",
  });
  const location = response.headers["location"] as string | undefined;

  if (response.status >= 300 && response.status < 400 && location?.includes("ticket=")) {
    logger.debug(`${service.name}: CASTGC 有效，拿到 ticket`);
    return location;
  }
  return null;
}

/** 用带 ticket 的地址兑换应用会话 cookie，返回该 cookie 值 */
export async function exchangeTicket(
  session: Session,
  location: string,
  service: CasService,
  logger: Logger = defaultLogger,
): Promise<string> {
  const maxHops = service.ticketHops ?? 8;
  let current = new URL(location, service.base).toString();

  for (let hop = 0; hop < maxHops; hop++) {
    const response = await session.get<string>(current, {
      responseType: "text",
      omitCookies: hop === 0,
    });
    const next = response.headers["location"] as string | undefined;
    if (response.status >= 300 && response.status < 400 && typeof next === "string") {
      current = new URL(next, current).toString();
      continue;
    }
    break;
  }

  // 优先按 service 入口 URL 的路径匹配（同名不同 Path 的会话 cookie），退回域名
  const value =
    session.getCookie(service.sessionCookie, service.service) ??
    session.getCookie(service.sessionCookie, service.host);
  if (!value) {
    throw new Error(`${service.name}: 未在 ${service.host} 拿到 ${service.sessionCookie}`);
  }
  logger.info(`${service.name} 会话获取成功`);
  return value;
}

/**
 * 执行完整 CAS 登录表单（RSA + 验证码 + 密码），返回带 ticket 的通行凭证 Location。
 * 只负责「拿到 ticket」，不兑换任何应用会话——因此既能用于普通应用，
 * 也能用于 one.hust 这类以 OAuth2 authorize 作为 service 的委托流程。
 */
export async function performCasLogin(
  session: Session,
  service: string,
  credentials: Credentials,
  ocr: OcrStrategy,
  options: LoginOptions = {},
): Promise<string> {
  const logger = options.logger ?? defaultLogger;
  logger.debug("获取 CAS 登录页 / lt / execution");
  const page = await session.get<string>(casLoginUrl(service), {
    responseType: "text",
  });
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

  const login = await session.post<string>(casLoginUrl(service), form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    responseType: "text",
  });

  const location = login.headers["location"] as string | undefined;
  if (!location) throw new Error("登录失败，响应中没有 Location 字段，未拿到通行凭证");
  logger.info(`登录成功，拿到通行凭证: ${location}`);
  return location;
}

/** 完整登录（RSA + 验证码 + 密码）并兑换 CAS 应用会话 */
export async function fullLogin(
  session: Session,
  service: CasService,
  credentials: Credentials,
  ocr: OcrStrategy,
  options: LoginOptions = {},
): Promise<string> {
  const logger = options.logger ?? defaultLogger;
  logger.info(`开始完整登录流程 (${service.name})...`);

  if (service.bootstrapUrl) {
    logger.debug(`引导访问 ${service.bootstrapUrl}`);
    await session.get(service.bootstrapUrl);
  }

  const location = await performCasLogin(session, service.service, credentials, ocr, { logger });
  return exchangeTicket(session, location, service, logger);
}

export interface AcquireOptions {
  logger?: Logger;
}

/**
 * 获取（必要时重新获取）某个 CAS 应用的会话。
 * 先用 `CASTGC` 免密换票；若 `CASTGC` 缺失/失效，则回退到完整登录。
 * `login` 只在需要完整登录时才会被求值，因此已持有 `CASTGC` 的调用方无需配置 OCR。
 */
export async function acquireServiceSession(
  session: Session,
  service: CasService,
  login: LoginContextProvider,
  options: AcquireOptions = {},
): Promise<string> {
  const logger = options.logger ?? defaultLogger;

  const ticket = await requestCasTicket(session, service, logger);
  if (ticket) return exchangeTicket(session, ticket, service, logger);

  logger.warn(`${service.name}: CASTGC 缺失或失效，回退完整登录`);
  const context = login();
  return fullLogin(session, service, context.credentials, context.ocr, { logger });
}
