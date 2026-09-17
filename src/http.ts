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

export class Session {
  readonly client: AxiosInstance;
  private cookies = new Map<string, Map<string, Cookie>>();
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
    return urlOrHost.includes("://") ? this.hostOf(urlOrHost) : urlOrHost.toLowerCase();
  }

  private matches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
  }

  private isExpired(cookie: Cookie): boolean {
    return cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now();
  }

  setCookie(name: string, value: string, domain: string, attributes: Omit<Cookie, "value"> = {}): void {
    const key = domain.toLowerCase();
    const jar = this.cookies.get(key) ?? new Map<string, Cookie>();
    jar.set(name, { value, ...attributes, domain: key });
    this.cookies.set(key, jar);
  }

  exportCookies(): CookieStore {
    const result: CookieStore = {};
    for (const [domain, jar] of this.cookies) {
      const out: Record<string, Cookie> = {};
      for (const [name, cookie] of jar) {
        if (this.isExpired(cookie)) continue;
        const { session: _ignored, ...rest } = cookie;
        out[name] = { ...rest, session: cookie.expiresAt === undefined };
      }
      if (Object.keys(out).length > 0) result[domain] = out;
    }
    return result;
  }

  importCookies(data: CookieStoreInput): void {
    for (const [domain, jar] of Object.entries(data)) {
      for (const [name, entry] of Object.entries(jar)) {
        const cookie: Cookie = typeof entry === "string" ? { value: entry } : entry;
        if (this.isExpired(cookie)) continue;
        const key = domain.toLowerCase();
        const jarMap = this.cookies.get(key) ?? new Map<string, Cookie>();
        jarMap.set(name, { ...cookie, domain: key });
        this.cookies.set(key, jarMap);
      }
    }
  }

  setOnUpdate(onUpdate?: () => void): void {
    this.onUpdate = onUpdate;
  }

  getCookie(name: string, urlOrHost?: string): string | undefined {
    if (urlOrHost) {
      const host = this.resolveHost(urlOrHost);
      for (const [domain, jar] of this.cookies) {
        if (this.matches(host, domain)) {
          const cookie = jar.get(name);
          if (cookie && !this.isExpired(cookie)) return cookie.value;
        }
      }
      return undefined;
    }
    for (const jar of this.cookies.values()) {
      const cookie = jar.get(name);
      if (cookie && !this.isExpired(cookie)) return cookie.value;
    }
    return undefined;
  }

  allCookies(urlOrHost?: string): Record<string, string> {
    const host = urlOrHost ? this.resolveHost(urlOrHost) : undefined;
    const result: Record<string, string> = {};
    for (const [domain, jar] of this.cookies) {
      if (host && !this.matches(host, domain)) continue;
      for (const [k, cookie] of jar) {
        if (!this.isExpired(cookie)) result[k] = cookie.value;
      }
    }
    return result;
  }

  cookieHeader(url: string): string {
    const host = this.hostOf(url);
    const parts: string[] = [];
    for (const [domain, jar] of this.cookies) {
      if (!this.matches(host, domain)) continue;
      for (const [name, cookie] of jar) {
        if (!this.isExpired(cookie)) parts.push(`${name}=${cookie.value}`);
      }
    }
    return parts.join("; ");
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

      const expiry = maxAge !== undefined ? now + maxAge * 1000 : expiresAt;
      const jar = this.cookies.get(domain) ?? new Map<string, Cookie>();

      if (value === "" || (expiry !== undefined && expiry <= now)) {
        jar.delete(name);
      } else {
        jar.set(name, { value, expiresAt: expiry, path, domain, secure, httpOnly });
      }
      if (jar.size > 0) this.cookies.set(domain, jar);
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
