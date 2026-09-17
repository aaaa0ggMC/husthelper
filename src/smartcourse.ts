import { createHash } from "node:crypto";
import type { AxiosResponse } from "axios";
import { CAS_ORIGIN, type CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 智慧课程平台（smartcourse.hust.edu.cn）。
 *
 * 它和 one.hust 一样是「嵌套 OAuth2」：CAS 的 `service` 就是 OAuth2 authorize 端点，
 * 但最终不换 token，而是由 `smartcourse /sso/login/3rd?...&code=...` 一次性下发一堆
 * 会话 cookie（`Domain=.hust.edu.cn`）。因此可直接用普通 `CasService` 建模——
 * `exchangeTicket` 逐跳跟随重定向时会自动吸收每一跳的 `Set-Cookie`（父域 cookie 也会
 * 匹配到 smartcourse 子域）。多出来的 CAS `JSESSIONID` 轮换是 CAS OAuth2 两段式
 * （authorize + callbackAuthorize 各一个 ticket）造成的，无需特殊处理。
 */

export const SMARTCOURSE_HOST = "smartcourse.hust.edu.cn";
export const SMARTCOURSE_BASE = `https://${SMARTCOURSE_HOST}`;
export const SMARTCOURSE_CLIENT_ID = "HustSmartEdu0417";
export const SMARTCOURSE_WEB_ID = "1731";
export const SMARTCOURSE_SESSION_COOKIE = "p_auth_token";

/** 最终回到课程平台的回调地址（CAS 授权码会以 `&code=...` 追加） */
export const SMARTCOURSE_REDIRECT_URI =
  `${SMARTCOURSE_BASE}/sso/login/3rd?wfwfid=${SMARTCOURSE_WEB_ID}` +
  `&refer=${SMARTCOURSE_BASE}&response_type=code`;

/** 传给 CAS 的 service：OAuth2 authorize 端点 */
export const SMARTCOURSE_SERVICE =
  `${CAS_ORIGIN}/cas/oauth2.0/authorize?client_id=${SMARTCOURSE_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(SMARTCOURSE_REDIRECT_URI)}&response_type=code`;

export const smartcourseService: CasService = {
  name: "smartcourse",
  host: SMARTCOURSE_HOST,
  base: SMARTCOURSE_BASE,
  service: SMARTCOURSE_SERVICE,
  sessionCookie: SMARTCOURSE_SESSION_COOKIE,
  ticketHops: 10,
};

export function smartcourseUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${SMARTCOURSE_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 课表接口路径 */
export const SMARTCOURSE_LESSONS_PATH = "/kb-smartcourse/pc/curriculum/getMyLessons";

/** 登录用户信息接口路径 */
export const SMARTCOURSE_LOGIN_USER_PATH = "/notice-smartcourse/apis/getLoginUser";

/** 当天课表接口路径 */
export const SMARTCOURSE_ONE_DAY_LESSONS_PATH =
  "/kb-smartcourse/apis/curriculum/getOneDayLessons";

/** 我的课程列表接口路径 */
export const SMARTCOURSE_COURSE_LIST_PATH =
  "/fyportal-smartcourse/fyportal/hzkj/getCourseList";

/** 要上的线上课程列表（返回 HTML 片段） */
export const SMARTCOURSE_STUDY_COURSE_PATH =
  "/fyportal-smartcourse/fyportal/wfw/courselist/getStudyCourse";

/**
 * `getOneDayLessons` 的 `enc` 签名盐（来自 smartcourse 平台前端 JS 的硬编码，
 * 非本库推导）：`enc = md5(PUID + 盐)`。
 *
 * 若该接口开始返回「参数校验失败」/`result=0`，多半是平台更换了这个 magic number，
 * 请到下面这个前端 bundle 里重新检索（搜 `getOneDayLessons` 附近的 `md5(`）并更新本值：
 * https://smartcourse.hust.edu.cn/noteyd-smartcourse/front/pageindex/pc/js/index.js?t=20240524
 */
export const SMARTCOURSE_ENC_SALT = "uhZxJkJmck";

/** 计算 `getOneDayLessons` 的 `enc` 参数 */
export function smartcourseEnc(puid: number | string): string {
  return createHash("md5").update(`${puid}${SMARTCOURSE_ENC_SALT}`).digest("hex");
}

/** 通知列表接口路径 */
export const SMARTCOURSE_NOTICE_LIST_PATH = "/notice-smartcourse/pc/notice/getNoticeList";

/**
 * 通知列表 `type`。已确认：`2` = 我接收到的（前端注释原文）。
 * `1` 对该账号为空（疑似「我发送的」），`3`/不传 与 `2` 结果相同，语义未确认。
 */
export const NOTICE_TYPE = {
  /** 我接收到的 */
  RECEIVED: 2,
} as const;

export interface LessonQuery {
  crossOrigin?: boolean | string;
  week?: number | string;
  schoolYear?: string;
  semester?: string;
  /** 毫秒时间戳，不传则取当前时间 */
  userSelectedTime?: number;
  [key: string]: unknown;
}

/** 课表配置（学期、周次、作息时间等） */
export interface Curriculum {
  schoolYear?: string;
  semester?: string;
  currentWeek?: number;
  realCurrentWeek?: number;
  maxWeek?: number;
  curriculumCount?: number;
  uuid?: string;
  weeksLessonTimeConfigArray?: unknown[];
  lessonTimeConfigArray?: unknown[];
  [key: string]: unknown;
}

/** 一次课（字段为门户原文，全部按原样保留） */
export interface Lesson {
  fid?: string;
  name?: string;
  className?: string;
  courseNo?: string;
  teacherName?: string;
  teacherNo?: string;
  dayOfWeek?: number | string;
  beginNumber?: number | string;
  length?: number | string;
  weekType?: string;
  weeks?: string;
  location?: string;
  onlineLocation?: string;
  meetCode?: string;
  [key: string]: unknown;
}

export interface MyLessons {
  curriculum?: Curriculum;
  lessonArray?: Lesson[];
  [key: string]: unknown;
}

/** 我的课程列表里的一门课（原始 JSON，字段全部可选） */
export interface SmartCourseItem {
  courseId?: string;
  personId?: number;
  clazzId?: string;
  courseIdentifier?: string;
  imageUrl?: string;
  name?: string;
  url?: string;
  [key: string]: unknown;
}

/** 我的课程列表返回：整体即服务端原始对象 */
export interface CourseListResult {
  status?: boolean;
  msg?: string;
  /** 我教的课 */
  teach?: SmartCourseItem[];
  /** 我学的课 */
  study?: SmartCourseItem[];
  [key: string]: unknown;
}

export interface StudyCourseQuery {
  searchKcxzid?: string;
  moreplat?: number | string;
  sectionId?: number | string;
  semesterNum?: string;
  coursesource?: number | string;
  coursename?: string;
  searchkkstatus?: number | string;
  belongSchoolId?: number | string;
  labelid?: number | string;
  [key: string]: unknown;
}

/** 要上的线上课程（从 HTML 解析，字段为页面原文） */
export interface StudyCourse {
  /** 课程 ID（页面属性 `cid`） */
  courseId?: string;
  /** 教学班 ID（页面属性 `classid`） */
  clazzId?: string;
  personId?: string;
  name?: string;
  /** 学分，如 "2.5" */
  credits?: string;
  /** 课时，如 "40" */
  hours?: string;
  /** 进入学习链接 */
  url?: string;
  /** 封面图 */
  cover?: string;
  kcenc?: string;
  ckenc?: string;
  clazzenc?: string;
  source?: string;
  iswzy?: string;
  micid?: string;
  /** 原始 `<li>` 片段 */
  raw?: string;
  [key: string]: unknown;
}

function htmlAttr(tag: string, name: string): string | undefined {
  // 前置空白/开头，避免 `cid` 命中 `micid` 这类子串
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1];
}

function htmlText(body: string, pattern: RegExp): string | undefined {
  const match = body.match(pattern);
  return match?.[1]?.trim();
}

/** 解析 `getStudyCourse` 返回的 HTML 片段为课程数组 */
export function parseStudyCourses(html: string): StudyCourse[] {
  const courses: StudyCourse[] = [];
  const itemRe = /<li\s+class="w_couritem"([^>]*)>([\s\S]*?)<\/li>/g;
  for (let match = itemRe.exec(html); match; match = itemRe.exec(html)) {
    const attrs = match[1];
    const body = match[2];
    const href =
      body.match(/<a[^>]+href='([^']+)'/i)?.[1] ??
      body.match(/<a[^>]+href="([^"]+)"/i)?.[1];
    courses.push({
      courseId: htmlAttr(attrs, "cid"),
      clazzId: htmlAttr(attrs, "classid"),
      personId: htmlAttr(attrs, "personId"),
      name: htmlAttr(attrs, "cname") ?? htmlText(body, /title="([^"]*)"/),
      credits: htmlText(body, /学分：\s*([\d.]+)/),
      hours: htmlText(body, /课时：\s*([\d.]+)/),
      url: href,
      cover: htmlText(body, /<img\s+src="([^"]+)"/i),
      kcenc: htmlAttr(attrs, "kcenc"),
      ckenc: htmlAttr(attrs, "ckenc"),
      clazzenc: htmlAttr(attrs, "clazzenc"),
      source: htmlAttr(attrs, "source"),
      iswzy: htmlAttr(attrs, "iswzy"),
      micid: htmlAttr(attrs, "micid"),
      raw: match[0],
    });
  }
  return courses;
}

