import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export interface RequestOptions extends AxiosRequestConfig {
  omitCookies?: boolean;
}

export interface Cookie {
  value: string;
  expiresAt?: number;
  session?: boolean;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

export type CookieInput = string | Cookie;
export type CookieStore = Record<string, Record<string, Cookie>>;
export type CookieStoreInput = Record<string, Record<string, CookieInput>>;

/** 内部存储带 cookie 名（同名不同 Path 的 cookie 需要并存） */
interface StoredCookie extends Cookie {
  name: string;
}

/** RFC 6265 path-match：请求路径是否适用该 cookie path */
function pathMatchesPath(requestPath: string, cookiePath: string): boolean {
  const path = cookiePath || "/";
  const request = requestPath || "/";
  if (request === path) return true;
  if (request.startsWith(path)) {
    if (path.endsWith("/")) return true;
    if (request.charAt(path.length) === "/") return true;
  }
  return false;
}

function urlPath(url: string): string {
  try {
    return new URL(url, "https://pass.hust.edu.cn").pathname || "/";
  } catch {
    return "/";
  }
}

function isUrl(value: string): boolean {
  return value.includes("://");
}

export class Session {
  readonly client: AxiosInstance;
  /** domain -> cookies（同一 domain 下允许同名不同 Path 并存） */
  private cookies = new Map<string, StoredCookie[]>();
  private onUpdate?: () => void;

  constructor(headers: Record<string, string> = {}) {
    this.client = axios.create({
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { "User-Agent": DEFAULT_UA, ...headers },
    });
  }

  private hostOf(url: string): string {
    return new URL(url, "https://pass.hust.edu.cn").hostname.toLowerCase();
  }

  private resolveHost(urlOrHost: string): string {
    return isUrl(urlOrHost) ? this.hostOf(urlOrHost) : urlOrHost.toLowerCase();
  }

  private matches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
  }

  private isExpired(cookie: Cookie): boolean {
    return cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now();
  }

  private jarOf(domain: string): StoredCookie[] {
    return this.cookies.get(domain) ?? [];
  }

  private replace(jar: StoredCookie[]): StoredCookie[] {
    return jar.filter((cookie) => !this.isExpired(cookie));
  }

  setCookie(
    name: string,
    value: string,
    domain: string,
    attributes: Omit<Cookie, "value"> = {},
  ): void {
    const key = domain.toLowerCase();
    const path = attributes.path ?? "/";
    const jar = this.jarOf(key).filter(
      (cookie) => !(cookie.name === name && (cookie.path ?? "/") === path),
    );
    jar.push({ name, value, ...attributes, path, domain: key });
    this.cookies.set(key, jar);
  }

  exportCookies(): CookieStore {
    const result: CookieStore = {};
    for (const [domain, jar] of this.cookies) {
      const out: Record<string, Cookie> = {};
      for (const cookie of jar) {
        if (this.isExpired(cookie)) continue;
        const { name, ...rest } = cookie;
        const path = cookie.path ?? "/";
        // 默认路径用 cookie 名作 key，其余用 `name@path`，以兼容旧会话文件
        out[path === "/" ? name : `${name}@${path}`] = {
          ...rest,
          session: cookie.expiresAt === undefined,
        };
      }
      if (Object.keys(out).length > 0) result[domain] = out;
    }
    return result;
  }

  importCookies(data: CookieStoreInput): void {
    for (const [domain, jar] of Object.entries(data)) {
      const key = domain.toLowerCase();
      for (const [entryKey, entry] of Object.entries(jar)) {
        const cookie: Cookie = typeof entry === "string" ? { value: entry } : entry;
        if (this.isExpired(cookie)) continue;

        let name = entryKey;
        let path = cookie.path ?? "/";
        const at = entryKey.lastIndexOf("@");
        if (at > 0) {
          name = entryKey.slice(0, at);
          path = entryKey.slice(at + 1);
        }

        const next = this.jarOf(key).filter(
          (item) => !(item.name === name && (item.path ?? "/") === path),
        );
        next.push({ ...cookie, name, path, domain: key });
        this.cookies.set(key, next);
      }
    }
  }

  setOnUpdate(onUpdate?: () => void): void {
    this.onUpdate = onUpdate;
  }

  deleteCookie(name: string, urlOrHost: string): void {
    const host = this.resolveHost(urlOrHost);
    for (const [domain, jar] of this.cookies) {
      if (!this.matches(host, domain)) continue;
      const next = jar.filter((cookie) => cookie.name !== name);
      if (next.length > 0) this.cookies.set(domain, next);
      else this.cookies.delete(domain);
    }
    this.onUpdate?.();
  }

