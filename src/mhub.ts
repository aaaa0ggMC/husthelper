import type { AxiosResponse } from "axios";
import type { CasResponse, CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";
import { parseGradeTerms, parseGrades, type GradeTerm, type Grades } from "./grades.ts";

export const MHUB_HOST = "mhub.hust.edu.cn";
export const MHUB_BASE = "http://mhub.hust.edu.cn";
export const MHUB_SERVICE = `${MHUB_BASE}/cas/login?redirectUrl=/CjcxController/fianCjInfo`;
export const MHUB_SESSION_COOKIE = "JSESSIONID";

/** mhub 的失效判定：除 CAS 外还会跳到自身的 /login? */
export function isMhubLoginRedirect(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    (location.includes("/cas/login") || location.includes("/login?"))
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  const body = typeof response.data === "string" ? response.data : "";
  return contentType.includes("text/html") && body.includes("/cas/login?redirectUrl=");
}

/** 成绩服务（mhub）作为 CAS 应用的声明 */
export const mhubService: CasService = {
  name: "mhub",
  host: MHUB_HOST,
  base: MHUB_BASE,
  service: MHUB_SERVICE,
  sessionCookie: MHUB_SESSION_COOKIE,
  isLoginRedirect: isMhubLoginRedirect,
};

export function mhubUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${MHUB_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/* ------------------------------- 学业考试查询 ------------------------------- */

/**
 * 考试类型 `kslx`。页面下拉框原文：
 * `0` = 补(缓)考考试，`1` = 普通考试。
 */
export const EXAM_TYPE = {
  /** 补(缓)考考试 */
  MAKEUP: 0,
  /** 普通考试 */
  NORMAL: 1,
} as const;

/** 考试查询页里的学生信息（`/CommonController/userList`） */
export interface ExamUser {
  XH?: string;
  XM?: string;
  SFID?: string;
  DWMC?: string;
  DWBH?: string;
  ZYMC?: string;
  ZYBH?: string;
  BJMC?: string;
  BJBH?: string;
  [key: string]: unknown;
}

/** 当前学期（`/CommonController/xqOpthions` 的 `xqOptions`） */
export interface CurrentSemester {
  XQH?: string;
  /** 如 "2026年秋季" */
  XQMC?: string;
  /** 如 "2026-2027年度第一学期" */
  BZXQMC?: string;
  QSRQ?: string;
  JSRQ?: string;
  QMKSZC?: number | null;
  QZKSZC?: number | null;
  [key: string]: unknown;
}

/** 可选学期（`/CommonController/getXqList` 返回项） */
export interface ExamSemester {
  XQH?: string;
  /** 如 "2026-2027年度第一学期" */
  XQMC?: string;
  /** 如 "2026年秋季" */
  JDXQMC?: string;
  QSRQ?: string;
  JSRQ?: string;
  [key: string]: unknown;
}

/** 一场考试（`/ksapController/getStuKsxx` 返回项，字段为服务端原文） */
export interface ExamSchedule {
  /** 学期号 */
  XQH?: string;
  /** 学期名，如 "2026年秋季" */
  XQMC?: string;
  /** 课程编号 */
  KCBH?: string;
  /** 课程名称 */
  KCMC?: string;
  /** 课堂编号 */
  KTBH?: string;
  /** 考试日期与时段，如 "2026-12-05 下午" */
  KSRQ?: string;
  /** 考试地点（教室），可能为 null */
  JSMC?: string | null;
  /** 开课 / 考试学院 */
  DWMC?: string;
  PKDW?: string;
  SFID?: string;
  XM?: string;
  /** 考试类型，见 {@link EXAM_TYPE} */
  KSLX?: string | number;
  /** 综合上课周次 */
  ZHSKZC?: number | null;
  SCHEDULEID?: string | null;
  [key: string]: unknown;
}

export interface ExamQuery {
  /** 学期号，如 "20261"；不传则取当前学期 */
  xqh?: string;
  /** 课程名模糊筛选 */
  kcmc?: string | null;
  /** 考试类型，见 {@link EXAM_TYPE}，默认 `1`（普通考试） */
  kslx?: number | string;
  pageIndex?: number;
  pageSize?: number;
}

/** PageHelper 风格分页结果 */
export interface ExamPage {
  list: ExamSchedule[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  [key: string]: unknown;
}

/* ------------------------------- 空闲教室查询 ------------------------------- */

/** 教学楼（`/CommonController/jslOpthions` 返回项） */
export interface TeachingBuilding {
  /** 教学楼编号，作为 `getFreeClassrooms({ building })` 的入参 */
  JXLBH?: string;
  /** 教学楼名称，如 "西五楼" */
  JXLMC?: string;
  /** 楼层数 */
  JXLLC?: number | null;
  /** 楼栋编号 */
  LDBH?: string;
  /** 校区代码 */
  XQ?: string;
  /** 是否可借用（"0" 等） */
  JXLSFKY?: string | null;
  [key: string]: unknown;
}

/** 某日期所处的教学周（`/LsController/finddqzc`） */
export interface CurrentWeek {
  /** 标准日期（服务端原文 `BZSJ`） */
  BZSJ?: string;
  /** 教学周次 */
  ZC?: number;
  /** 星期（1–7） */
  XQ?: number;
  [key: string]: unknown;
}

/** 某教学周内的一天（`/LsController/queryrqByXqhzc` 返回项） */
export interface WeekDay {
  /** 星期（1–7） */
  xq?: number;
  /** 对应日期，如 "2026-09-14" */
  rq?: string;
  [key: string]: unknown;
}

/** 一间空闲教室（`/kxjsController/selectFreeRoom` 的 `dataList` 项） */
export interface FreeRoom {
  /** 教室编号，如 "C05002002" */
  JSBH?: string;
  /** 教室名称，如 "202教室" */
  JSMC?: string;
  /** 教学楼编号 */
  JXLBH?: string;
  /** 所在楼层 */
  SZLC?: number | null;
  /** 教室容量（座位数） */
  JSRL?: number | null;
  /** 单位编号 */
  DWBH?: string;
  [key: string]: unknown;
}

/** 空闲教室查询结果（整体即服务端原始对象） */
export interface FreeRoomResult {
  /** 日期，如 "2026-09-18" */
  borrowDate?: string;
  building?: string;
  buildingCode?: string;
  buildingText?: string;
  /** 教学楼编号 */
  jxlbh?: string;
  /** 头部提示，如 "2026秋季学期- 张三(U2025xxxxx)" */
  str?: string;
  dataList: FreeRoom[];
  [key: string]: unknown;
}

export interface FreeRoomQuery {
  /** 日期 `sj`，格式 `YYYY-MM-DD`，可用 {@link WeekDay} 的 `rq` */
  date: string;
  /** 教学楼编号 `jxlbh`，见 {@link TeachingBuilding.JXLBH} */
  building: string;
  /** 起始节次 `qsjcp`，默认 1 */
  startPeriod?: number;
  /** 结束节次 `jsjcp`，默认 2 */
  endPeriod?: number;
}

/** 成绩 API：`client.mhub` */
export class MhubApi {
  private readonly runtime: ClientRuntime;
  private terms?: GradeTerm[];

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(MHUB_SESSION_COOKIE, MHUB_HOST);
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(mhubService, mhubUrl(path), config);
  }

  async getTerms(): Promise<GradeTerm[]> {
    if (!this.terms) {
      const response = await this.request<string>("/CjcxController/fianCjInfo");
      this.terms = parseGradeTerms(String(response.data));
    }
    return this.terms;
  }

  async getGrades(options: { xn?: string; xq?: number } = {}): Promise<Grades> {
    let xn = options.xn;
    if (!xn) {
      const terms = await this.getTerms();
      xn = terms[0]?.XN;
    }
    if (!xn) throw new Error("无法确定学年 xn，请显式传入 getGrades({ xn })");

    const xq = options.xq ?? 0;
    const response = await this.request<string>(
      `/CjcxController/fianCjInfo?xn=${encodeURIComponent(xn)}&xq=${xq}`,
      { headers: { Referer: `${MHUB_BASE}/CjcxController/fianCjInfo?xn=${xn}&xq=1` } },
    );
    return parseGrades(String(response.data), xn, xq);
  }

  /* ----------------------------- 学业考试查询 ----------------------------- */

  private static parseJson<T>(data: unknown): T {
    return (typeof data === "string" ? JSON.parse(data) : data) as T;
  }

  /** 考试查询页的学生信息（姓名、学号、学院、专业、班级） */
  async getExamUser(): Promise<ExamUser> {
    const response = await this.request<ExamUser>("/CommonController/userList", {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    return MhubApi.parseJson<ExamUser>(response.data) ?? {};
  }

  /** 当前学期（`XQH` 学期号 / `XQMC` 学期名 / 考试周次等） */
  async getExamCurrentSemester(): Promise<CurrentSemester> {
    const response = await this.request<{ xqOptions?: CurrentSemester }>(
      "/CommonController/xqOpthions",
      { responseType: "json", headers: { Accept: "application/json, text/plain, */*" } },
    );
    const body = MhubApi.parseJson<{ xqOptions?: CurrentSemester }>(response.data);
    return body?.xqOptions ?? {};
  }

  /** 可选学期列表（按时间倒序） */
  async getExamSemesters(): Promise<ExamSemester[]> {
    const response = await this.request<ExamSemester[]>("/CommonController/getXqList", {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body = MhubApi.parseJson<ExamSemester[]>(response.data);
    return Array.isArray(body) ? body : [];
  }

  /**
   * 学业考试查询（`POST /ksapController/getStuKsxx`）。
   * 不传 `xqh` 时自动取当前学期；返回 PageHelper 风格分页对象。
   */
  async getStudentExams(options: ExamQuery = {}): Promise<ExamPage> {
    let xqh = options.xqh;
    if (!xqh) xqh = (await this.getExamCurrentSemester()).XQH;
    if (!xqh) throw new Error("mhub: 无法确定学期号 xqh");

    const response = await this.request<ExamPage>("/ksapController/getStuKsxx", {
      method: "POST",
      responseType: "json",
      data: {
        pageIndex: options.pageIndex ?? 1,
        pageSize: options.pageSize ?? 100,
        kslx: String(options.kslx ?? EXAM_TYPE.NORMAL),
        kcmc: options.kcmc ?? null,
        xqh,
      },
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        Referer: `${MHUB_BASE}/ksapController/urlUserKs`,
      },
    });

    const body = MhubApi.parseJson<ExamPage & { code?: number; message?: string }>(response.data);
    if (body && typeof body.code === "number" && body.code !== 200) {
      throw new Error(`mhub 考试接口失败(${body.code}): ${body.message ?? "未知错误"}`);
    }
    return { ...body, list: Array.isArray(body?.list) ? body.list : [] } as ExamPage;
  }

  /** 自动翻页遍历全部考试安排 */
  async *iterateStudentExams(options: ExamQuery = {}): AsyncGenerator<ExamSchedule> {
    let pageIndex = options.pageIndex ?? 1;
    const pageSize = options.pageSize ?? 100;
    while (true) {
      const page = await this.getStudentExams({ ...options, pageIndex, pageSize });
      for (const item of page.list) yield item;
      if (!page.hasNextPage || page.list.length === 0) break;
      pageIndex += 1;
    }
  }

  /* ----------------------------- 空闲教室查询 ----------------------------- */

  /** 可查询的教学楼列表（含编号 `JXLBH` 与名称 `JXLMC`） */
  async getTeachingBuildings(): Promise<TeachingBuilding[]> {
    const response = await this.request<{ jslOpthions?: TeachingBuilding[] }>(
      "/CommonController/jslOpthions",
      { responseType: "json", headers: { Accept: "application/json, text/plain, */*" } },
    );
    const body = MhubApi.parseJson<{ jslOpthions?: TeachingBuilding[] }>(response.data);
    return Array.isArray(body?.jslOpthions) ? body.jslOpthions : [];
  }

  /** 某日期所在的教学周次与星期（`GET /LsController/finddqzc`） */
  async getWeekByDate(xqh: string, rq: string): Promise<CurrentWeek> {
    const params = new URLSearchParams({ xqh, rq });
    const response = await this.request<CurrentWeek>(`/LsController/finddqzc?${params}`, {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    return MhubApi.parseJson<CurrentWeek>(response.data) ?? {};
  }

  /** 某学期第 `zc` 周周一到周日的日期（`GET /LsController/queryrqByXqhzc`） */
  async getWeekDates(xqh: string, zc: number | string): Promise<WeekDay[]> {
    const params = new URLSearchParams({ xqh, zc: String(zc) });
    const response = await this.request<WeekDay[]>(`/LsController/queryrqByXqhzc?${params}`, {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body = MhubApi.parseJson<WeekDay[]>(response.data);
    return Array.isArray(body) ? body : [];
  }

  /**
   * 空闲教室查询（`GET /kxjsController/selectFreeRoom`）。
   * 需指定日期、教学楼编号与节次区间（`startPeriod`–`endPeriod`，默认 1–2 节）。
   */
  async getFreeClassrooms(query: FreeRoomQuery): Promise<FreeRoomResult> {
    const params = new URLSearchParams({
      sj: query.date,
      jxlbh: query.building,
      qsjcp: String(query.startPeriod ?? 1),
      jsjcp: String(query.endPeriod ?? 2),
    });
    const response = await this.request<FreeRoomResult>(
      `/kxjsController/selectFreeRoom?${params}`,
      {
        responseType: "json",
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: `${MHUB_BASE}/kxjsPageController/by-sy`,
        },
      },
    );
    const body = MhubApi.parseJson<FreeRoomResult>(response.data);
    return { ...body, dataList: Array.isArray(body?.dataList) ? body.dataList : [] };
  }
}
