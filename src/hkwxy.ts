import type { AxiosResponse } from "axios";
import type { CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

export const HKWXY_HOST = "hkwxy.hust.edu.cn";
export const HKWXY_BASE = "https://hkwxy.hust.edu.cn/tp_up";
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
}
