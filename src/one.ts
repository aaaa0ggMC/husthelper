import type { AxiosResponse } from "axios";
import {
  CAS_HOST,
  CAS_ORIGIN,
  isCasLoginResponse,
  performCasLogin,
  requestCasTicket,
  type CasService,
  type LoginContextProvider,
} from "./cas.ts";
import { Session, type RequestOptions } from "./http.ts";
import { defaultLogger, type Logger } from "./logger.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * one.hust.edu.cn（数智华中大）的 OIDC 委托认证。
 *
 * 它不属于普通的 CAS 应用：登录入口本身的 `service` 就是 CAS 的 OAuth2 authorize
 * 端点，整条链路是「CAS ticket → authorize → CAS 会话 → callbackAuthorize →
 * one.hust/cas.html?code=... → casToken 换 JWT」。最终拿到的是 one.hust 自己的
 * bearer token（OIDC JWT，有效期约一天）。
 *
 * 各步（括号内为响应）：
 * 1. GET /cas/login?service=<authorize>            → 302 authorize?ticket=ST1（CASTGC 免密，或完整登录）
 * 2. GET authorize?ticket=ST1                       → 302 /cas/login?service=callbackAuthorize（Set-Cookie JSESSIONID）
 * 3. GET /cas/login?service=callbackAuthorize       → 302 callbackAuthorize?ticket=ST2
 * 4. GET callbackAuthorize?ticket=ST2               → 302 one.hust/cas.html?service=...&code=ST2
 * 5. GET one.hust/cas.html?...&code=ST2             → 200 HTML（读 defaults/js/constant.js 拿 contextpathAuthc）
 * 6. GET <authc>/oauth2/casToken/<code>/<clientId>  → 200 { code, data: { accessToken } }
 */

export const ONE_HOST = "one.hust.edu.cn";
export const ONE_BASE = `https://${ONE_HOST}`;
export const ONE_CLIENT_ID = "nup";
export const ONE_ACCESS_TOKEN_COOKIE = "accessToken";
export const ONE_AUTHORIZE = `${CAS_ORIGIN}/cas/oauth2.0/authorize`;
export const ONE_CALLBACK_AUTHORIZE = `${CAS_ORIGIN}/cas/oauth2.0/callbackAuthorize`;

/** 默认目标应用（hash 中的 act），可在 options 里覆盖 */
const DEFAULT_ACT = "sems-tp-nup_29827717";
const MAX_HOPS = 10;

/** 门户服务前缀（constant.js 里的 contextpath） */
export const ONE_PORTAL_BASE = "https://one.hust.edu.cn/apim/sems-tp-nup";

/** 门户接口的响应包装形式 */
export type PortalEnvelope = "wrapped" | "raw";

/** 一个门户接口的声明（schema） */
export interface PortalEndpoint {
  readonly path: string;
  /** 默认 POST */
  readonly method?: "POST" | "GET";
  /** `wrapped`（默认，解包 `{code,msg,data}` 的 `data`）或 `raw`（裸对象，仅 code!=200 抛错） */
  readonly envelope?: PortalEnvelope;
  /** 是否带 `{ total, list, hasNextPage, ... }` 分页结构 */
  readonly page?: boolean;
  /** 请求体默认字段，可被调用方覆盖 */
  readonly defaults?: Record<string, unknown>;
}

/**
 * one.hust 门户接口注册表。
 * 新增接口只需加一行，然后用 `client.one.portal.call/page/iterate` 调用，
 * 或按需加一个一行薄封装（见下方 `getBalance` 等）。
 */
export const ONE_ENDPOINTS = {
  noticePage: {
    path: `${ONE_PORTAL_BASE}/card/campusInformation/getCampusPimPageInfo`,
    page: true,
    defaults: { pageNum: 1, pageSize: 10 },
  },
  documentPage: {
    path: `${ONE_PORTAL_BASE}/card/campusDocument/getCampusDocumentPage`,
    page: true,
    defaults: { pageNum: 1, pageSize: 10 },
  },
  weekActivity: {
    path: `${ONE_PORTAL_BASE}/up/calendar/getWeekActivity`,
    defaults: { activityType: "2", is_calendar_manager: "false", cal_tab: "" },
  },
  learnWeek: {
    path: `${ONE_PORTAL_BASE}/hust-calendar/getLearnweekbyDate`,
    envelope: "raw",
  },
  emailInfo: { path: `${ONE_PORTAL_BASE}/card/emailHust/getEmailInfo` },
  balance: { path: `${ONE_PORTAL_BASE}/card/balance/getHustPersonBalance` },
  myInfo: { path: `${ONE_PORTAL_BASE}/infoData/getMyInfo` },
} satisfies Record<string, PortalEndpoint>;

