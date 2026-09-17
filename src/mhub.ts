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
}
