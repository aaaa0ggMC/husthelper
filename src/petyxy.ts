import type { AxiosResponse } from "axios";
import {
  isCasLoginResponse,
  requestCasTicket,
  type CasLoginProvider,
  type CasResponse,
  type CasService,
} from "./cas.ts";
import type { RequestOptions, Session } from "./http.ts";
import { defaultLogger, type Logger } from "./logger.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 华中大体育（petyxy.hust.edu.cn）。
 *
 * 它是多个体育子应用的统一入口，登录走企业微信/自建 SSO：CAS 的 service 恒为
 * `http://petyxy.hust.edu.cn/ggtypt/dologin`，登录成功后由 `ggtypt` 向「目标应用」
 * 追加一次性 UUID ticket 并 302 过去（如 `/pft/app/index?ticket=...`），目标应用
 * 校验 ticket 后建立自己的 `JSESSIONID`。场馆服务（pecg）也复用这条链路。
 *
 * 完整链路（全部由 CASTGC 驱动，无需企业微信）：
 * 1. GET  petyxy /ggtypt/login?service=<target>  → 200（JS 跳转 CAS），种下 /ggtypt 会话
 * 2. GET  pass   /cas/login?service=<dologin>    → 302 petyxy /ggtypt/dologin?ticket=ST-...
 * 3. GET  petyxy /ggtypt/dologin?ticket=ST       → 302 /ggtypt/dologin（自身）
 * 4. GET  petyxy /ggtypt/dologin                 → 302 <target>?ticket=<uuid>
 * 5. GET  <target>?ticket=<uuid>                 → 目标应用会话就绪
 */

export const PETYXY_HOST = "petyxy.hust.edu.cn";
export const PETYXY_BASE = `http://${PETYXY_HOST}`;
export const PETYXY_LOGIN = `${PETYXY_BASE}/ggtypt/login`;
export const PETYXY_DOLOGIN = `${PETYXY_BASE}/ggtypt/dologin`;
/** 华中大体育首页（体质测试等 /pft 应用的登录目标） */
export const PETYXY_PFT_INDEX = `${PETYXY_BASE}/pft/app/index`;
export const PETYXY_SESSION_COOKIE = "JSESSIONID";

/** 传给 CAS 的 service：petyxy 的登录兑换端点 */
export const petyxyCasService: CasService = {
  name: "petyxy",
  host: PETYXY_HOST,
  base: PETYXY_BASE,
  service: PETYXY_DOLOGIN,
  sessionCookie: PETYXY_SESSION_COOKIE,
};

export function petyxyUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${PETYXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 会话失效判定：被重定向到 `/ggtypt/login` */
export function isPetyxyLoginResponse(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    location.includes("/ggtypt/login")
  ) {
    return true;
  }
  const body = typeof response.data === "string" ? response.data : "";
  return body.includes("location.href") && body.includes("/ggtypt/login");
}

/**
 * 为任意 petyxy 目标应用建立会话（写入共享 cookie jar）。
 * `target` 是目标应用入口（会作为 CAS `service` 的 service 参数落库）。
 * 优先用 CASTGC 免密；失败才执行登录方式序列（`login` 惰性求值）。
 */
