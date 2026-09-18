import type { AxiosResponse } from "axios";
import { performCasLogin, requestCasTicket, type CasService, type LoginContextProvider } from "./cas.ts";
import type { RequestOptions, Session } from "./http.ts";
import { defaultLogger, type Logger } from "./logger.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * IHuster 微平台（第二课堂，`ihuster.hust.edu.cn:82`）。
 *
 * 它用 OAuth/JWT 而非 JSESSIONID：CAS 换票后不种 cookie，而是在 302 的 URL
 * **fragment** 里带回一个 JWT（`#/?loginName=<jwt>`），前端取出后作为
 * `Authorization: Bearer <jwt>` 调用 `/web/**` 接口。
 *
 * 链路（由 CASTGC 驱动）：
 * 1. GET  pass /cas/login?service=<ihuster login?pageUrl=..&targetUrl=..> → 302 回到该 service（带 ticket）
 * 2. GET  ihuster /web/cas/cas/login?...&ticket=ST-...                   → 302 http://ihuster.hust.edu.cn/#/?loginName=<jwt>
 * 3. 解析 fragment 里的 jwt，之后所有接口带 `Authorization: Bearer <jwt>`
 */

export const IHUSTER_HOST = "ihuster.hust.edu.cn";
/** 门户 / 接口站点（前端与 `/web/**` 接口都在 :82） */
export const IHUSTER_PORTAL = `http://${IHUSTER_HOST}:82/`;
export const IHUSTER_WEB = `http://${IHUSTER_HOST}:82/web`;
/** `targetUrl` 固定值：`"HUAKE" + base64("http://ihuster.hust.edu.cn/")` */
export const IHUSTER_TARGET_URL = "HUAKEaHR0cDovL2lodXN0ZXIuaHVzdC5lZHUuY24v";
/** 传给 CAS 的 service（ihuster 自身的 CAS 登录端点） */
export const IHUSTER_SERVICE =
  `http://${IHUSTER_HOST}/web/cas/cas/login` +
  `?pageUrl=${encodeURIComponent(IHUSTER_PORTAL)}&targetUrl=${IHUSTER_TARGET_URL}`;
/** JWT 在 cookie jar 中的缓存名（复用 one.hust 的做法，便于持久化） */
export const IHUSTER_TOKEN_COOKIE = "ihuster_token";

const ihusterCasService: CasService = {
  name: "ihuster",
  host: IHUSTER_HOST,
  service: IHUSTER_SERVICE,
  sessionCookie: "JSESSIONID",
  base: `http://${IHUSTER_HOST}`,
};