export type OneEndpointName = keyof typeof ONE_ENDPOINTS;

/** one.hust 接口使用的日期格式：`yyyy-MM-dd HH:mm:ss`（北京时间） */
export function formatBeijingDate(value: Date | number): string {
  const date = typeof value === "number" ? new Date(value) : value;
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

export interface OneHustOptions {
  clientId?: string;
  /** one.hust 侧目标地址（含 #act=...），默认 sems-tp-nup */
  service?: string;
  /** 直接覆盖 redirect_uri（一般无需设置） */
  redirectUri?: string;
  /** 覆盖默认 act（拼 service 用） */
  act?: string;
}

export interface OneToken {
  accessToken: string;
  /** JWT `exp` 对应的毫秒时间戳；无法解析时为 undefined */
  expiresAt?: number;
  raw: unknown;
}

export interface OneTokenResponse {
  code?: number;
  msg?: string;
  data?: { accessToken?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/* ------------------------------ 门户业务模型 ------------------------------ */

/** 门户接口统一响应包装 */
export interface OneResponse<T> {
  code: number;
  msg?: string;
  data: T;
  [key: string]: unknown;
}

export interface OnePage<T> {
  total: number;
  list: T[];
  pageNum: number;
  pageSize: number;
  pages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  [key: string]: unknown;
}

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface NoticeQuery extends PageQuery {}

/**
 * 一条通知。已知字段只是「便捷访问」，全部可选；对象本身就是服务端原始 JSON，
 * 未列出的字段通过索引签名原样保留，字段增删改名都不会丢数据。
 */
export interface CampusNotice {
  PIM_ID?: string;
  PIM_TITLE?: string;
  PIM_CONTENT?: string;
  TYPE_NAME?: string;
  TYPE_ENGLISH_NAME?: string;
  BELONG_UNIT_NAME?: string;
  CREATE_TIME?: string;
  TIME?: string;
  DATE_TIME?: string;
  IS_READ?: string;
  IS_NEW?: string;
  IS_TOP?: string;
  [key: string]: unknown;
}

/** 通知分页：整体即服务端 `data` 原对象 */
export interface NoticePage extends OnePage<CampusNotice> {}

export interface DocumentQuery extends PageQuery {}

/** 一条校园公文 / 新闻（原始 JSON，字段全部可选） */
export interface CampusDocument {
  /** 文档 ID */
  FID?: string;
  /** 标题 */
  BT?: string;
  /** 发文单位名称 */
  BMMC?: string;
  /** 文号 */
  WH?: string;
  /** 发布日期，如 "2026-09-11" */
  FBSJ?: string;
  /** 上传日期 */
  SCRQ?: string;
  /** 正文/附件地址 */
  ZWURL?: string;
  VIEW_URL?: string;
  IS_NEW?: string;
  LX?: string;
  [key: string]: unknown;
}

export interface DocumentPage extends OnePage<CampusDocument> {}

export interface ActivityQuery {
  /** 起始时间，`yyyy-MM-dd HH:mm:ss`（北京时间） */
  beginDate: string;
  /** 结束时间，`yyyy-MM-dd HH:mm:ss`（北京时间） */
  endDate: string;
  activityType?: string;
  is_calendar_manager?: string;
  cal_tab?: string;
  [key: string]: unknown;
}

/** 一条日程活动（原始 JSON，字段全部可选） */
export interface Activity {
  cal_ID?: string;
  cal_NAME?: string;
  /** 标题（门户原文拼写） */
  tittle?: string;
  /** 开始时间（毫秒时间戳） */
  BEGINING_TIME?: number;
  /** 结束时间（毫秒时间戳） */
  ENDING_TIME?: number;
  /** 开始时间（`yyyy-MM-ddTHH:mm:ss.SSS+0000`） */
  begining_TIME?: string;
  ending_TIME?: string;
  active_URL?: string;
  isAllDay?: string;
  [key: string]: unknown;
}

/** 个人余额（金额为字符串，单位元） */
export interface Balance {
  /** 网费余额 */
  INTERNET_FEES?: string;
  /** 校园卡余额 */
  SCHOOL_CARD?: string;
  [key: string]: unknown;
}

/** 个人信息（原始 JSON，字段全部可选） */
export interface MyInfo {
  CURRENTUSER?: string;
  USER_NAME?: string;
  NICKNAME?: string;
  ID_NUMBER?: string;
  ID_TYPE?: string;
  ID_TYPE_NAME?: string;
  USER_SEX?: string;
  UNIT_NAME?: string;
  WORKING_PLACE?: string | null;
  EMAIL?: string | null;
  MOBILE?: string | null;
  IS_ACTIVE?: string;
  ACTIVE_NAME?: string;
  isWechatBind?: boolean;
  AVATAR_S_ID?: string | null;
  AVATAR_M_ID?: string | null;
  AVATAR_P_ID?: string | null;
  AVATAR_SPACE_ID?: string | null;
  DEVICES_LIST?: unknown[];
  PARENT_LIST?: unknown[];
  [key: string]: unknown;
}

/** 邮箱信息（原始 JSON，字段全部可选） */
export interface EmailInfo {
  /** 带 sid 的邮箱 SSO 直达链接 */
  SSO_URL?: string;
  FULL_EMAIL_NAME?: string;
  userAlia?: string;
  UNREAD_EMAIL_NUM?: number;
  RETURN_CODE?: number;
  [key: string]: unknown;
}

/** 教学周：服务端按当前日期计算，返回裸对象 */
export interface LearnWeek {
  /** 第几教学周 */
  ZC?: string;
  /** 学期号，如 "20261" */
  XQH?: string;
  [key: string]: unknown;
}

/* ------------------------------- URL 构造 ------------------------------- */

export function oneServiceUrl(
  act = DEFAULT_ACT,
  random = Math.random().toString(),
): string {
  return `${ONE_BASE}/#act=${act}&randomx=${random}`;
}

export function oneRedirectUri(service: string): string {
  return `${ONE_BASE}/cas.html?service=${encodeURIComponent(service)}`;
}

export function oneAuthorizeUrl(options: OneHustOptions = {}): string {
  const clientId = options.clientId ?? ONE_CLIENT_ID;
  const service = options.service ?? oneServiceUrl(options.act);
  const redirectUri = options.redirectUri ?? oneRedirectUri(service);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "all",
  });
  return `${ONE_AUTHORIZE}?${params.toString()}`;
}

/* ------------------------------- JWT 工具 ------------------------------- */

export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

export function jwtExpiresAt(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

/** 判断 token 是否仍可用（默认留 60s 余量） */
export function isOneTokenUsable(token: string, marginMs = 60_000): boolean {
  const expiresAt = jwtExpiresAt(token);
  if (expiresAt === undefined) return true;
  return expiresAt - marginMs > Date.now();
}

/* --------------------------------- 流程 --------------------------------- */

function authorizeServiceSpec(authorizeUrl: string): CasService {
  return {
    name: "one.hust",
    host: CAS_HOST,
    base: CAS_ORIGIN,
    service: authorizeUrl,
    sessionCookie: "JSESSIONID",
  };
}

/** 第 1 步：优先用 CASTGC 免密拿到 authorize 的 ticket，否则完整登录 */
async function requestInitialTicket(
  session: Session,
  authorizeUrl: string,
  login: LoginContextProvider,
  logger: Logger,
): Promise<string> {
  const ticket = await requestCasTicket(session, authorizeServiceSpec(authorizeUrl), logger);
  if (ticket) return ticket;

  logger.warn("one.hust: CASTGC 缺失或失效，回退完整登录");
  const context = login();
  return performCasLogin(session, authorizeUrl, context.credentials, context.ocr, { logger });
}

/** 第 2–5 步：跟随跳转直到落在 one.hust/cas.html（200） */
async function followToCasHtml(session: Session, start: string, logger: Logger): Promise<string> {
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const response = await session.get<string>(current, { responseType: "text" });
    const location = response.headers["location"] as string | undefined;

    if (response.status >= 300 && response.status < 400 && typeof location === "string") {
      current = new URL(location, current).toString();
      logger.debug(`one.hust: 跳转 ${hop + 1} -> ${current}`);
      continue;
    }

    if (isCasLoginResponse(response)) {
      throw new Error("one.hust: OAuth 跳转过程中被要求重新登录 CAS");
    }
    if (current.includes("/cas.html")) return current;
    throw new Error(`one.hust: OAuth 跳转未到达 cas.html（停在 ${current}）`);
  }
  throw new Error("one.hust: OAuth 跳转次数过多");
}

/**
 * 解析 constant.js 里的字符串常量。
 * 该文件的写法是 `var contextpathAuthc = gateway_url + "/sems-authc";`，
 * 所以需要按 `+` 拼接字符串字面量与变量引用来求值，而不是只匹配字面量。
 */
function parseJsStrings(js: string): Map<string, string> {
  const raw = new Map<string, string>();
  const decl = /var\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;
  for (let m = decl.exec(js); m; m = decl.exec(js)) raw.set(m[1], m[2].trim());

  const resolved = new Map<string, string>();
  const resolve = (name: string, stack: Set<string>): string | undefined => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    const expr = raw.get(name);
    if (expr === undefined || stack.has(name)) return undefined;

    stack.add(name);
    const tokens = expr.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*/g);
    if (!tokens) {
      stack.delete(name);
      return undefined;
    }
    let out = "";
    for (const token of tokens) {
      if (token.startsWith('"') || token.startsWith("'")) {
        out += token.slice(1, -1).replace(/\\(.)/g, "$1");
      } else {
        const value = resolve(token, stack);
        if (value === undefined) {
          stack.delete(name);
          return undefined;
        }
        out += value;
      }
    }
    stack.delete(name);
    resolved.set(name, out);
    return out;
  };

  for (const name of raw.keys()) resolve(name, new Set());
  return resolved;
}

