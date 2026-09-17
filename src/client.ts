import type { AxiosResponse } from "axios";
import type { AIConfig } from "./openai.ts";
import { Session, type RequestOptions } from "./http.ts";
import { defaultLogger, resolveLogger, type Logger, type LoggerInput } from "./logger.ts";
import type { StdCharOptions } from "./stdchar-pipe.ts";
import {
  ECARD_BASE,
  ECARD_HOST,
  fullLogin,
  tryCasRenew,
  type Credentials,
  type OcrStrategy,
  type ParsedOcr,
  type RawOcr,
} from "./auth.ts";
import {
  isLoginRedirect,
  parseTransactionResponse,
  transactionUrl,
  type Transaction,
  type TransactionPage,
  type TransactionQuery,
} from "./ecard.ts";
import { parseProfile, type Profile } from "./profile.ts";
import { loadPersist, savePersist } from "./persist.ts";
import {
  acquireMhubSession,
  isMhubLoginRedirect,
  mhubUrl,
  MHUB_HOST,
  MHUB_BASE,
  MHUB_SESSION_COOKIE,
} from "./mhub.ts";
import {
  parseGradeTerms,
  parseGrades,
  type GradeTerm,
  type Grades,
} from "./grades.ts";
import {
  acquireHkwxySession,
  hkwxyUrl,
  isHkwxyLoginRedirect,
  parseOnlineDevices,
  HKWXY_HOST,
  HKWXY_BASE,
  HKWXY_SESSION_COOKIE,
  type OnlineDevice,
} from "./hkwxy.ts";
import {
  acquireWechatSession,
  isWechatLoginRedirect,
  wechatUrl,
  WECHAT_HOST,
  WECHAT_SESSION_COOKIE,
} from "./wechat.ts";

export interface AuthOptions {
  user_name?: string;
  password?: string;
  account?: string;
}

export interface PersistOptions {
  maxAgeMs?: number;
}

export interface AiOcrOptions {
  baseURL?: string;
  base_url?: string;
  apiKey?: string;
  api_key?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  onImage?: (jpg: Buffer) => void;
}

function normalizeAi(options: AiOcrOptions): AIConfig {
  const baseURL = options.baseURL ?? options.base_url;
  const apiKey = options.apiKey ?? options.api_key;
  if (!baseURL) throw new Error("缺少 AI OCR 的 baseURL");
  if (!apiKey) throw new Error("缺少 AI OCR 的 apiKey");
  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey,
    model: options.model ?? "gpt-4o-mini",
    maxTokens: options.maxTokens ?? 1024,
    timeout: options.timeout ?? 60000,
  };
}

export class HustClient {
  private un?: string;
  private pwd?: string;
  private account?: string;
  private ocr?: OcrStrategy;
  private session?: Session;
  private jsessionId?: string;
  private wechatAcquired = false;
  private mhubAcquired = false;
  private hkwxyAcquired = false;
  private gradeTerms?: GradeTerm[];
  private logger: Logger = defaultLogger;
  private persistPath?: string;
  private persistMaxAgeMs?: number;
  private persistedAtValue?: string;
  private needsRefresh = false;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(options: AuthOptions = {}) {
    this.un = options.user_name;
    this.pwd = options.password;
    this.account = options.account;
  }

  withRawOcr(ocr: RawOcr): this {
    this.ocr = { kind: "raw", raw: ocr };
    return this;
  }

  withParsedOcr(ocr: ParsedOcr): this {
    this.ocr = { kind: "parsed", parsed: ocr };
    return this;
  }

  withAiOcr(options: AiOcrOptions): this {
    this.ocr = { kind: "ai", ai: { config: normalizeAi(options), onImage: options.onImage } };
    return this;
  }

  withStdChar(options: StdCharOptions = {}): this {
    this.ocr = { kind: "stdchar", stdChar: options };
    return this;
  }

  withAccount(account: string): this {
    this.account = account;
    return this;
  }