export async function acquirePetyxySession(
  session: Session,
  target: string,
  login: CasLoginProvider,
  logger: Logger = defaultLogger,
): Promise<void> {
  logger.info("petyxy: SSO 登录");

  // 直接以目标为 service 发起，避免预先访问目标而占用其会话 cookie
  const loginUrl = `${PETYXY_LOGIN}?service=${encodeURIComponent(target)}`;
  await session.get<string>(loginUrl, { responseType: "text" });

  let ticket = await requestCasTicket(session, petyxyCasService, logger);
  if (!ticket) {
    logger.warn("petyxy: CASTGC 缺失或失效，回退登录方式序列");
    ticket = await login(petyxyCasService.service);
  }

  let current = new URL(ticket, PETYXY_BASE).toString();
  for (let hop = 0; hop < 12; hop++) {
    const response = await session.get<string>(current, { responseType: "text" });
    const next = response.headers["location"];
    if (response.status >= 300 && response.status < 400 && typeof next === "string") {
      // Tomcat 在未确认 cookie 支持时会重写成 `...;jsessionid=xxx`，部分路由不认该矩阵参数
      current = new URL(next, current).toString().replace(/;jsessionid=[^/?#]*/i, "");
      continue;
    }
    if (isCasLoginResponse(response)) throw new Error("petyxy: SSO 过程中被要求重新登录 CAS");
    break;
  }
}

/* ------------------------------- 体质测试成绩 ------------------------------- */

/** 可选体测学期（`resultList` 页面内嵌的 picker 数据） */
export interface FitnessPeriod {
  /** 用作 `periodId` 的值，如 20252 */
  value: number | string;
  /** 显示名，如 "2025-2026学年第二学期" */
  text: string;
}

/** 一个体测项目 */
export interface FitnessItem {
  /** 项目名，如 身高 / BMI / 1000米 */
  name: string;
  /** 原始数值文本（可能含单位或时间），如 "174.8 cm"、"4'02"、"26.3" */
  value?: string;
  /** 评价：良好 / 及格 / 超重 / 不及格 ... */
  grade?: string;
  /** 单项得分（页面里 `/xx` 的部分） */
  score?: number;
  /** 原始 `<li>` 片段 */
  raw: string;
}

/** 某学期的体测成绩 */
export interface FitnessResult {
  /** 请求的学期号（未显式传入时为 undefined） */
  periodId?: string;
  /** 页面展示的学期名，如 "2025-2026学年第二学期" */
  periodName?: string;
  /** 体测状态，如 缺项 / 完成 */
  status?: string;
  /** 各项目（不含「体测状态」「总分」） */
  items: FitnessItem[];
  /** 总分 */
  totalScore?: number;
  /** 总分评价 */
  totalGrade?: string;
  /** 可选学期列表 */
  periods: FitnessPeriod[];
  /** 原始 HTML */
  raw: string;
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItemRight(text: string): { value?: string; score?: number } {
  const clean = cleanText(text);
  const match = clean.match(/^([^/]+?)\s*\/\s*(\d+)/);
  if (match) return { value: match[1].trim() || undefined, score: Number(match[2]) };
  return { value: clean || undefined };
}

/** 解析 `resultList` 返回的服务端渲染页面 */
export function parseFitnessResult(html: string, periodId?: string | number): FitnessResult {
  const picker = html.match(/setData\(\s*(\[[\s\S]*?\])\s*\)/);
  let periods: FitnessPeriod[] = [];
  if (picker) {
    try {
      periods = (JSON.parse(picker[1]) as { text?: string; value?: number | string }[])
        .filter((item) => item && item.value !== undefined)
        .map((item) => ({ value: item.value as number | string, text: item.text ?? String(item.value) }));
    } catch {
      periods = [];
    }
  }

  const periodName = html.match(/id="pickerBtn">\s*([\s\S]*?)\s*<i/)?.[1];

  const result: FitnessResult = {
    periodId: periodId !== undefined ? String(periodId) : undefined,
    periodName: periodName ? cleanText(periodName) : undefined,
    items: [],
    periods,
    raw: html,
  };

  const blocks = html.split(/<li class="cgCellItem/).slice(1);
  for (const block of blocks) {
    const label = block.match(
      /<div class="cgCellItemLabel">([\s\S]*?)(?=<div class="\s*(?:cgCellItemMain|cgCellItemRight))/,
    )?.[1];
    if (!label) continue;
    const name = cleanText(label);
    if (!name) continue;

    const grade = cleanText(
      block.match(/<span class="[^"]*sportTestStatus[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "",
    );
    const right = block.match(/<div class="[^"]*cgCellItemRight"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";

    if (name === "体测状态") {
      result.status = grade || cleanText(right) || undefined;
      continue;
    }

    const parsed = parseItemRight(right);
    if (name === "总分") {
      result.totalGrade = grade || undefined;
      const score = parsed.value !== undefined ? Number(parsed.value) : NaN;
      if (Number.isFinite(score)) result.totalScore = score;
      continue;
    }

    result.items.push({
      name,
      value: parsed.value,
      grade: grade || undefined,
      score: parsed.score,
      raw: `<li class="cgCellItem${block}`.split(/<\/ul>/i)[0],
    });
  }

  return result;
}

/** 华中大体育 API：`client.petyxy` */
export class PetyxyApi {
  private readonly runtime: ClientRuntime;
  private acquiring?: Promise<void>;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(PETYXY_SESSION_COOKIE, PETYXY_HOST);
  }

  private async ensureSession(force = false): Promise<Session> {
    const session = await this.runtime.ensureReady();
    // 按 /pft 路径检查，避免与 petyxy 下 /ggtypt 的同名 JSESSIONID 混淆
    if (!force && session.getCookie(PETYXY_SESSION_COOKIE, PETYXY_PFT_INDEX)) return session;

    if (!this.acquiring) {
      this.acquiring = acquirePetyxySession(
        session,
        PETYXY_PFT_INDEX,
        (serviceUrl) => this.runtime.loginFallback(serviceUrl, "petyxy"),
        this.runtime.logger,
      ).finally(() => {
        this.acquiring = undefined;
      });
    }
    await this.acquiring;
    this.runtime.save();
    return this.runtime.session()!;
  }

  async request<T = string>(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    const url = petyxyUrl(path);
    const send = async (force: boolean): Promise<AxiosResponse<T>> => {
      const session = await this.ensureSession(force);
      const { method, data, ...rest } = config;
      return method && method.toUpperCase() === "POST"
        ? session.post<T>(url, data, { responseType: "text", ...rest })
        : session.get<T>(url, { responseType: "text", ...rest });
    };

    let response = await send(false);
    if (isPetyxyLoginResponse(response)) {
      this.runtime.logger.warn("petyxy 会话已失效，重新获取");
      response = await send(true);
    }
    return response;
  }

  /**
   * 体质测试成绩。`periodId` 为学期号（如 `20252`），不传则取当前学期。
   * 返回整体结构，其中 `periods` 是页面内嵌的可选学期列表。
   */
  async getFitnessResult(periodId?: string | number): Promise<FitnessResult> {
    const path =
      periodId !== undefined
        ? `/pft/app/resultList?periodId=${encodeURIComponent(String(periodId))}`
        : "/pft/app/resultList";
    const response = await this.request<string>(path, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: PETYXY_PFT_INDEX,
      },
    });
    return parseFitnessResult(String(response.data), periodId);
  }

  /** 可选体测学期列表（默认取当前学期页面里内嵌的 picker 数据） */
  async getFitnessPeriods(): Promise<FitnessPeriod[]> {
    return (await this.getFitnessResult()).periods;
  }
}
