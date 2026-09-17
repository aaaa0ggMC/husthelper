import { CAS_LOGIN } from "./auth.ts";
import { Session } from "./http.ts";
import type { Logger } from "./logger.ts";

export const HKWXY_HOST = "hkwxy.hust.edu.cn";
export const HKWXY_BASE = "https://hkwxy.hust.edu.cn/tp_up";
export const HKWXY_SERVICE = `${HKWXY_BASE}/v2?m=up`;
export const HKWXY_SESSION_COOKIE = "JSESSIONID";

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

export function isHkwxyLoginRedirect(response: {
  status: number;
  headers: Record<string, unknown>;
}): boolean {
  const location = response.headers["location"];
  return (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    location.includes("/cas/login")
  );
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
    throw new Error(
      `在线设备接口返回异常: ${detail.slice(0, 200)}（该功能通常需要校园网环境）`,
    );
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

export async function acquireHkwxySession(session: Session, logger?: Logger): Promise<void> {
  const loginUrl = `${CAS_LOGIN}?service=${encodeURIComponent(HKWXY_SERVICE)}`;
  let response = await session.get<string>(loginUrl, { responseType: "text" });

  const ticket = response.headers["location"] as string | undefined;
  if (!(response.status >= 300 && response.status < 400 && ticket?.includes("ticket="))) {
    throw new Error("hkwxy: CAS 未返回 ticket，CASTGC 可能已失效");
  }

  let current = new URL(ticket, HKWXY_BASE).toString();
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

  if (!session.getCookie(HKWXY_SESSION_COOKIE, HKWXY_HOST)) {
    throw new Error("hkwxy: 未拿到 JSESSIONID");
  }
  logger?.info("hkwxy 会话获取成功");
}
