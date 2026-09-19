import fs from "node:fs";
import path from "node:path";
import { Session, type CookieStore } from "hustcore";
import { resolveLogger, type Logger, type LoggerInput } from "hustcore";
export * from "./net-errors.ts";
import {
  NetAlreadyOnlineError,
  NetCaptchaRequiredError,
  NetCredentialError,
  NetError,
  NetHttpError,
  NetIpError,
  NetLoginRejectedError,
  NetMacBindingError,
  NetAccountError,
  NetOfflineError,
  NetPortalNotFoundError,
  NetProtocolError,
  NetSessionExpiredError,
  NetSmsAuthRequiredError,
  NetTimeoutError,
  NetTransportError,
  isNetError,
  type NetPhase,
} from "./net-errors.ts";

/**
 * 华中科技大学校园网门户（eportal）认证。
 *
 * 与 CAS（`src/cas.ts`）完全无关：它是一套独立的自签名门户，认证入口是路由器对
 * 未认证终端做的 DNS / HTTP 劫持：
 *
 *   1. 访问任意 http 页面会被插一段 `<script>`，把浏览器跳到
 *      `http://<nas>:8080/eportal/index.jsp?wlanuserip=<enc>&wlanacname=<enc>&...`
 *      其中 query 全部由 NAS 加密下发，**无法自行伪造**，所以必须走劫持。
 *   2. GET index.jsp 会下发 `JSESSIONID`（Path=/eportal）。已有有效 cookie 时不重复下发，
 *      失效时才重新下发——因此本实现对会话做自动刷新。
 *   3. POST `InterFace.do?method=pageInfo`（body：`queryString=<encodeURIComponent(query)>`）
 *      返回公钥指数 / 模数（**运行时动态获取，不硬编码**）以及是否需要验证码 / 短信。
 *   4. POST `InterFace.do?method=login`，密码按 eportal 的 RSA 方案加密后提交。
 *   5. POST `InterFace.do?method=getOnlineUserInfo` 取在线信息；
 *      POST `InterFace.do?method=keepalive` 保活（对应成功页里的 `AuthInterFace.keepalive`）；
 *      POST `InterFace.do?method=logout` 下线。
 *
 * 解耦点：
 *   - `NetTransport`：协议只产出「URL + 表单 + 头部」，字节怎么发由传输层决定。
 *     默认实现走 `Session`（复用全库的分域名 cookie jar 与持久化），
 *     以后要「指定网卡、发某张网卡的 MAC 认证」只需换一个 transport（例如绑 `localAddress`
 *     或走 L2 原始套接字），业务代码不动。
 *   - `NetError` / `NetPhase`：所有失败都带阶段、错误码、可重试标记与原始响应。
 */

const EPORTAL_MARK = "/eportal/";
const EPORTAL_INDEX_PATH = "/eportal/index.jsp";
const EPORTAL_INTERFACE_PATH = "/eportal/InterFace.do";
const EPORTAL_SUCCESS_PATH = "/eportal/success.jsp";
const SESSION_COOKIE = "JSESSIONID";

/** 默认探测地址：未认证时它会被路由器劫持到校园网门户（任意 http 地址均可） */
export const NET_DEFAULT_PROBE_URL = "http://123.123.123.123/";

export interface NetAuthOptions {
  username: string;
  password: string;
  /** 未认证时被劫持的探测 URL，默认 `http://123.123.123.123/`（任意 http 页面均可） */
  probeUrl?: string;
  /** 直接指定门户基址（如 `http://172.18.18.61:8080`），跳过探测；需同时给 `queryString` */
  portal?: string;
  /** 门户加密下发、无法自行签发的原始 query（不含 `?`） */
  queryString?: string;
  /** 套餐 / 服务名，默认空串（由门户自动选择） */
  service?: string;
  /** 单次请求超时（ms），默认 15000 */
  timeoutMs?: number;
  /** 绑定的本机源地址：多网卡场景下用哪张网卡发起认证（决定 NAS 看到的源 IP/MAC） */
  localAddress?: string;
  /** 自定义 Node Agent（例如绑定网卡、指定 TLS 行为） */
  httpAgent?: unknown;
  httpsAgent?: unknown;
  /** 完全替换的传输层（协议与发送解耦的扩展点） */
  transport?: NetTransport;
  logger?: LoggerInput;
}

export interface NetPersistOptions {
  /** 距上次保存超过该时长则视为需要重新认证（不主动续期，交由 ensureOnline） */
  maxAgeMs?: number;
}

/** 探测到的门户上下文：基址 + 加密 query */
export interface NetPortalContext {
  /** `http://172.18.18.61:8080` */
  base: string;
  /** index.jsp 的原始 query（不含 `?`） */
  queryString: string;
  /** 完整 index.jsp URL */
  indexUrl: string;
  /** `InterFace.do` URL */
  interfaceUrl: string;
  /** `success.jsp` URL */
  successUrl: string;
}

/** pageInfo 响应（字段全部可选，运行时以服务端为准） */
export interface NetPageInfo {
  publicKeyExponent?: string;
  publicKeyModulus?: string;
  passwordEncrypt?: string | boolean;
  validCodeUrl?: string;
  isCheckSmsAuth?: string | boolean;
  isCheckMobileRegister?: string | boolean;
  isAutoLogin?: string | boolean;
  [key: string]: unknown;
}

/** login 响应 */
export interface NetLoginResult {
  result?: string;
  message?: string;
  userIndex?: string;
  [key: string]: unknown;
}

/** getOnlineUserInfo 响应（字段为门户原文，全部可选） */
export interface NetUserInfo {
  result?: string;
  message?: string;
  userIndex?: string;
  userName?: string;
  userId?: string;
  userIp?: string;
  userMac?: string;
  accountFee?: string;
  userPackage?: string;
  userGroup?: string;
  maxLeavingTime?: string;
  keepaliveInterval?: string | number | null;
  loginType?: string;
  service?: string;
  realServiceName?: string;
  hasMabInfo?: boolean;
  isAlowMab?: boolean;
  mabInfo?: string;
  [key: string]: unknown;
}