  getCookie(name: string, urlOrHost?: string): string | undefined {
    const host = urlOrHost ? this.resolveHost(urlOrHost) : undefined;
    const requestPath = urlOrHost && isUrl(urlOrHost) ? urlPath(urlOrHost) : undefined;

    let best: StoredCookie | undefined;
    let bestLength = -1;
    for (const [domain, jar] of this.cookies) {
      if (host && !this.matches(host, domain)) continue;
      for (const cookie of jar) {
        if (cookie.name !== name || this.isExpired(cookie)) continue;
        if (requestPath !== undefined && !pathMatchesPath(requestPath, cookie.path ?? "/")) continue;
        const length = (cookie.path ?? "/").length;
        if (length > bestLength) {
          best = cookie;
          bestLength = length;
        }
      }
    }
    return best?.value;
  }

  allCookies(urlOrHost?: string): Record<string, string> {
    const host = urlOrHost ? this.resolveHost(urlOrHost) : undefined;
    const requestPath = urlOrHost && isUrl(urlOrHost) ? urlPath(urlOrHost) : undefined;

    const chosen = new Map<string, { length: number; value: string }>();
    for (const [domain, jar] of this.cookies) {
      if (host && !this.matches(host, domain)) continue;
      for (const cookie of jar) {
        if (this.isExpired(cookie)) continue;
        if (requestPath !== undefined && !pathMatchesPath(requestPath, cookie.path ?? "/")) continue;
        const length = (cookie.path ?? "/").length;
        const previous = chosen.get(cookie.name);
        if (!previous || length > previous.length) {
          chosen.set(cookie.name, { length, value: cookie.value });
        }
      }
    }

    const result: Record<string, string> = {};
    for (const [name, item] of chosen) result[name] = item.value;
    return result;
  }

  cookieHeader(url: string): string {
    const host = this.hostOf(url);
    const requestPath = urlPath(url);

    const matches: StoredCookie[] = [];
    for (const [domain, jar] of this.cookies) {
      if (!this.matches(host, domain)) continue;
      for (const cookie of jar) {
        if (this.isExpired(cookie)) continue;
        if (pathMatchesPath(requestPath, cookie.path ?? "/")) matches.push(cookie);
      }
    }

    // RFC 6265：路径更具体的排在前面
    matches.sort((a, b) => (b.path ?? "/").length - (a.path ?? "/").length);
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  private absorb(response: AxiosResponse): void {
    const setCookies = response.headers["set-cookie"];
    if (!setCookies) return;

    const requestHost = this.hostOf(response.config.url ?? "");
    const now = Date.now();

    for (const line of setCookies) {
      const segments = line.split(";");
      const pair = segments[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;

      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = requestHost;
      let path: string | undefined;
      let maxAge: number | undefined;
      let expiresAt: number | undefined;
      let secure = false;
      let httpOnly = false;

      for (let i = 1; i < segments.length; i++) {
        const attr = segments[i].trim();
        const lower = attr.toLowerCase();
        if (lower.startsWith("domain=")) {
          domain = attr.slice(7).trim().replace(/^\./, "").toLowerCase();
        } else if (lower.startsWith("path=")) {
          path = attr.slice(5).trim();
        } else if (lower.startsWith("max-age=")) {
          const seconds = Number(attr.slice(8).trim());
          if (Number.isFinite(seconds)) maxAge = seconds;
        } else if (lower.startsWith("expires=")) {
          const parsed = Date.parse(attr.slice(8).trim());
          if (!Number.isNaN(parsed)) expiresAt = parsed;
        } else if (lower === "secure") {
          secure = true;
        } else if (lower === "httponly") {
          httpOnly = true;
        }
      }

      const cookiePath = path ?? "/";
      const expiry = maxAge !== undefined ? now + maxAge * 1000 : expiresAt;

      // 同名（domain + path）先移除，再按情况重建；顺带清理过期项
      const jar = this.replace(
        this.jarOf(domain).filter(
          (cookie) => !(cookie.name === name && (cookie.path ?? "/") === cookiePath),
        ),
      );

      if (value !== "" && !(expiry !== undefined && expiry <= now)) {
        jar.push({
          name,
          value,
          expiresAt: expiry,
          path: cookiePath,
          domain,
          secure,
          httpOnly,
        });
      }

      if (jar.length > 0) this.cookies.set(domain, jar);
      else this.cookies.delete(domain);
    }

    this.onUpdate?.();
  }

  async request<T = any>(config: RequestOptions): Promise<AxiosResponse<T>> {
    const { omitCookies, ...rest } = config;
    const headers = { ...(rest.headers ?? {}) };
    if (!omitCookies) headers.Cookie = this.cookieHeader(rest.url ?? "");
    const response = await this.client.request<T>({ ...rest, headers });
    this.absorb(response);
    return response;
  }

  async get<T = any>(url: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, url, method: "GET" });
  }

  async post<T = any>(
    url: string,
    data?: unknown,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, url, method: "POST", data });
  }
}
