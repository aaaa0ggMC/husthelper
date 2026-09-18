import type { AxiosResponse } from "axios";
import type { CasResponse, CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 体育教学管理系统（pejxgl.hust.edu.cn）。
 *
 * 和 mhub / hkwxy 一样是普通 CAS 应用：登录页上的「统一身份认证」链接
 * `GET /cas/auth` 会 302 到 `pass.hust.edu.cn/cas/login?service=.../cas/auth`，
 * 兑换 ticket 后由 pejxgl 下发自己的 `JSESSIONID`。之后所有学生接口都复用该会话。
 *
 * 会话失效时 pejxgl 会跳到**自身**的 `/login`（不是 CAS 的 `/cas/login`），
 * 因此需要自定义 `isLoginRedirect` 才能触发自动续期。
 */

export const PEJXGL_HOST = "pejxgl.hust.edu.cn";
export const PEJXGL_BASE = `https://${PEJXGL_HOST}`;
/** 传给 CAS 的 service：登录页「统一身份认证」入口 */
export const PEJXGL_SERVICE = `${PEJXGL_BASE}/cas/auth`;
export const PEJXGL_SESSION_COOKIE = "JSESSIONID";

/** 体育系统会跳到自身的 /login，需与 CAS 重定向一起识别 */
export function isPejxglLoginRedirect(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    /\/login(?:[?#]|$)/.test(location)
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  const body = typeof response.data === "string" ? response.data : "";
  return contentType.includes("text/html") && body.includes('href="/cas/auth"');
}

/** 体育教学管理系统作为 CAS 应用的声明 */
export const pejxglService: CasService = {
  name: "pejxgl",
  host: PEJXGL_HOST,
  base: PEJXGL_BASE,
  service: PEJXGL_SERVICE,
  sessionCookie: PEJXGL_SESSION_COOKIE,
  isLoginRedirect: isPejxglLoginRedirect,
};

export function pejxglUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${PEJXGL_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 一个学期（`/simpleSemester/:type` 返回项） */
export interface PeSemester {
  /** 学期号，如 "20261" */
  xqh?: string;
  /** 学期名称，如 "2026年秋季" */
  xqmc?: string;
  /** 周数（当前接口恒为 null） */
  weeks?: number | null;
  /** 是否为当前学期（1 是，0 否） */
  dqxq?: number;
  [key: string]: unknown;
}

/**
 * 某个学期的课外锻炼次数统计（`number-of-engagements` 返回项）。
 * 字段名为服务端原文，全部可选，对象本身即服务端原始 JSON。
 */
export interface ExerciseEngagement {
  /** 学期号，如 "20252" */
  xqh?: string;
  /** 学号（服务端字段名 `sfid`） */
  sfid?: string;
  /** 华中大体育 APP 次数 */
  hzdtycs?: number;
  /** 辅导班次数 */
  fdbcs?: number;
  /** 促进课次数 */
  cjkcs?: number;
  /** 普通生代表队训练次数 */
  ptsdbtcs?: number;
  /** 体育赛事参与次数 */
  tysscs?: number;
  /** 场馆锻炼次数 */
  cgdlcs?: number;
  /** 总次数 */
  zcs?: number;
  [key: string]: unknown;
}

/**
 * 一门已修 / 已选体育课（`courses_taken/list` 返回项）。
 * 字段名为服务端原文，全部可选，对象本身即服务端原始 JSON。
 */
export interface TakenCourse {
  /** 学期号，如 "20251" */
  xqh?: string;
  /** 学期名称，如 "2025年秋季" */
  xqmc?: string;
  /** 课程编号 */
  kcbh?: string;
  /** 课程名称 */
  kcmc?: string;
  /** 总学时 */
  kczxs?: number;
  /** 总学分 */
  kczxf?: number;
  /** 百分制成绩；未出分（如「已选」）时为 null */
  bfzcj?: number | null;
  /** 成绩状态：`正常` / `补考` / `重修` / `已选`（已选为未来学期） */
  cjzt?: string;
  /** 授课教师，多人以逗号分隔 */
  skjs?: string;
  [key: string]: unknown;
}

/** 体育教学管理系统 API：`client.pejxgl` */
export class PejxglApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(PEJXGL_SESSION_COOKIE, PEJXGL_HOST);
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(pejxglService, pejxglUrl(path), config);
  }

  /**
   * 学期列表（默认 `type=8`，即「学期号/学期名」下拉框的数据源）。
   * 返回按时间倒序，第一项为最新学期。
   */
  async getSemesters(type: number | string = 8): Promise<PeSemester[]> {
    const response = await this.request<PeSemester[]>(`/simpleSemester/${type}`, {
      responseType: "json",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body = parseJson<PeSemester[]>(response.data);
    return Array.isArray(body) ? body : [];
  }

  /**
   * 学期课外锻炼次数。`xqh` 为学期号（如 `"20261"`，可用 {@link getSemesters} 获取）。
   *
   * 注意：次数由体育系统在**学期末**汇总，学期进行中查询通常返回空数组 `[]`，
   * 属正常现象（历史学期可正常返回数据）。
   */
  async getNumberOfEngagements(xqh: string): Promise<ExerciseEngagement[]> {
    const response = await this.request<ExerciseEngagement[]>(
      `/student/extracurricular-exercise/${encodeURIComponent(xqh)}/number-of-engagements`,
      {
        responseType: "json",
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: `${PEJXGL_BASE}/student/extracurricular-exercise`,
        },
      },
    );
    const body = parseJson<ExerciseEngagement[]>(response.data);
    return Array.isArray(body) ? body : [];
  }

  /**
   * 已修 / 已选体育课列表（跨全部学期，无参数）。
   *
   * 含尚未出分的「已选」课程（`bfzcj` 为 `null`、`cjzt` 为 `"已选"`），
   * 因此也可用于查看未来学期已选课程。
   */
  async getCoursesTaken(): Promise<TakenCourse[]> {
    const response = await this.request<TakenCourse[]>("/student/courses_taken/list", {
      responseType: "json",
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: `${PEJXGL_BASE}/student/courses_taken`,
      },
    });
    const body = parseJson<TakenCourse[]>(response.data);
    return Array.isArray(body) ? body : [];
  }
}

function parseJson<T>(data: unknown): T {
  return (typeof data === "string" ? JSON.parse(data) : data) as T;
}
