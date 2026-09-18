import crypto from "node:crypto";
import type { AIConfig } from "./openai.ts";
import { Session } from "hustcore";
import { fetchCaptchaGif, gifToJpeg } from "./captcha.ts";
import { recognizeCaptcha } from "./openai.ts";
import { recognizeStdCharPipe, type StdCharOptions } from "./stdchar-pipe.ts";
import { defaultLogger, type Logger } from "hustcore";

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
/** 企业微信扫码登录：二维码内容指向的授权入口 */
export const CAS_QR_LOGIN = `${CAS_ORIGIN}/cas/qyQrLogin`;
/** 企业微信扫码登录：轮询扫码/授权状态 */
export const CAS_QR_CHECK = `${CAS_ORIGIN}/cas/checkQRCodeScan`;

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

/**
 * 子 SSO 流程（one.hust / pecg / petyxy / ihuster）的登录回退：
 * 对给定 CAS service 执行客户端配置的登录方式序列（密码 / 扫码 ...），返回带 ticket 的 Location。
 * 由 `HustClient` 提供，确保这些流程也能降级到扫码登录。
 */
export type CasLoginProvider = (serviceUrl: string) => Promise<string>;

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

/* ------------------------------ 企业微信扫码登录 ------------------------------ */

/**
 * 构造二维码内容：指向 CAS 的 `qyQrLogin` 授权入口。
 * 用企业微信（或绑定企业微信的微信）扫描后会走微信 OAuth，将扫码人与 `uuid` 绑定。
 */
export function qrScanUrl(uuid: string, service: string): string {
  return `${CAS_QR_LOGIN}?uuid=${encodeURIComponent(uuid)}&service=${encodeURIComponent(service)}`;
}

/** 构造扫码状态轮询地址 */
export function qrCheckUrl(uuid: string): string {
  return `${CAS_QR_CHECK}?random=${Math.random()}&uuid=${encodeURIComponent(uuid)}`;
}

export interface QrLoginOptions {
  logger?: Logger;
  /** 轮询间隔（毫秒），默认 3000 */
  intervalMs?: number;
  /** 单个二维码有效期（毫秒），默认 180000（前端为 60 次 × 3s） */
  timeoutMs?: number;
  /** 拿到二维码内容（需用户用企业微信扫描）时回调，可在此渲染终端二维码 */
  onQrCode?: (scanUrl: string) => void | Promise<void>;
}

export interface QrLoginResult {
  /** 本次扫码使用的二维码内容地址 */
  scanUrl: string;
  /** `checkQRCodeScan` 返回的跳转地址（部分部署通过 CASTGC 登录时为空） */
  redirectUrl?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function followRedirects(session: Session, start: string, maxHops = 8): Promise<void> {
  let current = new URL(start, CAS_ORIGIN).toString();
  for (let hop = 0; hop < maxHops; hop++) {
    const response = await session.get<string>(current, { responseType: "text" });
    const next = response.headers["location"];
    if (response.status >= 300 && response.status < 400 && typeof next === "string") {
      current = new URL(next, current).toString();
      continue;
    }
    break;
  }
}

/**
 * 企业微信扫码登录：生成二维码并轮询等待用户扫描/授权，成功后本次会话即拿到 `CASTGC`
 * （部分部署还会在 `checkQRCodeScan` 返回 `redirect_url`，会顺带跟随以建立应用会话）。
 *
 * 该流程无需账号密码与验证码，可用于绕过密码/验证码甚至企业微信 MFA。
 */
export async function qrLogin(
  session: Session,
  service: string,
  options: QrLoginOptions = {},
): Promise<QrLoginResult> {
  const logger = options.logger ?? defaultLogger;
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const uuid = crypto.randomUUID();
  const scanUrl = qrScanUrl(uuid, service);

  logger.info("请使用企业微信扫描二维码登录（企业微信 → 消息页右上角 + → 扫一扫）");
  await options.onQrCode?.(scanUrl);

  // 先访问登录页建立本次会话的 JSESSIONID；成功后 checkQRCodeScan 会向本会话下发 CASTGC
  await session.get<string>(casLoginUrl(service), { responseType: "text" });
  const castgcBefore = session.getCookie(CASTGC_COOKIE, CAS_HOST);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const response = await session.get<string>(qrCheckUrl(uuid), {
      responseType: "text",
      headers: { Referer: casLoginUrl(service), "X-Requested-With": "XMLHttpRequest" },
    });

    const body = typeof response.data === "string" ? response.data.trim() : "";
    let redirectUrl: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { redirect_url?: string; redirectUrl?: string };
        redirectUrl = parsed.redirect_url ?? parsed.redirectUrl;
      } catch {
        /* 非 JSON 响应，按未完成处理 */
      }
    }

    if (redirectUrl && typeof redirectUrl === "string") {
      logger.info("扫码成功，正在完成登录...");
      await followRedirects(session, redirectUrl);
      return { scanUrl, redirectUrl };
    }

    const castgcNow = session.getCookie(CASTGC_COOKIE, CAS_HOST);
    if (castgcNow && castgcNow !== castgcBefore) {
      logger.info("扫码成功（已下发 CASTGC）");
      return { scanUrl };
    }
  }

  throw new Error("二维码登录超时（二维码已失效），请重试");
}