/** 从 cas.html 同目录的 defaults/js/constant.js 解析 one.hust 的运行时常量 */
async function fetchOneConstants(
  session: Session,
  casHtmlUrl: string,
  logger: Logger,
): Promise<{ contextPathAuthc: string; clientId?: string }> {
  const constantUrl = new URL("./defaults/js/constant.js", casHtmlUrl).toString();
  logger.debug(`one.hust: 读取 ${constantUrl}`);
  const response = await session.get<string>(constantUrl, { responseType: "text" });

  const constants = parseJsStrings(String(response.data));
  const contextPathAuthc = constants.get("contextpathAuthc")?.replace(/\/+$/, "");
  if (!contextPathAuthc) {
    throw new Error("one.hust: 未能从 constant.js 解析 contextpathAuthc");
  }
  return { contextPathAuthc, clientId: constants.get("oauth_client_id") };
}

/** contextpathAuthc 可能是绝对地址（gateway_url + "/sems-authc"），统一成绝对 URL */
function oneAuthcBase(contextPathAuthc: string): string {
  return contextPathAuthc.startsWith("http")
    ? contextPathAuthc
    : `${ONE_BASE}${contextPathAuthc.startsWith("/") ? "" : "/"}${contextPathAuthc}`;
}

/**
 * 获取 one.hust 的 accessToken（OIDC JWT）。
 * 需传入带 CASTGC 的 Session；`login` 只在需要完整登录时求值。
 */
