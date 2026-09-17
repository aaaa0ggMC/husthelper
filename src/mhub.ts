import { CAS_LOGIN } from "./auth.ts";
import { Session } from "./http.ts";
import type { Logger } from "./logger.ts";

export const MHUB_HOST = "mhub.hust.edu.cn";
export const MHUB_BASE = "http://mhub.hust.edu.cn";
export const MHUB_SERVICE = `${MHUB_BASE}/cas/login?redirectUrl=/CjcxController/fianCjInfo`;
export const MHUB_SESSION_COOKIE = "JSESSIONID";

export function mhubUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${MHUB_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function isMhubLoginRedirect(response: {
  status: number;
  headers: Record<string, unknown>;
  data?: unknown;
}): boolean {
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
  return contentType.includes("text/html") && body.includes('/cas/login?redirectUrl=');
}

export async function acquireMhubSession(session: Session, logger?: Logger): Promise<void> {
  const loginUrl = `${CAS_LOGIN}?service=${encodeURIComponent(MHUB_SERVICE)}`;
  let response = await session.get<string>(loginUrl, { responseType: "text" });

  const ticket = response.headers["location"] as string | undefined;
  if (!(response.status >= 300 && response.status < 400 && ticket?.includes("ticket="))) {
    throw new Error("mhub: CAS 未返回 ticket，CASTGC 可能已失效");
  }

  let current = new URL(ticket, MHUB_BASE).toString();
  for (let hop = 0; hop < 8 && current; hop++) {
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

  if (!session.getCookie(MHUB_SESSION_COOKIE, MHUB_HOST)) {
    throw new Error("mhub: 未拿到 JSESSIONID");
  }
  logger?.info("mhub 会话获取成功");
}
