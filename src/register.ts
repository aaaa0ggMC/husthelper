import type { AxiosResponse } from "axios";
import type { CasResponse, CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 学期注册及基本信息管理系统（register.hust.edu.cn）。
 *
 * 它是普通 CAS 应用，`service` 为入口 `http://register.hust.edu.cn/WeChatLogin`。
 * 换票链路（由 CASTGC 驱动）：
 *
 * 1. GET  pass /cas/login?service=<WeChatLogin>   → 302 register /WeChatLogin?ticket=ST-...
 * 2. GET  register /WeChatLogin?ticket=ST         → 302 /WeChatLogin;jsessionid=<tomcat>（种下 JSESSIONID）
 * 3. GET  register /WeChatLogin                   → 302 /WeChatStudentIndex（JSESSIONID 轮换为 Shiro 的 UUID 会话）
 * 4. GET  register /WeChatStudentIndex            → 200
 *
 * 即 `exchangeTicket` 逐跳跟随即可拿到最终会话；之后 `/weChat/student/*` 接口复用该 `JSESSIONID`。
 * 会话失效时接口返回 302 到 `/login`，据此自动重连。
 */

export const REGISTER_HOST = "register.hust.edu.cn";
export const REGISTER_BASE = `http://${REGISTER_HOST}`;
export const REGISTER_SERVICE = `${REGISTER_BASE}/WeChatLogin`;
export const REGISTER_SESSION_COOKIE = "JSESSIONID";

/** 学期注册系统里的失效判定：跳到 `/login` 或 CAS */
export function isRegisterLoginRedirect(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    (location.includes("/WeChatLogin") ||
      location.includes("/login") ||
      location.includes("/cas/login"))
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  const body = typeof response.data === "string" ? response.data : "";
  return contentType.includes("text/html") && body.includes("/cas/login?service=");
}

/** 学期注册系统作为 CAS 应用的声明 */
export const registerService: CasService = {
  name: "register",
  host: REGISTER_HOST,
  base: REGISTER_BASE,
  service: REGISTER_SERVICE,
  sessionCookie: REGISTER_SESSION_COOKIE,
  isLoginRedirect: isRegisterLoginRedirect,
};

export function registerUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${REGISTER_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/* --------------------------------- 数据模型 --------------------------------- */

/** 当前学期（`/weChat/student/getXqmc` 的 `data`） */
export interface RegistrationSemester {
  /** 学期号，如 "20261" */
  XQH?: string;
  /** 学期名，如 "2026年秋季" */
  XQMC?: string;
  /** 英文学期名，如 "autumn 2026" */
  YWXQMC?: string;
  /** 起始日期（服务端键为 `TO_CHAR(QSRQ,'YYYY-MM-DD')`），如 "2026-08-31" */
  startDate?: string;
  /** 结束日期（服务端键为 `TO_CHAR(JSRQ,'YYYY-MM-DD')`），如 "2027-01-17" */
  endDate?: string;
  [key: string]: unknown;
}

/** 注册状态（`/weChat/student/getZczt`） */
export interface RegistrationStatus {
  /** 服务端提示，如 "已注册" / "未注册" */
  status?: string;
  /** 是否已注册（依据 `status` 是否包含「已注册」） */
  registered: boolean;
  code?: number;
  raw?: unknown;
  [key: string]: unknown;
}

/** 一条注册通知（`noticeListData` 的 `rows` 项） */
export interface RegistrationNotice {
  ARTICLEID?: string;
  ARTICLETITLE?: string;
  /** 发布日期，如 "2023-02-09" */
  PUBLISHDATE?: string;
  ROW_ID?: number;
  [key: string]: unknown;
}

export interface RegistrationNoticePage {
  total: number;
  rows: RegistrationNotice[];
  code?: number;
  [key: string]: unknown;
}

export interface RegistrationNoticeQuery {
  pageNum?: number;
  pageSize?: number;
}

interface Envelope<T> {
  code?: number;
  msg?: string;
  data?: T;
  [key: string]: unknown;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === "string" ? JSON.parse(data) : data) as T;
}

const AJAX_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
} as const;

/* ---------------------------------- API ---------------------------------- */

/** 学期注册 API：`client.register` */
export class RegisterApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(REGISTER_SESSION_COOKIE, REGISTER_HOST);
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(registerService, registerUrl(path), {
      headers: { Referer: registerUrl("/WeChatStudentIndex") },
      ...config,
    });
  }

  /** 当前学期（学期号 / 学期名 / 起止日期） */
  async getSemester(): Promise<RegistrationSemester> {
    const response = await this.request<Envelope<RegistrationSemester>>(
      "/weChat/student/getXqmc",
      { method: "POST", responseType: "json", headers: { ...AJAX_HEADERS } },
    );
    const body = parseJson<Envelope<RegistrationSemester>>(response.data);
    if (body?.code !== 0) {
      throw new Error(`register 学期接口失败(${body?.code}): ${body?.msg ?? "未知错误"}`);
    }
    const data = body.data ?? {};
    return {
      ...data,
      startDate: data["TO_CHAR(QSRQ,'YYYY-MM-DD')"] as string | undefined,
      endDate: data["TO_CHAR(JSRQ,'YYYY-MM-DD')"] as string | undefined,
    };
  }

  /** 当前学期注册状态（如「已注册」） */
  async getStatus(): Promise<RegistrationStatus> {
    const response = await this.request<Envelope<null>>("/weChat/student/getZczt", {
      method: "POST",
      responseType: "json",
      headers: { ...AJAX_HEADERS },
    });
    const body = parseJson<Envelope<null>>(response.data);
    const status = body?.msg ?? "";
    return { status, registered: status.includes("已注册"), code: body?.code, raw: body };
  }

  /** 注册相关通知（分页，服务端按 `pageNum`/`pageSize` 表单参数） */
  async getNotices(query: RegistrationNoticeQuery = {}): Promise<RegistrationNoticePage> {
    const params = new URLSearchParams({
      pageNum: String(query.pageNum ?? 1),
      pageSize: String(query.pageSize ?? 5),
    });
    const response = await this.request<RegistrationNoticePage>(
      "/weChat/student/infor/noticeListData",
      {
        method: "POST",
        responseType: "json",
        data: params.toString(),
        headers: {
          ...AJAX_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      },
    );
    const body = parseJson<RegistrationNoticePage>(response.data);
    return { ...body, rows: Array.isArray(body?.rows) ? body.rows : [] };
  }
}
