import { CAS_LOGIN } from "./auth.ts";
import { Session, type RequestOptions } from "./http.ts";
import type { Logger } from "./logger.ts";

export const WECHAT_HOST = "m.hust.edu.cn";
export const WECHAT_BASE = "http://m.hust.edu.cn/wechat";
export const WECHAT_SERVICE = `${WECHAT_BASE}/index.jsp`;
export const WECHAT_SESSION_COOKIE = "wechat_session_id";

export function wechatUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `http://${WECHAT_HOST}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function isWechatLoginRedirect(response: {
  status: number;
  headers: Record<string, unknown>;
  data?: unknown;
}): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    location.includes("/cas/login")
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  const body = typeof response.data === "string" ? response.data : "";
  return contentType.includes("text/html") && body.includes('name="_eventId"');
}

export async function acquireWechatSession(session: Session, logger?: Logger): Promise<void> {
  const loginUrl = `${CAS_LOGIN}?service=${encodeURIComponent(WECHAT_SERVICE)}`;
  let response = await session.get<string>(loginUrl, { responseType: "text" });

  const ticket = response.headers["location"] as string | undefined;
  if (!(response.status >= 300 && response.status < 400 && ticket?.includes("ticket="))) {
    throw new Error("wechat: CAS 未返回 ticket，CASTGC 可能已失效");
  }

  let current = new URL(ticket, WECHAT_BASE).toString();
  for (let hop = 0; hop < 5 && current; hop++) {
    response = await session.get<string>(current, {
      responseType: "text",
      omitCookies: hop === 0,
    });
    const next = response.headers["location"] as string | undefined;
    if (response.status >= 300 && response.status < 400 && next) {
      current = new URL(next, current).toString();
      continue;
    }
    break;
  }

  if (!session.getCookie(WECHAT_SESSION_COOKIE, WECHAT_HOST)) {
    throw new Error("wechat: 未拿到 wechat_session_id");
  }
  logger?.info("wechat 会话获取成功");
}
