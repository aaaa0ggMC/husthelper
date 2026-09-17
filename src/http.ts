import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export interface RequestOptions extends AxiosRequestConfig {
  omitCookies?: boolean;
}

export class Session {
  readonly client: AxiosInstance;
  private cookies = new Map<string, Map<string, string>>();

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

  private matches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
  }

  setCookie(name: string, value: string, domain: string): void {
    const key = domain.toLowerCase();
    const jar = this.cookies.get(key) ?? new Map<string, string>();
    jar.set(name, value);
    this.cookies.set(key, jar);
  }

  getCookie(name: string, urlOrHost?: string): string | undefined {
    if (urlOrHost) {
      const host = urlOrHost.includes("://") ? this.hostOf(urlOrHost) : urlOrHost.toLowerCase();
      for (const [domain, jar] of this.cookies) {
        if (this.matches(host, domain) && jar.has(name)) return jar.get(name);
      }
      return undefined;
    }
    for (const jar of this.cookies.values()) {
      if (jar.has(name)) return jar.get(name);
    }
    return undefined;
  }

  allCookies(url?: string): Record<string, string> {
    const host = url ? this.hostOf(url) : undefined;
    const result: Record<string, string> = {};
    for (const [domain, jar] of this.cookies) {
      if (host && !this.matches(host, domain)) continue;
      for (const [k, v] of jar) result[k] = v;
    }
    return result;
  }

  cookieHeader(url: string): string {
    const host = this.hostOf(url);
    const parts: string[] = [];
    for (const [domain, jar] of this.cookies) {
      if (!this.matches(host, domain)) continue;
      for (const [k, v] of jar) parts.push(`${k}=${v}`);
    }
    return parts.join("; ");
  }

  private absorb(response: AxiosResponse): void {
    const setCookies = response.headers["set-cookie"];
    if (!setCookies) return;

    const requestHost = this.hostOf(response.config.url ?? "");

    for (const line of setCookies) {
      const segments = line.split(";");
      const pair = segments[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;

      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = requestHost;
      let expired = false;

      for (let i = 1; i < segments.length; i++) {
        const attr = segments[i].trim();
        const lower = attr.toLowerCase();
        if (lower.startsWith("domain=")) {
          domain = attr.slice(7).trim().replace(/^\./, "").toLowerCase();
        } else if (lower.startsWith("max-age=") && attr.slice(8).trim() === "0") {
          expired = true;
        } else if (lower.startsWith("expires=") && /01 Jan 1970/i.test(attr)) {
          expired = true;
        }
      }

      const jar = this.cookies.get(domain) ?? new Map<string, string>();
      if (value === "" || expired) jar.delete(name);
      else jar.set(name, value);
      if (jar.size > 0) this.cookies.set(domain, jar);
    }
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