export interface NetStatus {
  /** `true` 在线；`false` 离线；`undefined` 无法判定（探测超时等） */
  online: boolean | undefined;
  /** 在线时的用户信息 */
  userInfo?: NetUserInfo;
  /** 已发现的门户上下文 */
  portal?: NetPortalContext;
  /** 判定依据 / 失败原因 */
  reason?: string;
}

/* -------------------------------- 持久化 -------------------------------- */

const NET_PERSIST_VERSION = 1;

/**
 * 校园网会话持久化。除 cookie 外还保存 `userIndex` 与门户上下文：
 * 已联网时探测不到劫持跳转，必须靠缓存的门户地址才能调 `getOnlineUserInfo`。
 */
interface NetPersistData {
  version: number;
  savedAt: string;
  hosts: CookieStore;
  userIndex?: string;
  portal?: { base: string; queryString: string };
}

function loadNetPersist(file: string): NetPersistData | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as NetPersistData;
    if (!data || typeof data !== "object" || !data.hosts) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

function saveNetPersist(
  file: string,
  data: Omit<NetPersistData, "version" | "savedAt">,
): NetPersistData {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const payload: NetPersistData = {
    version: NET_PERSIST_VERSION,
    savedAt: new Date().toISOString(),
    ...data,
  };
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
  return payload;
}

/* -------------------------------- 传输层 -------------------------------- */

export interface NetTransportRequest {
  url: string;
  method?: "GET" | "POST";
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: "text" | "buffer";
  omitCookies?: boolean;
  timeout?: number;
}

export interface NetTransportResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: T;
}

export interface NetTransport {
  request<T = unknown>(request: NetTransportRequest): Promise<NetTransportResponse<T>>;
}

/**
 * 基于 `Session` 的默认传输层：复用全库统一的分域名 cookie jar 与持久化。
 * `localAddress` / agent 直接透传给 axios，用于多网卡选卡。
 */
export interface SessionTransportDefaults {
  localAddress?: string;
  httpAgent?: unknown;
  httpsAgent?: unknown;
}

export class SessionTransport implements NetTransport {
  private readonly session: Session;
  private readonly defaults: SessionTransportDefaults;

  constructor(session: Session, defaults: SessionTransportDefaults = {}) {
    this.session = session;
    this.defaults = defaults;
  }

  async request<T = unknown>(request: NetTransportRequest): Promise<NetTransportResponse<T>> {
    const response = await this.session.request<T>({
      url: request.url,
      method: request.method ?? "GET",
      data: request.data,
      headers: request.headers,
      responseType: request.responseType === "buffer" ? "arraybuffer" : "text",
      omitCookies: request.omitCookies,
      timeout: request.timeout,
      localAddress: this.defaults.localAddress,
      httpAgent: this.defaults.httpAgent,
      httpsAgent: this.defaults.httpsAgent,
    });
    return {
      status: response.status,
      headers: response.headers as Record<string, string | string[] | undefined>,
      data: response.data,
    };
  }
}

/* -------------------------------- 工具 -------------------------------- */

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return Buffer.from(data === undefined ? "" : JSON.stringify(data));
}

/**
 * 按 Content-Type 声明的 charset 解码；未声明时先按 UTF-8 严格解码，
 * 失败再退回 GB18030（eportal 大量页面是 GBK，门户服务器本身不给 charset）。
 */
export function decodeBody(data: unknown, contentType?: string): string {
  const buffer = toBuffer(data);
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const known = charset === "gbk" || charset === "gb2312" || charset === "gb18030";
  if (known) {
    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      /* 忽略，走下方猜测 */
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }
}

/** 宽松解析 JSON：允许 BOM、前后杂质、JSONP 包裹（取第一个 `{` 到最后一个 `}`） */
export function parseJsonLoose<T>(text: string): T | undefined {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* 尝试下一个 */
    }
  }
  return undefined;
}

function isTruthy(value: unknown): boolean {
  return value === true || value === "true";
}