/** 当天课表（无课时 `data` 仅含学期/周次，`msg` 提示「该用户当天没课」） */
export interface OneDayLessons {
  schoolYear?: string;
  semester?: number | string;
  currentWeek?: number;
  lessonArray?: Lesson[];
  lessons?: Lesson[];
  [key: string]: unknown;
}

/** 登录用户信息（原始 JSON，字段全部可选） */
export interface LoginUser {
  puid?: number;
  schoolname?: string;
  /** 头像 URL */
  pic?: string;
  name?: string;
  fid?: number;
  sign_ban?: number;
  belongfids?: unknown;
  isCertify?: number;
  [key: string]: unknown;
}

/** 一条通知（原始 JSON，字段全部可选） */
export interface Notice {
  idCode?: string;
  title?: string;
  content?: string;
  createrName?: string;
  insertTime?: string;
  sendTime?: string;
  source?: number | string;
  sourceType?: number | string;
  sendTag?: string;
  isread?: number | boolean;
  top?: number | boolean;
  [key: string]: unknown;
}

/** 通知列表返回：整体即服务端原始对象 */
export interface NoticeListResult {
  notices?: Notice[] | { list?: Notice[]; records?: Notice[]; [key: string]: unknown };
  folders?: unknown[];
  status?: boolean;
  mySendNoticeCount?: number;
  [key: string]: unknown;
}

