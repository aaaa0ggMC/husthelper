import type { AxiosResponse } from "axios";
import type { CasResponse, LoginContextProvider } from "./cas.ts";
import type { RequestOptions, Session } from "./http.ts";
import { defaultLogger, type Logger } from "./logger.ts";
import { acquirePetyxySession } from "./petyxy.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 场馆服务（pecg.hust.edu.cn）。
 *
 * 它不直接面向 CAS，而是复用「华中大体育」（petyxy.hust.edu.cn）的 SSO：
 * CAS 的 service 恒为 `petyxy /ggtypt/dologin`，最终由 pecg 侧入口
 * `/cggl/appv2/loginto` 兑换自己的 `JSESSIONID`。完整链路见 `src/petyxy.ts`
 * 的 `acquirePetyxySession`；这里只把目标设为 pecg 的 loginto。
 */

export const PECG_HOST = "pecg.hust.edu.cn";
export const PECG_BASE = `https://${PECG_HOST}`;
export const PECG_SESSION_COOKIE = "JSESSIONID";
/** 场馆应用入口：负责把 petyxy 的 SSO 结果兑换成 pecg 会话 */
export const PECG_LOGINTO = `${PECG_BASE}/cggl/appv2/loginto`;

export function pecgUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${PECG_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 场馆服务里「请重新登陆！」的判定 */
export function isPecgLoginResponse(response: CasResponse): boolean {
  const body = typeof response.data === "string" ? response.data : "";
  if (body.includes("请重新登陆")) return true;

  const location = response.headers["location"];
  return (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    (location.includes("/ggtypt/login") || location.includes("/pft/app/index"))
  );
}

/**
 * 通过 petyxy SSO 为 pecg 建立会话（写入共享 cookie jar）。
 * 优先用 CASTGC 免密；失败才回退完整登录（`login` 惰性求值）。
 */
export async function acquirePecgSession(
  session: Session,
  login: LoginContextProvider,
  logger: Logger = defaultLogger,
): Promise<void> {
  await acquirePetyxySession(session, PECG_LOGINTO, login, logger);

  if (!session.getCookie(PECG_SESSION_COOKIE, PECG_LOGINTO)) {
    throw new Error("pecg: SSO 完成后仍未拿到 JSESSIONID");
  }
  logger.info("pecg 会话获取成功");
}

/** 一条场馆预约记录（由 `getMyReserveList` 的服务端渲染页面解析而来） */
export interface VenueReserve {
  /** 预约 ID（用于预约详情） */
  reserveId?: string;
  /** 场馆 / 场地名称，如 "(主校区)西区操场-西边网球场1小时场" */
  venue?: string;
  /** 使用时段，如 "2026-06-02 13:00-14:00" */
  useTime?: string;
  /** 预约场地，如 "1号场地" */
  court?: string;
  /** 订单状态：`已缴费` / `未成功` 等 */
  orderStatus?: string;
  /** 订单金额（元） */
  amount?: number;
  /** 支付状态：`已支付` / `未支付` */
  payStatus?: string;
  /** 下单时间，如 "2026-06-02 11:18:42" */
  orderTime?: string;
  /** 原始 `<div class="recordBox">` 片段 */
  raw: string;
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析 `getMyReserveList` 返回的服务端渲染页面为预约记录数组 */
export function parseReserveList(html: string): VenueReserve[] {
  const records: VenueReserve[] = [];
  const blocks = html.split(/<div class="recordBox/).slice(1);

  for (const block of blocks) {
    const reserveId = block.match(/reserveId=['"]?\s*\+?\s*(\d+)/)?.[1];
    const venue = block.match(/<div class="title"[^>]*>\s*<span>([\s\S]*?)<\/span>/)?.[1];

    const fields: Record<string, string> = {};
    const infoRe =
      /<div class="recordInfo"[^>]*>\s*<div>([\s\S]*?)<\/div>\s*<span[^>]*>([\s\S]*?)<\/span>/g;
    for (let match = infoRe.exec(block); match; match = infoRe.exec(block)) {
      fields[cleanText(match[1])] = cleanText(match[2]);
    }

    const amountRaw = fields["订单金额"];
    const amount = amountRaw !== undefined && amountRaw !== "" ? Number(amountRaw) : undefined;

    records.push({
      reserveId,
      venue: venue ? cleanText(venue) : undefined,
      useTime: fields["使用时段"] || undefined,
      court: fields["预约场地"] || undefined,
      orderStatus: fields["订单状态"] || undefined,
      amount: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
      payStatus: fields["支付状态"] || undefined,
      orderTime: fields["下单时间"] || undefined,
      raw: `<div class="recordBox${block}`.split(/<\/body>/i)[0],
    });
  }

  return records;
}

/** 场馆服务 API：`client.pecg` */
export class PecgApi {
  private readonly runtime: ClientRuntime;
  private acquiring?: Promise<void>;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(PECG_SESSION_COOKIE, PECG_HOST);
  }

  /** 确保 pecg 会话存在；`force` 时强制重走 SSO */
  private async ensureSession(force = false): Promise<Session> {
    const session = await this.runtime.ensureReady();
    // 按 /cggl 路径检查，避免与其他域/路径下的同名 JSESSIONID 混淆
    if (!force && session.getCookie(PECG_SESSION_COOKIE, PECG_LOGINTO)) return session;

    if (!this.acquiring) {
      this.acquiring = acquirePecgSession(
        session,
        () => this.runtime.loginContext(),
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
    const url = pecgUrl(path);
    const send = async (force: boolean): Promise<AxiosResponse<T>> => {
      const session = await this.ensureSession(force);
      const { method, data, ...rest } = config;
      return method && method.toUpperCase() === "POST"
        ? session.post<T>(url, data, { responseType: "text", ...rest })
        : session.get<T>(url, { responseType: "text", ...rest });
    };

    let response = await send(false);
    if (isPecgLoginResponse(response)) {
      this.runtime.logger.warn("pecg 会话已失效，重新获取");
      response = await send(true);
    }
    return response;
  }

  /**
   * 预约记录。服务端直接返回**预渲染 HTML**（非 JSON），本方法解析成结构化数组。
   * 未登录时页面为「请重新登陆！」，会自动重走 SSO 后重试一次。
   */
  async getMyReserveList(): Promise<VenueReserve[]> {
    const response = await this.request<string>("/cggl/appv2/getMyReserveList", {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${PECG_BASE}/cggl/appv2/home`,
      },
    });
    return parseReserveList(String(response.data));
  }
}