export function ihusterUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${IHUSTER_WEB}${path.startsWith("/") ? "" : "/"}${path}`;
}

export interface IhusterTokenPayload {
  /** 学号，如 "U2025xxxxx" */
  code?: string;
  name?: string;
  /** 服务端为大整数，这里保留字符串以免 JS 精度丢失 */
  userId?: number | string;
  ubiName?: string;
  uoiName?: string;
  roleIds?: number[];
  type?: number;
  [key: string]: unknown;
}

/** 解码 JWT payload；`sub` 是用户信息 JSON 字符串时一并解出 */
export function decodeIhusterToken(token: string): {
  exp?: number;
  iat?: number;
  sub?: string;
  profile?: IhusterTokenPayload;
} {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    let profile: IhusterTokenPayload | undefined;
    if (typeof payload.sub === "string") {
      try {
        profile = JSON.parse(payload.sub) as IhusterTokenPayload;
        // JSON.parse 会把大整数 userId 变成不精确的 Number，这里从原文取精确值
        const exact = payload.sub.match(/"userId"\s*:\s*(\d+)/)?.[1];
        if (exact !== undefined) profile.userId = exact;
      } catch {
        profile = undefined;
      }
    }
    return {
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      profile,
    };
  } catch {
    return {};
  }
}

function isTokenUsable(token: string, marginMs = 60_000): boolean {
  const { exp } = decodeIhusterToken(token);
  if (exp === undefined) return true;
  return exp * 1000 - marginMs > Date.now();
}

/** 从 302 Location 的 fragment 中取出 `loginName` JWT */
export function extractIhusterToken(location: string): string | undefined {
  const hash = location.indexOf("#");
  if (hash < 0) return undefined;
  const query = location.slice(hash + 1).replace(/^[/?]+/, "");
  const params = new URLSearchParams(query);
  return params.get("loginName") ?? undefined;
}

/** 通过 CAS 获取 ihuster 的 JWT（写入共享 session 的 cookie 缓存） */
export async function acquireIhusterToken(
  session: Session,
  login: LoginContextProvider,
  logger: Logger = defaultLogger,
): Promise<string> {
  logger.info("ihuster: 通过 CAS 获取 JWT");

  let ticket = await requestCasTicket(session, ihusterCasService, logger);
  if (!ticket) {
    logger.warn("ihuster: CASTGC 缺失或失效，回退完整登录");
    const context = login();
    ticket = await performCasLogin(session, IHUSTER_SERVICE, context.credentials, context.ocr, {
      logger,
    });
  }

  const response = await session.get<string>(ticket, { responseType: "text" });
  const location = response.headers["location"];
  if (typeof location !== "string") {
    throw new Error("ihuster: 换票后未拿到跳转 Location");
  }
  const token = extractIhusterToken(location);
  if (!token) throw new Error("ihuster: 跳转 Location 中缺少 loginName JWT");
  return token;
}

/* --------------------------------- 数据模型 --------------------------------- */

/** 一类二课学分的汇总项（`summaryQuery` 的 `record` 项） */
export interface CreditSummaryRecord {
  /** 该类别已获学分 */
  credit?: string;
  /** 类别 id */
  category?: string;
  /** 该类别活动次数 */
  count?: string;
  userId?: string;
  userName?: string;
  [key: string]: unknown;
}

/** 二课学分汇总（`summaryQuery` 的 `data`） */
export interface CreditSummary {
  /** 总活动次数 */
  sumCount?: string;
  /** 总学分 */
  sumCredit?: string;
  record: CreditSummaryRecord[];
  [key: string]: unknown;
}

/** 用户信息（`queryUserInfo` 的 `data`，字段为服务端原文） */
export interface IhusterUserInfo {
  loginName?: string;
  gradeCode?: string;
  className?: string;
  departmentName?: string;
  schoolName?: string;
  scoreCount?: number;
  activityScoreCount?: number;
  stuStatusCode?: string;
  userId?: string | number;
  [key: string]: unknown;
}

interface IhusterEnvelope<T> {
  code?: string | number;
  msg?: string;
  data?: T;
  [key: string]: unknown;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === "string" ? JSON.parse(data) : data) as T;
}

/* ---------------------------------- API ---------------------------------- */

/** IHuster 第二课堂 API：`client.ihuster` */
export class IhusterApi {
  private readonly runtime: ClientRuntime;
  private acquiring?: Promise<string>;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  /** 当前缓存且未过期的 JWT，无则 undefined */
  get token(): string | undefined {
    const cached = this.runtime.session()?.getCookie(IHUSTER_TOKEN_COOKIE, IHUSTER_HOST);
    return cached && isTokenUsable(cached) ? cached : undefined;
  }

  /** 从当前 JWT 解出的用户信息（同步，未登录时为 undefined） */
  get profile(): IhusterTokenPayload | undefined {
    const token = this.token;
    return token ? decodeIhusterToken(token).profile : undefined;
  }

  private async ensureToken(): Promise<string> {
    const session = await this.runtime.ensureReady();
    const cached = session.getCookie(IHUSTER_TOKEN_COOKIE, IHUSTER_HOST);
    if (cached && isTokenUsable(cached)) return cached;

    if (!this.acquiring) {
      this.acquiring = acquireIhusterToken(
        session,
        () => this.runtime.loginContext(),
        this.runtime.logger,
      ).finally(() => {
        this.acquiring = undefined;
      });
    }
    const token = await this.acquiring;
    session.setCookie(IHUSTER_TOKEN_COOKIE, token, IHUSTER_HOST, {
      path: "/",
      expiresAt: (decodeIhusterToken(token).exp ?? 0) * 1000 || undefined,
    });
    this.runtime.save();
    return token;
  }

  /** 丢弃缓存的 JWT（下次请求会重新换取） */
  invalidate(): void {
    this.runtime.session()?.deleteCookie(IHUSTER_TOKEN_COOKIE, IHUSTER_HOST);
    this.runtime.save();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const send = async (): Promise<AxiosResponse<IhusterEnvelope<T>>> => {
      const token = await this.ensureToken();
      const session = this.runtime.session()!;
      return session.post<IhusterEnvelope<T>>(ihusterUrl(path), body, {
        responseType: "json",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          Authorization: `Bearer ${token}`,
          Referer: IHUSTER_PORTAL,
        },
      });
    };

    let response = await send();
    if (response.status === 401) {
      this.runtime.logger.warn("ihuster: JWT 被拒绝，重新获取后重试");
      this.invalidate();
      response = await send();
    }

    const envelope = parseJson<IhusterEnvelope<T>>(response.data);
    if (String(envelope?.code ?? "200") !== "200") {
      throw new Error(`ihuster 接口失败(${envelope?.code}): ${envelope?.msg ?? "未知错误"}`);
    }
    return envelope.data as T;
  }

  /** 二课学分汇总：`sumCredit` 总学分 / `sumCount` 总次数 / `record` 分类明细 */
  async getCreditSummary(): Promise<CreditSummary> {
    const data = await this.post<CreditSummary>("/activity-front/creditsummary/summaryQuery", {});
    return { ...data, record: Array.isArray(data?.record) ? data.record : [] };
  }

  /** 用户信息；`userNum` 缺省时取当前 JWT 里的 `userId` */
  async getUserInfo(userNum?: string | number): Promise<IhusterUserInfo> {
    const id = userNum ?? this.profile?.userId;
    if (id === undefined) throw new Error("ihuster: 缺少 userNum");
    return this.post<IhusterUserInfo>("/admin/admin/sys/user/queryUserInfo", { userNum: id });
  }
}