export async function acquireOneToken(
  session: Session,
  login: LoginContextProvider,
  options: OneHustOptions = {},
  logger: Logger = defaultLogger,
): Promise<OneToken> {
  const authorizeUrl = oneAuthorizeUrl(options);
  logger.info("one.hust: 开始 OIDC 委托认证");

  const initial = await requestInitialTicket(session, authorizeUrl, login, logger);
  const casHtmlUrl = await followToCasHtml(session, initial, logger);

  const code = new URL(casHtmlUrl).searchParams.get("code");
  if (!code) throw new Error("one.hust: cas.html 回调缺少 code");

  const constants = await fetchOneConstants(session, casHtmlUrl, logger);
  const clientId = options.clientId ?? constants.clientId ?? ONE_CLIENT_ID;
  const tokenUrl =
    `${oneAuthcBase(constants.contextPathAuthc)}/oauth2/casToken/` +
    `${encodeURIComponent(code)}/${encodeURIComponent(clientId)}?casDelegate=`;

  logger.debug(`one.hust: 换取 accessToken ${tokenUrl}`);
  const response = await session.get<OneTokenResponse>(tokenUrl, {
    responseType: "json",
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: casHtmlUrl },
  });

  const data = response.data;
  const accessToken = data?.data?.accessToken;
  if (data?.code !== 200 || !accessToken) {
    throw new Error(
      `one.hust: 换取 accessToken 失败: ${data?.msg ?? JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const expiresAt = jwtExpiresAt(accessToken);
  logger.info(
    `one.hust: accessToken 获取成功` +
      (expiresAt ? `（${new Date(expiresAt).toISOString()} 过期）` : ""),
  );
  return { accessToken, expiresAt, raw: data };
}

/**
 * 门户接口通用执行器：按 `ONE_ENDPOINTS` 的 schema 发请求、解包、分页。
 * `client.one.portal.call("balance")` / `.page("noticePage", {...})` / `.iterate("documentPage")`。
 */
export class OnePortal {
  private readonly api: OneHustApi;

  constructor(api: OneHustApi) {
    this.api = api;
  }

  private resolve(endpoint: OneEndpointName | PortalEndpoint): PortalEndpoint {
    return typeof endpoint === "string" ? ONE_ENDPOINTS[endpoint] : endpoint;
  }

  /** 按 schema 调用：`wrapped` 解包 data，`raw` 原样返回；带非 200 `code` 时抛错 */
  async call<Res = unknown>(
    endpoint: OneEndpointName | PortalEndpoint,
    body?: Record<string, unknown>,
  ): Promise<Res> {
    endpoint = this.resolve(endpoint);
    const method = endpoint.method ?? "POST";
    const data = { ...(endpoint.defaults ?? {}), ...(body ?? {}) };
    const response = await this.api.request<unknown>(endpoint.path, {
      method,
      responseType: "json",
      ...(method === "POST"
        ? { data, headers: { "Content-Type": "application/json;charset=UTF-8" } }
        : {}),
    });
    const parsed = (
      typeof response.data === "string" ? JSON.parse(response.data) : response.data
    ) as Record<string, unknown>;

    if (endpoint.envelope === "raw") {
      if (parsed && typeof parsed.code === "number" && parsed.code !== 200) {
        throw new Error(
          `one.hust 接口失败(${parsed.code}): ${parsed.message ?? parsed.msg ?? "未知错误"}`,
        );
      }
      return parsed as Res;
    }

    if (parsed?.code !== 200) {
      throw new Error(`one.hust 接口失败(${parsed?.code}): ${parsed?.msg ?? "未知错误"}`);
    }
    return parsed.data as Res;
  }

  /** 分页接口取一页（`endpoint.page` 必须为 true） */
  async page<Item = unknown>(
    endpoint: OneEndpointName | PortalEndpoint,
    query: PageQuery = {},
  ): Promise<OnePage<Item>> {
    const spec = this.resolve(endpoint);
    if (!spec.page) throw new Error(`one.hust: ${spec.path} 不是分页接口`);
    return this.call<OnePage<Item>>(spec, query);
  }

  /** 分页接口自动翻页 */
  async *iterate<Item = unknown>(
    endpoint: OneEndpointName | PortalEndpoint,
    query: PageQuery = {},
  ): AsyncGenerator<Item> {
    let pageNum = typeof query.pageNum === "number" ? query.pageNum : 1;
    const pageSize = typeof query.pageSize === "number" ? query.pageSize : 20;
    while (true) {
      const page = await this.page<Item>(endpoint, { ...query, pageNum, pageSize });
      for (const item of page.list) yield item;
      if (!page.hasNextPage || page.list.length === 0) break;
      pageNum += 1;
    }
  }
}

/** one.hust API：`client.one` */
export class OneHustApi {
  private readonly runtime: ClientRuntime;
  /** schema 驱动的通用门户接口执行器 */
  readonly portal: OnePortal;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
    this.portal = new OnePortal(this);
  }

  /** 当前缓存且未过期的 bearer token，无则 undefined */
  get accessToken(): string | undefined {
    const token = this.runtime.session()?.getCookie(ONE_ACCESS_TOKEN_COOKIE, ONE_HOST);
    return token && isOneTokenUsable(token) ? token : undefined;
  }

  /** 获取 one.hust 的 OIDC JWT（约一天有效）；过期或缺失时自动重新换取并缓存 */
  async getAccessToken(): Promise<string> {
    const session = await this.runtime.ensureReady();
    const cached = session.getCookie(ONE_ACCESS_TOKEN_COOKIE, ONE_HOST);
    if (cached && isOneTokenUsable(cached)) return cached;

    const token = await acquireOneToken(
      session,
      () => this.runtime.loginContext(),
      {},
      this.runtime.logger,
    );
    session.setCookie(ONE_ACCESS_TOKEN_COOKIE, token.accessToken, ONE_HOST, {
      path: "/",
      expiresAt: token.expiresAt,
    });
    this.runtime.save();
    return token.accessToken;
  }

  /** 丢弃缓存的 token（下次 getAccessToken 会重新换取） */
  invalidate(): void {
    this.runtime.session()?.deleteCookie(ONE_ACCESS_TOKEN_COOKIE, ONE_HOST);
    this.runtime.save();
  }

  /** 带 `Authorization: Bearer <token>` 请求 one.hust；401 时自动重换 token 重试一次 */
  async request<T = string>(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    const url = path.startsWith("http")
      ? path
      : `${ONE_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
    const { method, data, headers, ...rest } = config;

    const send = async (): Promise<AxiosResponse<T>> => {
      const token = await this.getAccessToken();
      const merged = { ...(headers ?? {}), Authorization: `Bearer ${token}` };
      const session = this.runtime.session()!;
      return method && method.toUpperCase() === "POST"
        ? session.post<T>(url, data, { responseType: "text", ...rest, headers: merged })
        : session.get<T>(url, { responseType: "text", ...rest, headers: merged });
    };

    let response = await send();
    if (response.status === 401) {
      this.runtime.logger.warn("one.hust: token 被拒绝，重新换取后重试");
      this.invalidate();
      response = await send();
    }
    return response;
  }

  /* ------------------------- 门户接口（schema 驱动） ------------------------- */

  /** 通知列表（分页） */
  getNotifications(query: NoticeQuery = {}): Promise<NoticePage> {
    return this.portal.page<CampusNotice>(ONE_ENDPOINTS.noticePage, query);
  }

  /** 自动翻页遍历全部通知 */
  iterateNotifications(query: NoticeQuery = {}): AsyncGenerator<CampusNotice> {
    return this.portal.iterate<CampusNotice>(ONE_ENDPOINTS.noticePage, query);
  }

  /** 校园公文 / 新闻列表（分页） */
  getDocuments(query: DocumentQuery = {}): Promise<DocumentPage> {
    return this.portal.page<CampusDocument>(ONE_ENDPOINTS.documentPage, query);
  }

  /** 自动翻页遍历全部公文 / 新闻 */
  iterateDocuments(query: DocumentQuery = {}): AsyncGenerator<CampusDocument> {
    return this.portal.iterate<CampusDocument>(ONE_ENDPOINTS.documentPage, query);
  }

  /**
   * 日程活动：返回 `[beginDate, endDate]` 内的全部活动（`data` 为活动数组）。
   * 实测无分页/条数上限；当前账号数据仅覆盖一个学期（最早 2026-08-31）。
   */
  getWeekActivities(query: ActivityQuery): Promise<Activity[]> {
    return this.portal.call<Activity[]>(ONE_ENDPOINTS.weekActivity, query);
  }

  /** 当前教学周（`ZC` 周次 / `XQH` 学期号）；服务端按当前日期计算，无需参数 */
  getLearnWeek(): Promise<LearnWeek> {
    return this.portal.call<LearnWeek>(ONE_ENDPOINTS.learnWeek);
  }

  /** 邮箱信息：`SSO_URL` 可直接打开邮箱、`UNREAD_EMAIL_NUM` 未读数 */
  getEmailInfo(): Promise<EmailInfo> {
    return this.portal.call<EmailInfo>(ONE_ENDPOINTS.emailInfo);
  }

  /** 个人余额：`INTERNET_FEES` 网费 / `SCHOOL_CARD` 校园卡（单位元，字符串） */
  getBalance(): Promise<Balance> {
    return this.portal.call<Balance>(ONE_ENDPOINTS.balance);
  }

  /** 个人信息：姓名、学号、院系、身份、绑定手机/邮箱等 */
  getMyInfo(): Promise<MyInfo> {
    return this.portal.call<MyInfo>(ONE_ENDPOINTS.myInfo);
  }
}