function snippet(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeStringify(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  try {
    return snippet(typeof data === "string" ? data : JSON.stringify(data));
  } catch {
    return undefined;
  }
}

function formatError(error: unknown): string {
  if (isNetError(error)) return `[${error.phase}/${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------ 密码加密 ------------------------------ */

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * 复刻 `AuthInterFace.js` 中 `RSAUtils.getKeyPair(...).encryptedString(...)` 的
 * chunkSize：`2 * (高位 16-bit digit 下标)`。1024-bit 模数（256 hex）→ 126。
 */
function eportalChunkSize(modulusHex: string): number {
  const trimmed = modulusHex.replace(/^0+/, "") || "0";
  const digits = Math.max(1, Math.ceil(trimmed.length / 4));
  return 2 * (digits - 1);
}

/**
 * 复刻校园网 eportal 的密码加密（来自前端 `AuthInterFace.js` 的 `encryptedPassword()`）：
 *
 * ```js
 * var passwordEncode = password.split("").reverse().join("");
 * var passwordEncry = RSAUtils.encryptedString(key, passwordEncode);
 * ```
 *
 * 即：先反转密码，再按 `chunkSize` 分块做 **无填充（textbook）RSA**——
 * 每块按小端序拼成大整数、模幂、输出 4 位一组零填充的十六进制、逐个拼接。
 *
 * ⚠️ 若门户升级算法（表现为登录永远「用户名或密码错误」），
 *    请对照 `AuthInterFace.js` 更新本函数与 `eportalChunkSize`。
 *    exponent / modulus 已全部来自运行时 pageInfo，无需改动。
 */
export function encryptEportalPassword(
  password: string,
  modulusHex: string,
  exponentHex: string,
): string {
  const chunkSize = eportalChunkSize(modulusHex);
  if (chunkSize <= 0) {
    throw new NetProtocolError({
      phase: "pageInfo",
      message: `门户公钥模数异常（无法计算 chunkSize）：${snippet(modulusHex, 64)}`,
    });
  }

  const reversed = password.split("").reverse();
  const bytes: number[] = reversed.map((char) => char.charCodeAt(0) & 0xff);
  while (bytes.length % chunkSize !== 0) bytes.push(0);

  const modulus = BigInt(`0x${modulusHex}`);
  const exponent = BigInt(`0x${exponentHex}`);

  let result = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let block = 0n;
    for (let i = 0; i < chunkSize; i++) {
      block += BigInt(bytes[offset + i]) << BigInt(8 * i);
    }
    const crypt = modPow(block, exponent, modulus);
    const hex = crypt.toString(16);
    result += hex.padStart(Math.ceil(hex.length / 4) * 4, "0");
  }
  return result;
}

/* ---------------------------- 劫持跳转解析 ---------------------------- */

/**
 * 从被劫持页面里解析出 eportal 跳转 URL。
 * 支持 `location.href = '...'`、`location.replace('...')`、`<meta http-equiv=refresh>`。
 */
export function parseEportalRedirect(html: string, base?: string): string | undefined {
  const patterns = [
    /(?:top\.self\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i,
    /<meta[^>]+http-equiv\s*=\s*['"]?refresh['"]?[^>]*content\s*=\s*['"][^'"]*url=([^'">;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const decoded = candidate
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
    if (!decoded.toLowerCase().includes(EPORTAL_MARK)) continue;
    try {
      return new URL(decoded, base).toString();
    } catch {
      return decoded;
    }
  }
  return undefined;
}

//
// 把服务端「认证失败」的文案归类。门户文案会变，因此都保留原文在 `message` / `raw` 里。
//
export function classifyLoginFailure(
  message: string,
  raw?: unknown,
  responseBody?: string,
): NetError {
  const base = {
    phase: "login" as const,
    message: message || "登录失败（门户未提供原因）",
    raw,
    responseBody,
  };
  if (/验证码|校验码/.test(message)) return new NetCaptchaRequiredError(base);
  if (/短信|动态码|SMS/i.test(message)) return new NetSmsAuthRequiredError(base);
  if (/已经?在线|已登录|已登陆|在线用户|终端已/.test(message)) return new NetAlreadyOnlineError(base);
  if (/绑定|mac|终端数|设备数/i.test(message)) return new NetMacBindingError(base);
  if (/欠费|余额|套餐|到期|缴费|费用|冻结|停机/.test(message)) return new NetAccountError(base);
  if (/\bip\b|地址|网段|范围/i.test(message)) return new NetIpError(base);
  if (/密码|用户名|账号|用户不存在|认证失败|登录失败|用户名或密码/.test(message)) {
    return new NetCredentialError(base);
  }
  return new NetLoginRejectedError(base);
}

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UNKNOWN",
]);

const FRIENDLY_CODES: Record<string, string> = {
  ENOTFOUND: "DNS 解析失败",
  EAI_AGAIN: "DNS 暂时失败",
  ECONNREFUSED: "连接被拒绝",
  ECONNRESET: "连接被重置",
  ETIMEDOUT: "连接超时",
  ECONNABORTED: "连接中断",
  EHOSTUNREACH: "主机不可达",
  ENETUNREACH: "网络不可达",
  EPIPE: "管道断开",
  ERR_INVALID_URL: "URL 无效",
  ERR_FR_TOO_MANY_REDIRECTS: "重定向次数过多",
};

function mapRequestError(phase: NetPhase, error: unknown): NetError {
  if (isNetError(error)) return error;
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: unknown };
  };

  if (err?.response && typeof err.response.status === "number") {
    return new NetHttpError({
      phase,
      httpStatus: err.response.status,
      message: `HTTP ${err.response.status}（${phase}）`,
      retryable: err.response.status >= 500 || err.response.status === 429,
      cause: error,
      raw: err.response.data,
      responseBody: safeStringify(err.response.data),
    });
  }

  const code = err?.code ?? "UNKNOWN";
  const detail = err?.message ?? String(error);
  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || /timeout/i.test(detail)) {
    return new NetTimeoutError({
      phase,
      message: `请求超时（${phase}）：${detail}`,
      cause: error,
      retryable: true,
    });
  }
  return new NetTransportError({
    phase,
    code,
    message: `${FRIENDLY_CODES[code] ?? "网络传输失败"}（${phase}）：${detail}`,
    retryable: RETRYABLE_CODES.has(code),
    cause: error,
  });
}

/* ------------------------------- 客户端 ------------------------------- */

export interface NetTransportHint {
  /** 探测到的门户绝对地址（不含 query） */
  base: string;
  query: string;
}

/**
 * 探测结果：
 * - `portal`：被劫持，拿到门户地址（离线）；
 * - `status`：拿到正常 HTTP 响应，未被劫持（在线）；
 * - `transportError`：连接被重置 / 超时等，通常表示未被劫持（已在线）。
 */
export interface NetProbeOutcome {
  portal?: NetTransportHint;
  status?: number;
  transportError?: NetError;
}

/**
 * 这些传输错误在探测阶段视为「未被劫持」而非「网络故障」：
 * 已联网访问 `123.123.123.123` 时，真实目的主机常直接 RST，表现为
 * ECONNRESET / socket hang up / EPIPE，而不是门户劫持。
 */
const NON_HIJACK_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

export class NetClient {
  readonly options: NetAuthOptions;
  readonly session: Session;
  readonly transport: NetTransport;

  private logger: Logger;
  private portalContext?: NetPortalContext;
  private pageInfoValue?: NetPageInfo;
  private userIndexValue?: string;
  private persistPath?: string;
  private persistMaxAgeMs?: number;
  private persistedAtValue?: string;
  private needsRefresh = false;
  /**
   * 当前门户上下文是否来自本进程的实时探测。
   * `false` 表示它是从持久化会话恢复（或由 `options.portal` 指定）的缓存值，
   * 因此可能在网络切换 / 门户变更后失效。
   */
  private portalFresh = false;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(options: NetAuthOptions) {
    if (!options.username) throw new Error("hustnet: 缺少 username");
    if (!options.password) throw new Error("hustnet: 缺少 password");
    this.options = { timeoutMs: 15000, ...options };
    this.logger = resolveLogger(options.logger);
    this.session = new Session();
    this.transport =
      options.transport ??
      new SessionTransport(this.session, {
        localAddress: options.localAddress,
        httpAgent: options.httpAgent,
        httpsAgent: options.httpsAgent,
      });
  }

  /* ------------------------------ 链式配置 ------------------------------ */

  withLogger(logger: LoggerInput): this {
    this.logger = resolveLogger(logger);
    return this;
  }

  /** 恢复 / 保存 JSESSIONID 等 cookie，跨进程复用门户会话 */
  persistent(file: string, options: NetPersistOptions = {}): this {
    this.persistPath = file;
    this.persistMaxAgeMs = options.maxAgeMs;
    const data = loadNetPersist(file);
    if (data) {
      this.session.importCookies(data.hosts);
      if (data.userIndex) this.userIndexValue = data.userIndex;
      if (data.portal) this.portalContext = this.buildContext(data.portal.base, data.portal.queryString);
      this.persistedAtValue = data.savedAt;
      const age = Date.now() - Date.parse(data.savedAt);
      if (Number.isFinite(age) && age > 0) {
        this.logger.info(`已从 ${file} 恢复校园网会话 (savedAt=${data.savedAt})`);
      }
      if (
        this.persistMaxAgeMs !== undefined &&
        Number.isFinite(age) &&
        age > this.persistMaxAgeMs
      ) {
        this.needsRefresh = true;
        this.logger.info(
          `校园网持久化会话已 ${Math.round(age / 1000)}s（超过 maxAgeMs），下次将主动重新认证`,
        );
      }
    }
    this.session.setOnUpdate(() => this.scheduleSave());
    return this;
  }

  /* -------------------------------- 只读 -------------------------------- */

  get portal(): NetPortalContext | undefined {
    return this.portalContext;
  }

  get pageInfo(): NetPageInfo | undefined {
    return this.pageInfoValue;
  }

  get userIndex(): string | undefined {
    return this.userIndexValue;
  }

  get sessionId(): string | undefined {
    const target = this.portalContext?.indexUrl ?? this.options.probeUrl ?? NET_DEFAULT_PROBE_URL;
    return this.session.getCookie(SESSION_COOKIE, target);
  }

  get persistedAt(): string | undefined {
    return this.persistedAtValue;
  }

  cookies(): Record<string, string> {
    return this.session.allCookies(this.portalContext?.indexUrl);
  }

  /* ------------------------------ 门户发现 ------------------------------ */

  /** 探测劫持跳转并建立门户上下文；已发现则直接复用（`force` 可强制重探） */
  async discover(force = false): Promise<NetPortalContext> {
    if (this.portalContext && !force) return this.portalContext;

    if (this.options.portal) {
      const query = this.options.queryString ?? this.portalContext?.queryString;
      if (!query) {
        throw new NetProtocolError({
          phase: "probe",
          code: "NO_QUERY_STRING",
          message:
            "已指定 portal，但缺少 queryString——该参数由门户加密下发、无法自行签发；请省略 portal 走自动探测",
        });
      }
      this.portalContext = this.buildContext(this.options.portal, query);
      this.portalFresh = false;
      return this.portalContext;
    }

    const probeUrl = this.options.probeUrl ?? NET_DEFAULT_PROBE_URL;
    this.logger.info(`探测校园网门户：${probeUrl}`);
    const outcome = await this.probe(probeUrl);
    if (!outcome.portal) {
      const detail = outcome.transportError
        ? `（${outcome.transportError.code}: ${outcome.transportError.message}）`
        : outcome.status !== undefined
          ? `（HTTP ${outcome.status}，无劫持）`
          : "";
      throw new NetPortalNotFoundError({
        phase: "probe",
        message:
          `未在 ${probeUrl} 探测到校园网门户劫持跳转${detail}。` +
          "已联网时属正常（无需认证）；若未联网请检查网络或更换探测地址",
        cause: outcome.transportError?.cause,
        raw: outcome.transportError ?? { status: outcome.status },
      });
    }
    this.portalContext = this.buildContext(outcome.portal.base, outcome.portal.query);
    this.portalFresh = true;
    this.logger.info(`发现校园网门户：${this.portalContext.base}`);
    return this.portalContext;
  }

  private buildContext(base: string, queryString: string): NetPortalContext {
    const cleanBase = base.replace(/\/+$/, "");
    const query = queryString.replace(/^\?/, "");
    return {
      base: cleanBase,
      queryString: query,
      indexUrl: `${cleanBase}${EPORTAL_INDEX_PATH}?${query}`,
      interfaceUrl: `${cleanBase}${EPORTAL_INTERFACE_PATH}`,
      successUrl: `${cleanBase}${EPORTAL_SUCCESS_PATH}`,
    };
  }

  /* ------------------------------ 失效自愈 ------------------------------ */

  /** 传输层可重试错误 / 会话失效——都可能意味「缓存的门户上下文过期」。 */
  private isRetryablePortalError(error: unknown): boolean {
    return (
      (error instanceof NetTransportError && error.retryable) ||
      error instanceof NetSessionExpiredError
    );
  }

  /**
   * 缓存的门户上下文可能已过期（典型：从有线切到无线，门户从 `.61` 变成 `.60`）。
   * 首次请求因传输错误 / 会话失效失败后：作废缓存 → 重新探测 → 重试一次。
   *
   * 若重新探测也失败（通常意味着当前已在线、不再有劫持），则恢复旧上下文重试一次，
   * 避免把「网络抖动」误判成「门户变更」。
   *
   * 显式 `options.portal` 指定的门户不自动作废（用户已固定）。
   */
  private async withPortalRetry<T>(phase: NetPhase, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!this.isRetryablePortalError(error) || this.options.portal) throw error;

      const previous = this.portalContext;
      this.logger.warn(`门户请求失败（${phase}: ${formatError(error)}），重新探测门户…`);
      this.portalContext = undefined;
      try {
        await this.discover(true);
        this.logger.info(`已切换到门户：${this.portal?.base ?? "(未知)"}`);
      } catch (probeError) {
        this.portalContext = previous;
        this.logger.warn(`重新探测门户失败（${formatError(probeError)}），沿用缓存门户重试一次`);
      }
      return await run();
    }
  }

  private async probe(probeUrl: string): Promise<NetProbeOutcome> {
    let response: NetTransportResponse<Buffer>;
    try {
      response = await this.send(
        {
          url: probeUrl,
          method: "GET",
          responseType: "buffer",
          omitCookies: true,
        },
        "probe",
      );
    } catch (error) {
      const transportError = isNetError(error) ? error : mapRequestError("probe", error);
      if (NON_HIJACK_CODES.has(transportError.code)) {
        this.logger.warn(
          `探测 ${probeUrl} 连接被重置（${transportError.code}），按「未被劫持 / 已在线」处理`,
        );
      } else {
        this.logger.warn(`探测 ${probeUrl} 失败（${transportError.code}）：${transportError.message}`);
      }
      return { transportError };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = firstHeader(response.headers, "location");
      if (location?.toLowerCase().includes(EPORTAL_MARK)) {
        return { portal: this.hintFrom(location, probeUrl), status: response.status };
      }
    }

    const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
    const target = parseEportalRedirect(text, probeUrl);
    if (target) return { portal: this.hintFrom(target, probeUrl), status: response.status };
    return { status: response.status };
  }

  private hintFrom(target: string, baseUrl: string): NetTransportHint {
    let url: URL;
    try {
      url = new URL(target, baseUrl);
    } catch {
      try {
        url = new URL(target);
      } catch {
        throw new NetProtocolError({
          phase: "probe",
          code: "BAD_REDIRECT",
          message: `门户跳转地址无法解析：${snippet(target, 120)}`,
          responseBody: snippet(target, 400),
        });
      }
    }
    const query = url.search.replace(/^\?/, "");
    if (!query) {
      throw new NetProtocolError({
        phase: "probe",
        code: "NO_QUERY_STRING",
        message: "门户跳转 URL 缺少 query string，无法继续认证",
        responseBody: snippet(target, 400),
      });
    }
    return { base: `${url.protocol}//${url.host}`, query };
  }

  /* ------------------------------ 会话刷新 ------------------------------ */

  /**
   * GET index.jsp。已有的有效 JSESSIONID 会随请求带上（服务端不会重发）；
   * 失效时服务端会重新 `Set-Cookie`，由 `Session` 自动吸收。
   */
  async openIndex(force = false): Promise<void> {
    const context = await this.discover(force);
    const before = this.session.getCookie(SESSION_COOKIE, context.indexUrl);
    const response = await this.send(
      {
        url: context.indexUrl,
        method: "GET",
        responseType: "buffer",
        headers: { Referer: this.options.probeUrl ?? NET_DEFAULT_PROBE_URL },
      },
      "session",
    );
    if (response.status >= 400) {
      throw new NetHttpError({
        phase: "session",
        httpStatus: response.status,
        message: `获取门户首页失败：HTTP ${response.status}`,
        responseBody: snippet(
          decodeBody(response.data, firstHeader(response.headers, "content-type")),
        ),
      });
    }
    const after = this.session.getCookie(SESSION_COOKIE, context.indexUrl);
    if (!after) {
      throw new NetSessionExpiredError({
        phase: "session",
        message: "门户未下发 JSESSIONID（可能被 WAF / 认证规则拦截）",
        responseBody: snippet(
          decodeBody(response.data, firstHeader(response.headers, "content-type")),
        ),
      });
    }
    if (force || after !== before) this.logger.debug(`门户 JSESSIONID 就绪：${after.slice(0, 8)}…`);
  }

  async fetchPageInfo(): Promise<NetPageInfo> {
    const context = await this.discover();
    const response = await this.send(
      {
        url: `${context.interfaceUrl}?method=pageInfo`,
        method: "POST",
        data: new URLSearchParams({ queryString: context.queryString }),
        responseType: "buffer",
        headers: {
          Accept: "*/*",
          Origin: context.base,
          Referer: context.indexUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
      "pageInfo",
    );
    const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
    if (response.status >= 400) {
      throw new NetHttpError({
        phase: "pageInfo",
        httpStatus: response.status,
        message: `获取门户配置失败：HTTP ${response.status}`,
        responseBody: snippet(text),
      });
    }
    const pageInfo = parseJsonLoose<NetPageInfo>(text);
    if (!pageInfo) {
      throw new NetProtocolError({
        phase: "pageInfo",
        message: "pageInfo 返回不是 JSON（门户可能改版或被重定向回登录页）",
        responseBody: snippet(text),
      });
    }
    this.pageInfoValue = pageInfo;
    return pageInfo;
  }

  /* -------------------------------- 登录 -------------------------------- */

  /** 完整登录：发现门户 → 刷新会话 → 取公钥 → 加密 → 提交。 */
  async login(): Promise<NetLoginResult> {
    try {
      return await this.withPortalRetry("login", () => this.loginOnce());
    } catch (error) {
      // 缓存的门户上下文（queryString / JSESSIONID）失效时，门户往往回一句
      // 「认证失败」而不是传输层错误；此时自动清空缓存并重新探测门户后
      // 干净地重试一次，无需用户手动删除会话文件。
      if (!this.shouldRetryWithCleanSession(error)) throw error;
      this.logger.warn(
        `登录被拒（${formatError(error)}），缓存的门户会话可能已失效；` +
          "清除缓存并重新探测门户后重试…",
      );
      this.resetCachedPortal();
      try {
        return await this.loginOnce();
      } catch (retryError) {
        // 重新探测门户也失败（例如当前已在线、不再有劫持）时，
        // 原始错误更能说明问题，保留它。
        if (retryError instanceof NetPortalNotFoundError) throw error;
        throw retryError;
      }
    }
  }

  /**
   * 登录被拒是否值得「清缓存重来」：
   * 仅当当前门户上下文是持久化缓存（非本进程实时探测、也非用户显式指定），
   * 且错误属于认证被拒类时成立。这样真正的密码错误在首次运行时不会被重复尝试。
   */
  private shouldRetryWithCleanSession(error: unknown): boolean {
    if (this.options.portal) return false;
    if (this.portalFresh) return false;
    return (
      error instanceof NetCredentialError ||
      error instanceof NetLoginRejectedError ||
      error instanceof NetSessionExpiredError
    );
  }

  /** 丢弃缓存的门户上下文 / JSESSIONID / userIndex，使其在下次使用时重新探测。 */
  private resetCachedPortal(): void {
    const base = this.portalContext?.base;
    if (base) this.session.deleteCookie(SESSION_COOKIE, base);
    this.portalContext = undefined;
    this.pageInfoValue = undefined;
    this.userIndexValue = undefined;
    this.portalFresh = false;
  }

  /** 单次登录（不做门户切换重试）。 */
  private async loginOnce(): Promise<NetLoginResult> {
    const context = await this.discover();
    await this.openIndex();
    const pageInfo = await this.fetchPageInfo();
    this.assertNoHumanChallenge(pageInfo);

    const passwordEncrypt = isTruthy(pageInfo.passwordEncrypt ?? "true");
    let password: string;
    if (passwordEncrypt) {
      if (!pageInfo.publicKeyModulus || !pageInfo.publicKeyExponent) {
        throw new NetProtocolError({
          phase: "pageInfo",
          message: "门户声明需要加密登录，但未返回 publicKeyModulus / publicKeyExponent",
          raw: pageInfo,
        });
      }
      password = encryptEportalPassword(
        this.options.password,
        pageInfo.publicKeyModulus,
        pageInfo.publicKeyExponent,
      );
    } else {
      password = this.options.password;
    }

    const form = new URLSearchParams({
      userId: this.options.username,
      password,
      service: this.options.service ?? "",
      queryString: context.queryString,
      operatorPwd: "",
      operatorUserId: "",
      validcode: "",
      passwordEncrypt: String(pageInfo.passwordEncrypt ?? "true"),
    });

    const result = await this.postLogin(context, form);
    if (result.result !== "success") {
      throw classifyLoginFailure(
        String(result.message ?? ""),
        result,
        JSON.stringify(result).slice(0, 400),
      );
    }

    if (result.userIndex) this.userIndexValue = String(result.userIndex);
    this.logger.info(
      `校园网登录成功${this.userIndexValue ? `（userIndex=${this.userIndexValue.slice(0, 12)}…）` : ""}`,
    );
    this.save();

    await this.keepAlive().catch((error) => {
      this.logger.warn(`登录后保活失败（不影响登录结果）：${formatError(error)}`);
    });
    return result;
  }

  private async postLogin(
    context: NetPortalContext,
    form: URLSearchParams,
  ): Promise<NetLoginResult> {
    const request: NetTransportRequest = {
      url: `${context.interfaceUrl}?method=login`,
      method: "POST",
      data: form,
      responseType: "buffer",
      headers: {
        Accept: "*/*",
        Origin: context.base,
        Referer: context.indexUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
    };

    let response = await this.send(request, "login");
    let text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
    let result = parseJsonLoose<NetLoginResult>(text);

    if (this.looksLikeSessionExpired(response.status, text, result)) {
      this.logger.warn("门户会话可能已失效，刷新 JSESSIONID 后重试登录");
      await this.openIndex(true);
      if (this.portalContext && this.portalContext !== context) {
        request.url = `${this.portalContext.interfaceUrl}?method=login`;
        request.headers = { ...request.headers, Origin: this.portalContext.base };
      }
      response = await this.send(request, "login");
      text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
      result = parseJsonLoose<NetLoginResult>(text);
    }

    if (response.status >= 400) {
      throw new NetHttpError({
        phase: "login",
        httpStatus: response.status,
        message: `提交登录失败：HTTP ${response.status}`,
        responseBody: snippet(text),
      });
    }
    if (!result) {
      throw new NetProtocolError({
        phase: "login",
        message: "登录响应不是 JSON（可能被重定向回登录页或门户改版）",
        responseBody: snippet(text),
      });
    }
    return result;
  }

  private looksLikeSessionExpired(
    status: number,
    text: string,
    result: NetLoginResult | undefined,
  ): boolean {
    if (status >= 300 && status < 400) return true;
    if (result && (result.result === "success" || result.message)) return false;
    return /<html|eportal\/index\.jsp|login|请重新登录/i.test(text);
  }

  private assertNoHumanChallenge(pageInfo: NetPageInfo): void {
    if (pageInfo.validCodeUrl && String(pageInfo.validCodeUrl).length > 0) {
      throw new NetCaptchaRequiredError({
        phase: "pageInfo",
        message: "门户要求输入验证码（validCodeUrl 非空），当前版本未内置验证码识别",
        raw: pageInfo,
      });
    }
    if (isTruthy(pageInfo.isCheckSmsAuth)) {
      throw new NetSmsAuthRequiredError({
        phase: "pageInfo",
        message: "门户要求短信二次验证，当前版本无法自动完成",
        raw: pageInfo,
      });
    }
  }

  /* ------------------------------ 在线信息 ------------------------------ */

  /** 取当前在线用户信息；未登录时门户返回 fail，这里抛 `NetOfflineError`。 */
  async getOnlineUserInfo(userIndex?: string): Promise<NetUserInfo> {
    return this.withPortalRetry("userInfo", () => this.getOnlineUserInfoOnce(userIndex));
  }

  /** 单次取在线信息（不做门户切换重试）。 */
  private async getOnlineUserInfoOnce(userIndex?: string): Promise<NetUserInfo> {
    const context = await this.discover();
    const index = userIndex ?? this.userIndexValue ?? "";
    const response = await this.send(
      {
        url: `${context.interfaceUrl}?method=getOnlineUserInfo`,
        method: "POST",
        data: new URLSearchParams({ userIndex: index }),
        responseType: "buffer",
        headers: {
          Accept: "*/*",
          Origin: context.base,
          Referer: context.indexUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
      "userInfo",
    );
    const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
    if (response.status >= 400) {
      throw new NetHttpError({
        phase: "userInfo",
        httpStatus: response.status,
        message: `获取在线信息失败：HTTP ${response.status}`,
        responseBody: snippet(text),
      });
    }
    const info = parseJsonLoose<NetUserInfo>(text);
    if (!info) {
      throw new NetProtocolError({
        phase: "userInfo",
        message: "getOnlineUserInfo 返回不是 JSON",
        responseBody: snippet(text),
      });
    }
    if (info.result !== "success") {
      const message = String(info.message ?? "获取用户信息失败");
      // 门户在「刚登录 / 数据仍在同步」时会返回 result:"wait" +「用户信息不完整，请稍后重试」，
      // 但 userIndex/userName/userIp/userMac/accountFee 等字段其实已经带齐。
      // 只要有用户数据就以它为准（否则会把完整信息误判成 PROTOCOL / OFFLINE）。
      const hasUserData = Boolean(
        info.userIndex || info.userId || info.userIp || info.userMac,
      );
      if (hasUserData) {
        this.logger.warn(
          `门户返回 result=${String(info.result)}（${message}），但响应已带用户信息` +
            `（${info.userId ?? info.userIp ?? "-"}），按在线处理`,
        );
      } else if (/下线|未登录|不在线|获取用户信息失败|用户不存在/.test(message)) {
        throw new NetOfflineError({ phase: "userInfo", message, raw: info, responseBody: snippet(text) });
      } else {
        throw new NetProtocolError({
          phase: "userInfo",
          message,
          raw: info,
          responseBody: snippet(text),
        });
      }
    }
    if (info.userIndex) this.userIndexValue = String(info.userIndex);
    this.save();
    return info;
  }

  /* -------------------------------- 保活 -------------------------------- */

  /**
   * 保活：POST `InterFace.do?method=keepalive` + `userIndex=`。
   *
   * 对应登录成功页里 `AuthInterFace.keepalive(userIndex)` 的调用
   * （页面仅在 `keepaliveInterval>0` 时按「分钟」轮询该接口）；
   * `success.jsp` 本身只是约 90KB 的登录成功页，不是心跳。
   */
  async keepAlive(): Promise<string> {
    return this.withPortalRetry("keepalive", () => this.keepAliveOnce());
  }

  /** 单次保活（不做门户切换重试）。 */
  private async keepAliveOnce(): Promise<string> {
    if (!this.userIndexValue) {
      throw new NetError({
        phase: "keepalive",
        code: "NO_USER_INDEX",
        message: "尚未登录（缺少 userIndex），无法保活",
      });
    }
    const context = await this.discover();
    const response = await this.send(
      {
        url: `${context.interfaceUrl}?method=keepalive`,
        method: "POST",
        data: new URLSearchParams({ userIndex: this.userIndexValue }),
        responseType: "buffer",
        headers: {
          Accept: "*/*",
          Origin: context.base,
          Referer: context.successUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
      "keepalive",
    );
    const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
    if (response.status >= 400) {
      throw new NetHttpError({
        phase: "keepalive",
        httpStatus: response.status,
        message: `保活失败：HTTP ${response.status}`,
        responseBody: snippet(text),
      });
    }
    const result = parseJsonLoose<{ result?: string; message?: string }>(text);
    if (result?.result === "success" || /success/i.test(text)) return text;
    this.userIndexValue = undefined;
    throw new NetOfflineError({
      phase: "keepalive",
      message: String(result?.message ?? "保活未返回 success，判定已离线"),
      raw: result,
      responseBody: snippet(text),
    });
  }

  /**
   * 周期性保活；默认 60s，句柄已 `unref`，不阻塞进程退出。
   * 门户的 `keepaliveInterval` 单位是分钟，若要严格对齐可自行传入。
   */
  startKeepAlive(intervalMs = 60_000): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      this.keepAlive().catch((error) => {
        this.logger.warn(`校园网保活失败：${formatError(error)}`);
      });
    }, intervalMs);
    (this.keepAliveTimer as { unref?: () => void }).unref?.();
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /* -------------------------------- 状态 -------------------------------- */

  /** 综合判断在线状态：有 userIndex 直接查在线信息，否则探测劫持跳转。 */
  async status(): Promise<NetStatus> {
    if (this.userIndexValue) {
      try {
        const userInfo = await this.getOnlineUserInfo();
        return { online: true, userInfo, portal: this.portalContext };
      } catch (error) {
        const reason = formatError(error);
        if (error instanceof NetOfflineError) {
          return { online: false, portal: this.portalContext, reason };
        }
        if (error instanceof NetTransportError) {
          return { online: undefined, portal: this.portalContext, reason };
        }
        return { online: false, portal: this.portalContext, reason };
      }
    }

    const probeUrl = this.options.probeUrl ?? NET_DEFAULT_PROBE_URL;
    const outcome = await this.probe(probeUrl);
    if (outcome.portal) {
      this.portalContext = this.buildContext(outcome.portal.base, outcome.portal.query);
      this.portalFresh = true;
      return { online: false, portal: this.portalContext, reason: "探测到门户劫持跳转" };
    }
    if (!outcome.transportError) {
      return {
        online: true,
        portal: this.portalContext,
        reason: `未探测到劫持跳转（HTTP ${outcome.status ?? "?"}），判定已在线`,
      };
    }
    if (NON_HIJACK_CODES.has(outcome.transportError.code)) {
      return {
        online: true,
        portal: this.portalContext,
        reason: `探测连接被重置（${outcome.transportError.code}），未被劫持，判定已在线`,
      };
    }
    return { online: undefined, portal: this.portalContext, reason: formatError(outcome.transportError) };
  }

  /**
   * 获取本人校园网信息（对外主 API）：
   * 已在线直接返回；未认证则自动完成登录后再取一次。
   */
  async getMyInfo(): Promise<NetUserInfo> {
    return this.ensureOnline();
  }

  /** 保证在线：已在线直接返回用户信息；否则登录后再取一次。 */
  async ensureOnline(): Promise<NetUserInfo> {
    const status = await this.status();
    if (!this.needsRefresh && status.online && status.userInfo) return status.userInfo;

    // 已在线但拿不到信息（例如首次在已联网环境里运行，探测未被劫持）：
    // 没有 userIndex 时只能借助缓存的门户上下文补取，否则给出明确指引。
    if (status.online === true && !status.userInfo) {
      if (this.portalContext) {
        try {
          return await this.getOnlineUserInfo();
        } catch {
          /* 继续尝试登录 */
        }
      }
      if (!this.needsRefresh) {
        throw new NetError({
          phase: "userInfo",
          code: "NO_USER_CONTEXT",
          message:
            "当前网络已在线（未被门户劫持），但缺少门户上下文 / userIndex，无法读取账号信息；" +
            "请先断开认证（或未联网时）运行一次以缓存会话",
          raw: status,
        });
      }
    }

    if (status.online === undefined) {
      this.logger.warn(`在线状态无法判定（${status.reason ?? "未知"}），尝试登录`);
    }
    this.needsRefresh = false;
    try {
      const login = await this.login();
      const fallback = login as unknown as NetUserInfo;
      try {
        return await this.getOnlineUserInfo();
      } catch {
        return fallback;
      }
    } catch (error) {
      if (error instanceof NetAlreadyOnlineError) {
        this.logger.info("门户提示终端已在线，直接读取在线信息");
        return await this.getOnlineUserInfo();
      }
      if (status.online === true && this.portalContext) {
        try {
          return await this.getOnlineUserInfo();
        } catch {
          /* 抛出原始错误 */
        }
      }
      throw error;
    }
  }

  /* -------------------------------- 登出 -------------------------------- */

  /**
   * 下线。服务端接口按标准 eportal 推断为 `method=logout` + `userIndex=`
   * （你若有抓包请发我核对）。
   *
   * best-effort：即使服务端请求失败（离线 / 已失效 / 门户不认），
   * 也会清除本地 cookie 与 userIndex，并停止保活。
   */
  async logout(): Promise<void> {
    try {
      await this.withPortalRetry("logout", async () => {
        const context = await this.discover();
        if (this.userIndexValue) {
          const response = await this.send(
            {
              url: `${context.interfaceUrl}?method=logout`,
              method: "POST",
              data: new URLSearchParams({ userIndex: this.userIndexValue }),
              responseType: "buffer",
              headers: {
                Accept: "*/*",
                Origin: context.base,
                Referer: context.indexUrl,
                "X-Requested-With": "XMLHttpRequest",
              },
            },
            "logout",
          );
          const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
          const result = parseJsonLoose<{ result?: string; message?: string }>(text);
          if (response.status >= 400) {
            this.logger.warn(`门户登出返回 HTTP ${response.status}，仍按本地登出处理`);
          } else if (result?.result && result.result !== "success") {
            this.logger.warn(`门户登出被拒绝：${result.message ?? "未知原因"}`);
          }
        }
        this.session.deleteCookie(SESSION_COOKIE, context.base);
      });
    } catch (error) {
      this.logger.warn(`登出请求失败（本地会话仍会清除）：${formatError(error)}`);
    } finally {
      this.stopKeepAlive();
      this.userIndexValue = undefined;
      this.save();
    }
  }

  /* ------------------------------ 内部能力 ------------------------------ */

  private async send(
    request: NetTransportRequest,
    phase: NetPhase,
  ): Promise<NetTransportResponse<Buffer>> {
    try {
      return await this.transport.request<Buffer>({
        timeout: this.options.timeoutMs,
        ...request,
      });
    } catch (error) {
      throw mapRequestError(phase, error);
    }
  }

  private scheduleSave(): void {
    if (!this.persistPath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 50);
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      const data = saveNetPersist(this.persistPath, {
        hosts: this.session.exportCookies(),
        userIndex: this.userIndexValue,
        portal: this.portalContext
          ? { base: this.portalContext.base, queryString: this.portalContext.queryString }
          : undefined,
      });
      this.persistedAtValue = data.savedAt;
    } catch (error) {
      this.logger.warn(`校园网会话持久化失败：${formatError(error)}`);
    }
  }
}

/** 创建校园网认证客户端。 */
export function auth(options: NetAuthOptions): NetClient {
  return new NetClient(options);
}

const hustnet = { auth };
export default hustnet;