  withLogger(logger: LoggerInput): this {
    this.logger = resolveLogger(logger);
    return this;
  }

  persistent(file: string, options: PersistOptions = {}): this {
    this.persistPath = file;
    this.persistMaxAgeMs = options.maxAgeMs;

    const data = loadPersist(file);
    if (data) {
      const session = new Session();
      session.importCookies(data.hosts);
      this.session = session;
      this.attachPersistence(session);
      this.jsessionId = session.getCookie("JSESSIONID", ECARD_HOST);
      this.wechatAcquired = !!session.getCookie(WECHAT_SESSION_COOKIE, WECHAT_HOST);
      this.mhubAcquired = !!session.getCookie(MHUB_SESSION_COOKIE, MHUB_HOST);
      this.hkwxyAcquired = !!session.getCookie(HKWXY_SESSION_COOKIE, HKWXY_HOST);
      this.persistedAtValue = data.savedAt;

      const age = Date.now() - Date.parse(data.savedAt);
      if (
        this.persistMaxAgeMs !== undefined &&
        Number.isFinite(age) &&
        age > this.persistMaxAgeMs
      ) {
        this.needsRefresh = true;
        this.logger.info(
          `持久化会话已 ${Math.round(age / 1000)}s（超过 maxAgeMs），将主动续期`,
        );
      }
      this.logger.info(`已从 ${file} 恢复会话 (savedAt=${data.savedAt})`);
    }

    return this;
  }

  private attachPersistence(session: Session): void {
    session.setOnUpdate(() => this.scheduleSave());
  }

  private scheduleSave(): void {
    if (!this.persistPath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 50);
  }