/** 从通知列表返回里取出通知数组（`notices` 可能是数组或带 list/records 的对象） */
export function noticeItems(result: NoticeListResult | undefined): Notice[] {
  const notices = result?.notices;
  if (Array.isArray(notices)) return notices;
  if (notices && typeof notices === "object") {
    const record = notices as { list?: Notice[]; records?: Notice[] };
    return record.list ?? record.records ?? [];
  }
  return [];
}

/** 智慧课程平台 API：`client.smartcourse` */
export class SmartCourseApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(SMARTCOURSE_SESSION_COOKIE, SMARTCOURSE_HOST);
  }

  /**
   * 当前登录用户的 puid（同步从 cookie 读取，未登录时为 undefined）。
   * 与 `getLoginUser().puid` 一致，但不需要发请求。
   */
  get puid(): number | undefined {
    const session = this.runtime.session();
    const raw =
      session?.getCookie("UID", SMARTCOURSE_HOST) ??
      session?.getCookie("_uid", SMARTCOURSE_HOST) ??
      session?.getCookie("1731UID", SMARTCOURSE_HOST);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : undefined;
  }

  /** 该平台当前持有的全部 cookie（`.hust.edu.cn` 父域的也会包含在内） */
  cookies(): Record<string, string> {
    return this.runtime.cookiesFor(SMARTCOURSE_HOST);
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(smartcourseService, smartcourseUrl(path), config);
  }

  /** 我的课表（含课程配置与逐次课的明细） */
  async getMyLessons(query: LessonQuery = {}): Promise<MyLessons> {
    const params = new URLSearchParams({
      crossOrigin: "true",
      week: "",
      schoolYear: "",
      semester: "",
      userSelectedTime: String(query.userSelectedTime ?? Date.now()),
    });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }

    const response = await this.request<{ result?: number; msg?: string; data?: MyLessons }>(
      `${SMARTCOURSE_LESSONS_PATH}?${params}`,
      {
        responseType: "json",
        headers: { Accept: "application/json, text/plain, */*" },
      },
    );
    const body =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (body?.result !== 1) {
      throw new Error(`smartcourse 接口失败(${body?.result}): ${body?.msg ?? "未知错误"}`);
    }
    return body.data ?? {};
  }

  /**
   * 通知列表。默认 `type=2`（我接收到的）；`type` 原样透传。
   * 返回整体原始对象，通知数组用 `noticeItems(result)` 取。
   */
  async getNoticeList(type: number | string = NOTICE_TYPE.RECEIVED): Promise<NoticeListResult> {
    const params = new URLSearchParams({ type: String(type) });
    const response = await this.request<NoticeListResult>(
      `${SMARTCOURSE_NOTICE_LIST_PATH}?${params}`,
      {
        responseType: "json",
        headers: { Accept: "application/json, text/plain, */*" },
      },
    );
    const body =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (body?.status === false) throw new Error("smartcourse 获取通知失败");
    return body ?? {};
  }

  /**
   * 当天课表（`enc` 自动按 `md5(puid + 盐)` 计算）。不传 `puid` 时先取登录用户信息。
   */
  async getOneDayLessons(puid?: number | string): Promise<OneDayLessons> {
    const id = puid ?? this.puid ?? (await this.getLoginUser()).puid;
    if (id === undefined || id === null) throw new Error("smartcourse: 缺少 puid");

    const params = new URLSearchParams({
      crossOrigin: "true",
      puid: String(id),
      enc: smartcourseEnc(id),
    });
    const response = await this.request<{
      result?: number;
      msg?: string;
      errorMsg?: string;
      data?: OneDayLessons;
    }>(`${SMARTCOURSE_ONE_DAY_LESSONS_PATH}?${params}`, {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (body?.result !== 1) {
      throw new Error(
        `smartcourse 接口失败(${body?.result}): ${body?.errorMsg ?? body?.msg ?? "未知错误"}`,
      );
    }
    return body.data ?? {};
  }

  /** 我的课程列表：`study` 我学的 / `teach` 我教的 */
  async getCourseList(): Promise<CourseListResult> {
    const response = await this.request<CourseListResult>(SMARTCOURSE_COURSE_LIST_PATH, {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (body?.status === false) {
      throw new Error(`smartcourse 获取课程失败: ${body?.msg ?? "未知错误"}`);
    }
    return body ?? {};
  }

  /**
   * 要上的线上课程（返回 HTML 片段，已解析成课程数组）。
   * 默认参数取自线上课程页；`semesterNum` 默认为 `20261`，可自行覆盖。
   */
  async getStudyCourses(query: StudyCourseQuery = {}): Promise<StudyCourse[]> {
    const params = new URLSearchParams({
      searchKcxzid: "",
      moreplat: "0",
      sectionId: "14",
      semesterNum: "20261",
      coursesource: "0",
      coursename: "",
      searchkkstatus: "0",
      belongSchoolId: "0",
      labelid: "0",
    });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const response = await this.request<string>(
      `${SMARTCOURSE_STUDY_COURSE_PATH}?${params}`,
      { responseType: "text", headers: { Accept: "text/html, */*" } },
    );
    return parseStudyCourses(String(response.data));
  }

  /** 登录用户信息：姓名、学校、头像、puid 等 */
  async getLoginUser(): Promise<LoginUser> {
    const response = await this.request<{ result?: number; msg?: string; data?: LoginUser }>(
      `${SMARTCOURSE_LOGIN_USER_PATH}?detail=1`,
      {
        responseType: "json",
        headers: { Accept: "application/json, text/plain, */*" },
      },
    );
    const body =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (body?.result !== 1) {
      throw new Error(`smartcourse 接口失败(${body?.result}): ${body?.msg ?? "未知错误"}`);
    }
    return body.data ?? {};
  }
}
