import type { AxiosResponse } from "axios";
import type { CasService } from "./cas.ts";
import type { RequestOptions } from "./http.ts";
import type { ClientRuntime } from "./runtime.ts";

export const WECHAT_HOST = "m.hust.edu.cn";
export const WECHAT_BASE = "http://m.hust.edu.cn/wechat";
export const WECHAT_SERVICE = `${WECHAT_BASE}/index.jsp`;
export const WECHAT_SESSION_COOKIE = "wechat_session_id";

/** 微校园（wechat）作为 CAS 应用的声明 */
export const wechatService: CasService = {
  name: "wechat",
  host: WECHAT_HOST,
  base: WECHAT_BASE,
  service: WECHAT_SERVICE,
  sessionCookie: WECHAT_SESSION_COOKIE,
  ticketHops: 5,
};

export function wechatUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `http://${WECHAT_HOST}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** 微校园 API：`client.wechat` */
export class WechatApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(WECHAT_SESSION_COOKIE, WECHAT_HOST);
  }

  async getSession(): Promise<{ sessionId: string; cookies: Record<string, string> }> {
    await this.runtime.ensureService(wechatService);
    return { sessionId: this.sessionId!, cookies: this.runtime.cookiesFor(WECHAT_HOST) };
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(wechatService, wechatUrl(path), config);
  }

  async getAppsCenter(): Promise<string> {
    const response = await this.request<string>("/wechat/apps_center.jsp");
    return String(response.data);
  }
}