  private save(): void {
    if (!this.persistPath || !this.session) return;
    try {
      const data = savePersist(this.persistPath, this.session.exportCookies());
      this.persistedAtValue = data.savedAt;
    } catch (error) {
      this.logger.warn(
        `持久化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  get sessionId(): string | undefined {
    return this.jsessionId;
  }

  get persistedAt(): string | undefined {
    return this.persistedAtValue;
  }

  get httpSession(): Session | undefined {
    return this.session;
  }

  cookiesFor(urlOrHost: string): Record<string, string> {
    return this.session ? this.session.allCookies(urlOrHost) : {};
  }

  private requireOcr(): OcrStrategy {
    if (!this.ocr) {
      throw new Error("未配置 OCR 策略，请调用 withAiOcr / withRawOcr / withParsedOcr");
    }
    return this.ocr;
  }

  private requireCredentials(): Credentials {
    if (!this.un || !this.pwd) {
      throw new Error("缺少登录凭据，请在 auth({ user_name, password }) 中提供");
    }
    return { un: this.un, pwd: this.pwd };
  }

  private async login(): Promise<void> {
    const session = new Session();
    const jsessionId = await fullLogin(session, this.requireCredentials(), this.requireOcr(), {
      logger: this.logger,
    });
    this.session = session;
    this.jsessionId = jsessionId;
    this.wechatAcquired = false;
    this.mhubAcquired = false;
    this.hkwxyAcquired = false;
    this.attachPersistence(session);
    this.save();
  }

  private async ensureSession(): Promise<Session> {
    if (this.needsRefresh && this.session) {
      this.needsRefresh = false;
      this.logger.info("主动续期持久化会话...");
      await this.renew();
    }
    if (!this.session) await this.login();
    return this.session!;
  }

  async renew(): Promise<string> {
    if (this.session) {
      const jsessionId = await tryCasRenew(this.session, this.logger);
      if (jsessionId) {
        this.jsessionId = jsessionId;
        this.logger.info("CASTGC 续期成功");
        return jsessionId;
      }
    }
    this.logger.warn("CASTGC 失效，回退到完整登录");
    await this.login();
    return this.jsessionId!;
  }

  private async request(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse> {
    let session = await this.ensureSession();
    let response = await session.get(path, { responseType: "text", ...config });

    if (isLoginRedirect(response)) {
      this.logger.warn("登录态已失效（被重定向到 CAS）");
      await this.renew();
      session = this.session!;
      this.logger.info("续期完成，重试请求");
      response = await session.get(path, { responseType: "text", ...config });
    }

    if (isLoginRedirect(response)) throw new Error("自动续期后仍被重定向到 CAS 登录");
    return response;
  }

  async getAccount(): Promise<string> {
    if (this.account) return this.account;

    const response = await this.request(`${ECARD_BASE}/QueryController/Queryurl.html`);
    const match = String(response.data).match(/id="account"[^>]*value="([^"]*)"/i);
    if (!match) throw new Error("未能从 Queryurl.html 解析出一卡通 account");

    this.account = match[1];
    this.logger.info(`自动获取 account: ${this.account}`);
    return this.account;
  }

  async getEcardProfile(): Promise<Profile> {
    const response = await this.request(`${ECARD_BASE}/service/profile.html`);
    return parseProfile(String(response.data));
  }

  getProfile(): Promise<Profile> {
    return this.getEcardProfile();
  }

  async getTransactions(query: Partial<TransactionQuery> = {}): Promise<TransactionPage> {
    const account = query.account ?? (await this.getAccount());

    this.logger.debug(`查询流水 account=${account} page=${query.page ?? 1}`);
    const response = await this.request(transactionUrl({ ...query, account }), {
      headers: {
        Referer: `${ECARD_BASE}/QueryController/Queryurl.html`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    return parseTransactionResponse(response.data as string);
  }

  async *iterateTransactions(query: Partial<TransactionQuery> = {}): AsyncGenerator<Transaction> {
    let page = query.page ?? 1;
    while (true) {
      const result = await this.getTransactions({ ...query, page });
      for (const record of result.records) yield record;
      if (result.nextPage === null) break;
      page = result.nextPage;
    }
  }

  get wechatSessionId(): string | undefined {
    return this.session?.getCookie(WECHAT_SESSION_COOKIE, WECHAT_HOST);
  }

  private async acquireWechat(): Promise<void> {
    const session = this.session!;
    try {
      await acquireWechatSession(session, this.logger);
    } catch (error) {
      this.logger.warn("wechat: CASTGC 续期失败，回退完整登录");
      this.logger.debug(error instanceof Error ? error.message : String(error));
      await this.renew();
      await acquireWechatSession(this.session!, this.logger);
    }
    this.wechatAcquired = true;
  }

  private async ensureWechat(): Promise<Session> {
    await this.ensureSession();
    if (!this.wechatAcquired) await this.acquireWechat();
    return this.session!;
  }

  async getWechatSession(): Promise<{ sessionId: string; cookies: Record<string, string> }> {
    await this.ensureWechat();
    return {
      sessionId: this.wechatSessionId!,
      cookies: this.cookiesFor(WECHAT_HOST),
    };
  }

  async wechatRequest<T = string>(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    await this.ensureWechat();
    let response = await this.session!.get<T>(wechatUrl(path), {
      responseType: "text",
      ...config,
    });

    if (isWechatLoginRedirect(response)) {
      this.logger.warn("wechat 会话已失效，重新获取");
      await this.acquireWechat();
      response = await this.session!.get<T>(wechatUrl(path), {
        responseType: "text",
        ...config,
      });
    }

    if (isWechatLoginRedirect(response)) {
      throw new Error("wechat 重新获取会话后仍被重定向到 CAS 登录");
    }
    return response;
  }

  async getAppsCenter(): Promise<string> {
    const response = await this.wechatRequest<string>("/wechat/apps_center.jsp");
    return String(response.data);
  }

  get mhubSessionId(): string | undefined {
    return this.session?.getCookie(MHUB_SESSION_COOKIE, MHUB_HOST);
  }

  private async acquireMhub(): Promise<void> {
    const session = this.session!;
    try {
      await acquireMhubSession(session, this.logger);
    } catch (error) {
      this.logger.warn("mhub: CASTGC 续期失败，回退完整登录");
      this.logger.debug(error instanceof Error ? error.message : String(error));
      await this.renew();
      await acquireMhubSession(this.session!, this.logger);
    }
    this.mhubAcquired = true;
  }

  private async ensureMhub(): Promise<Session> {
    await this.ensureSession();
    if (!this.mhubAcquired) await this.acquireMhub();
    return this.session!;
  }

  async mhubRequest<T = string>(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    await this.ensureMhub();
    let response = await this.session!.get<T>(mhubUrl(path), {
      responseType: "text",
      ...config,
    });

    if (isMhubLoginRedirect(response)) {
      this.logger.warn("mhub 会话已失效，重新获取");
      await this.acquireMhub();
      response = await this.session!.get<T>(mhubUrl(path), {
        responseType: "text",
        ...config,
      });
    }

    if (isMhubLoginRedirect(response)) {
      throw new Error("mhub 重新获取会话后仍被重定向到 CAS 登录");
    }
    return response;
  }

  async getGradeTerms(): Promise<GradeTerm[]> {
    if (!this.gradeTerms) {
      const response = await this.mhubRequest<string>("/CjcxController/fianCjInfo");
      this.gradeTerms = parseGradeTerms(String(response.data));
    }
    return this.gradeTerms;
  }

  async getGrades(options: { xn?: string; xq?: number } = {}): Promise<Grades> {
    let xn = options.xn;
    if (!xn) {
      const terms = await this.getGradeTerms();
      xn = terms[0]?.XN;
    }
    if (!xn) throw new Error("无法确定学年 xn，请显式传入 getGrades({ xn })");

    const xq = options.xq ?? 0;
    const response = await this.mhubRequest<string>(
      `/CjcxController/fianCjInfo?xn=${encodeURIComponent(xn)}&xq=${xq}`,
      { headers: { Referer: `${MHUB_BASE}/CjcxController/fianCjInfo?xn=${xn}&xq=1` } },
    );
    return parseGrades(String(response.data), xn, xq);
  }

  get hkwxySessionId(): string | undefined {
    return this.session?.getCookie(HKWXY_SESSION_COOKIE, HKWXY_HOST);
  }

  private async acquireHkwxy(): Promise<void> {
    const session = this.session!;
    try {
      await acquireHkwxySession(session, this.logger);
    } catch (error) {
      this.logger.warn("hkwxy: CASTGC 续期失败，回退完整登录");
      this.logger.debug(error instanceof Error ? error.message : String(error));
      await this.renew();
      await acquireHkwxySession(this.session!, this.logger);
    }
    this.hkwxyAcquired = true;
  }

  private async ensureHkwxy(): Promise<Session> {
    await this.ensureSession();
    if (!this.hkwxyAcquired) await this.acquireHkwxy();
    return this.session!;
  }

  async hkwxyRequest<T = string>(
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    await this.ensureHkwxy();
    const url = hkwxyUrl(path);
    const { method, data, ...rest } = config;
    const send = (): Promise<AxiosResponse<T>> =>
      method && method.toUpperCase() === "POST"
        ? this.session!.post<T>(url, data, { responseType: "text", ...rest })
        : this.session!.get<T>(url, { responseType: "text", ...rest });

    let response = await send();
    if (isHkwxyLoginRedirect(response)) {
      this.logger.warn("hkwxy 会话已失效，重新获取");
      await this.acquireHkwxy();
      response = await send();
    }
    if (isHkwxyLoginRedirect(response)) {
      throw new Error("hkwxy 重新获取会话后仍被重定向到 CAS 登录");
    }
    return response;
  }

  async getOnlineDevices(): Promise<OnlineDevice[]> {
    const response = await this.hkwxyRequest<string>("/apps/campusNetwork/onlineDevices", {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${HKWXY_BASE}/apps/campusNetwork/onlineDevices?item_id=undefined`,
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
