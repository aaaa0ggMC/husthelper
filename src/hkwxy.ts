import type { AxiosResponse } from "axios";
import type { CasResponse, CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

export const HKWXY_HOST = "hkwxy.hust.edu.cn";
export const HKWXY_BASE = `https://${HKWXY_HOST}/tp_up`;
export const HKWXY_SERVICE = `${HKWXY_BASE}/v2?m=up`;
export const HKWXY_SESSION_COOKIE = "JSESSIONID";

/** 智慧校园（hkwxy）作为 CAS 应用的声明 */
export const hkwxyService: CasService = {
  name: "hkwxy",
  host: HKWXY_HOST,
  base: HKWXY_BASE,
  service: HKWXY_SERVICE,
  sessionCookie: HKWXY_SESSION_COOKIE,
};

/* ------------------------- 微校园 / 服务大厅（tp_wp） ------------------------- */

/**
 * hkwxy 下另一个 CAS 应用 `tp_wp`（微校园），与 `tp_up` 是**不同的 service**：
 * 未登录访问 `/tp_wp/*` 会 302 到 `/tp_wp/403`，后者再 302 到
 * `pass.hust.edu.cn/cas/login?service=https://hkwxy.hust.edu.cn/tp_wp/403`。
 * 换票后拿到 hkwxy 的 `JSESSIONID`，即可访问 `/tp_wp/service-center/<id>`（服务大厅主界面）。
 */
export const HKWXY_WP_BASE = `https://${HKWXY_HOST}/tp_wp`;
export const HKWXY_WP_SERVICE = `${HKWXY_WP_BASE}/403`;
/** 服务大厅（主界面）页面 id（实测固定值） */
export const HKWXY_SERVICE_CENTER_ID = "f7d79779c3fe4e2aa714ec0c5693ecb6";

/** tp_wp 的失效判定：跳到 `/tp_wp/403` 或 CAS */
export function isHkwxyWpLoginRedirect(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    (location.includes("/tp_wp/403") || location.includes("/cas/login"))
  ) {
    return true;
  }
  const body = typeof response.data === "string" ? response.data : "";
  return body.includes("top.location.href") && body.includes("/cas/login");
}

/** 微校园（tp_wp）作为 CAS 应用的声明 */
export const hkwxyWpService: CasService = {
  name: "hkwxy-tp_wp",
  host: HKWXY_HOST,
  base: HKWXY_WP_BASE,
  service: HKWXY_WP_SERVICE,
  sessionCookie: HKWXY_SESSION_COOKIE,
  isLoginRedirect: isHkwxyWpLoginRedirect,
};

export function hkwxyWpUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${HKWXY_WP_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 服务大厅里的一个服务入口 */
export interface ServiceItem {
  /** 服务项 id（页面里 anchor 的 id） */
  id?: string;
  /** 服务名，如 "课程平台" */
  name: string;
  /** 跳转地址 */
  url: string;
  /** 图标地址 */
  icon?: string;
}

/** 服务大厅里的一个分组，如「课程」「考试」 */
export interface ServiceGroup {
  name: string;
  items: ServiceItem[];
}

/** 服务大厅的一个大类，如「教育教学」「场所」 */
export interface ServiceSection {
  name: string;
  groups: ServiceGroup[];
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析服务大厅（主界面）HTML 为「大类 → 分组 → 服务」结构 */
export function parseServiceCenter(html: string): ServiceSection[] {
  const sections: ServiceSection[] = [];
  const parts = html.split(/<div class="financial-se-title">/).slice(1);

  for (const part of parts) {
    const name = cleanText(part.match(/<div class="text-box">([\s\S]*?)<\/div>/)?.[1] ?? "");
    if (!name) continue;

    const groups: ServiceGroup[] = [];
    for (const block of part.split(/<li class="financial-se-block"/).slice(1)) {
      const groupName = cleanText(
        block.match(/<div class="title-box-row">([\s\S]*?)<\/div>/)?.[1] ?? "",
      );

      const items: ServiceItem[] = [];
      const itemRe = /<a class="apps-item"[^>]*>/g;
      for (let match = itemRe.exec(block); match; match = itemRe.exec(block)) {
        const tag = match[0];
        const url = tag.match(/href="([^"]*)"/)?.[1];
        if (!url) continue;

        const after = block.slice(match.index + tag.length);
        items.push({
          id: tag.match(/\bid="([^"]*)"/)?.[1],
          name: cleanText(after.match(/<font class="text">([\s\S]*?)<\/font>/)?.[1] ?? ""),
          url,
          icon: after.match(/<img src="([^"]*)"/)?.[1],
        });
      }

      if (groupName || items.length > 0) groups.push({ name: groupName, items });
    }

    sections.push({ name, groups });
  }

  return sections;
}

export interface OnlineDevice {
  userIpv4: string;
  userIpv6: string[];
  onlineTime: string;
  raw: Record<string, unknown>;
}

export function hkwxyUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${HKWXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function parseOnlineDevices(data: unknown): OnlineDevice[] {
  if (!Array.isArray(data)) {
    const detail =
      data && typeof data === "object"
        ? String(
            (data as Record<string, unknown>).msg ??
              (data as Record<string, unknown>).message ??
              (data as Record<string, unknown>).errmsg ??
              (data as Record<string, unknown>).error ??
              JSON.stringify(data),
          )
        : String(data);
    throw new Error(`在线设备接口返回异常: ${detail.slice(0, 200)}`);
  }

  return data.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const ipv6 = typeof raw.userIpv6 === "string" ? raw.userIpv6 : "";
    return {
      userIpv4: String(raw.userIpv4 ?? ""),
      userIpv6: ipv6
        ? ipv6
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      onlineTime: String(raw.onlineTime ?? ""),
      raw,
    };
  });
}

/** 智慧校园（在线设备）API：`client.hkwxy` */
export class HkwxyApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(HKWXY_SESSION_COOKIE, HKWXY_HOST);
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(hkwxyService, hkwxyUrl(path), config);
  }

  /** 请求微校园 `tp_wp` 应用（服务大厅等） */
  requestWp<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(hkwxyWpService, hkwxyWpUrl(path), config);
  }

  async getOnlineDevices(): Promise<OnlineDevice[]> {
    const response = await this.request<string>("/apps/campusNetwork/onlineDevices", {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: hkwxyUrl("/apps/campusNetwork/onlineDevices?item_id=undefined"),
      },
    });

    const body = String(response.data);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      const hint = /无权限|权限|forbidden|denied/i.test(body) ? "（无权限）" : "";
      throw new Error(`在线设备返回了非 JSON 数据${hint}: ${body.slice(0, 160)}`);
    }
    return parseOnlineDevices(json);
  }

  /**
   * 微校园服务大厅主界面（`/tp_wp/service-center/<id>`）。
   * 返回「大类 → 分组 → 服务」结构；`id` 默认 {@link HKWXY_SERVICE_CENTER_ID}。
   */
  async getServiceCenter(id: string = HKWXY_SERVICE_CENTER_ID): Promise<ServiceSection[]> {
    const response = await this.requestWp<string>(`/service-center/${encodeURIComponent(id)}`, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: hkwxyWpUrl("/"),
      },
    });
    return parseServiceCenter(String(response.data));
  }
}
