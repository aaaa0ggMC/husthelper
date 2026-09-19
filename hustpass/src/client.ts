import type { AxiosResponse } from "axios";
import type { AIConfig } from "./openai.ts";
import { Session, type RequestOptions } from "hustcore";
import { defaultLogger, resolveLogger, type Logger, type LoggerInput } from "hustcore";
import type { StdCharOptions } from "./stdchar-pipe.ts";
import {
  CAS_HOST,
  CAS_ORIGIN,
  CASTGC_COOKIE,
  exchangeTicket,
  isCasLoginResponse,
  isSessionExpiredResponse,
  performCasLogin,
  qrLogin,
  requestCasTicket,
  serviceUrl,
  type CasService,
  type Credentials,
  type LoginContext,
  type MfaCodeProvider,
  type OcrStrategy,
  type ParsedOcr,
  type RawOcr,
} from "./cas.ts";
import { EcardApi, ecardService } from "./ecard.ts";
import { loadPersist, savePersist } from "./persist.ts";
import { MhubApi } from "./mhub.ts";
import { HkwxyApi } from "./hkwxy.ts";
import { WechatApi } from "./wechat.ts";
import { OneHustApi } from "./one.ts";
import { SmartCourseApi } from "./smartcourse.ts";
import { PejxglApi } from "./pejxgl.ts";
import { PecgApi } from "./pecg.ts";
import { PetyxyApi } from "./petyxy.ts";
import { RegisterApi } from "./register.ts";
import { IhusterApi } from "./ihuster.ts";
import { ElectricityApi } from "./electricity.ts";
import { SelfserviceApi } from "./selfservice.ts";
import { AggregateApi } from "./aggregate.ts";
import type { ClientRuntime } from "./runtime.ts";

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

/** 企业微信扫码登录处理器：拿到二维码内容后展示；可在此注入阻塞逻辑（如前端 UI 显示并等待扫码） */
export type QrCodeHandler = (scanUrl: string) => void | Promise<void>;

export interface QrCodeOptions {
  /** 轮询间隔（毫秒），默认 3000 */
  intervalMs?: number;
  /** 二维码有效期（毫秒），默认 180000 */
  timeoutMs?: number;
}

export type QrCodeLoginOptions = QrCodeOptions & { onQrCode?: QrCodeHandler };

/** 一条登录方式。按加入 `HustClient` 的先后顺序依次尝试（持久化会话始终优先复用） */
type LoginMethod =
  | { kind: "password" }
  | { kind: "qr"; handler: QrCodeHandler; options: QrCodeOptions };

type LoginMethodKind = LoginMethod["kind"];

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

/**
 * HUST 登录客户端。基于 CAS 门面（`CASTGC`），各应用按命名空间分组：
 *
 * - `client.ecard`   一卡通：流水 / 个人信息 / account
 * - `client.mhub`    成绩：学期 / 成绩
 * - `client.hkwxy`   在线设备
 * - `client.wechat`  微校园会话
 * - `client.one`     one.hust OIDC bearer token
 * - `client.smartcourse`  智慧课程平台
 * - `client.pejxgl`  体育教学管理系统（课外锻炼次数）
 * - `client.pecg`    场馆服务（预约记录，经 petyxy SSO 登录）
 * - `client.petyxy`  华中大体育（体质测试成绩，petyxy SSO）
 * - `client.register`  学期注册（注册状态、学期与通知）
 * - `client.ihuster`  IHuster 第二课堂（二课学分、用户信息，OAuth/JWT）
 * - `client.electricity`  宿舍电费查询（sdhq 移动后勤，SM2/SM3 鉴权）
 * - `client.selfservice`  校园网自助服务（myself，CAS 会话 + GBK HTML 解析）
 * - `client.aggregate`    跨平台聚合（不持有 session，只引用上面各命名空间）
 */
export class HustClient {
  readonly ecard: EcardApi;
  readonly mhub: MhubApi;
  readonly hkwxy: HkwxyApi;
  readonly wechat: WechatApi;
  readonly one: OneHustApi;
  readonly smartcourse: SmartCourseApi;
  readonly pejxgl: PejxglApi;
  readonly pecg: PecgApi;
  readonly petyxy: PetyxyApi;
  readonly register: RegisterApi;
  readonly ihuster: IhusterApi;
  readonly electricity: ElectricityApi;
  readonly selfservice: SelfserviceApi;
  readonly aggregate: AggregateApi;

  private un?: string;
  private pwd?: string;
  private ocr?: OcrStrategy;
  /** 企业微信 MFA 动态验证码提供者 */
  private mfaProvider?: MfaCodeProvider;
  /** 登录方式，按配置顺序依次尝试 */
  private methods: LoginMethod[] = [];
  private session?: Session;
  private logger: Logger = defaultLogger;
  private persistPath?: string;
  private persistMaxAgeMs?: number;
  private persistedAtValue?: string;
  private needsRefresh = false;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(options: AuthOptions = {}) {
    const runtime = this.createRuntime();
    this.ecard = new EcardApi(runtime);
    this.mhub = new MhubApi(runtime);
    this.hkwxy = new HkwxyApi(runtime);
    this.wechat = new WechatApi(runtime);
    this.one = new OneHustApi(runtime);
    this.smartcourse = new SmartCourseApi(runtime);
    this.pejxgl = new PejxglApi(runtime);
    this.pecg = new PecgApi(runtime);
    this.petyxy = new PetyxyApi(runtime);
    this.register = new RegisterApi(runtime);
    this.ihuster = new IhusterApi(runtime);
    this.electricity = new ElectricityApi(runtime);
    this.selfservice = new SelfserviceApi(runtime);
    this.aggregate = new AggregateApi(this);

    this.auth(options);
  }

  /* ------------------------------ 链式配置 ------------------------------ */

  /**
   * 配置账号密码登录（并加入登录方式序列）。`HustClient` 构造时已自动调用；
   * 也可在 `withQrCode()` 之后调用，此时密码登录会排在扫码登录**之后**尝试。
   */
  auth(options: AuthOptions = {}): this {
    this.un = options.user_name;
    this.pwd = options.password;
    if (options.account) this.ecard.withAccount(options.account);

    this.removeMethod("password");
    if (this.un && this.pwd) this.methods.push({ kind: "password" });
    return this;
  }

  /**
   * 配置企业微信扫码登录（加入登录方式序列）。`handler` 收到二维码内容后可自行渲染，
   * 并可通过返回 `Promise` 阻塞等待扫码；扫码状态的轮询由 SDK 在后台继续。
   *
   * 与 `auth()` 的调用先后决定尝试顺序，例如：
   * - `hust.auth({...}).withQrCode(fn)`：先密码，失败再扫码
   * - `hust.withQrCode(fn).auth({...})`：先扫码，失败再密码
   *
   * 已持久化的会话（`.persistent()`）始终最优先复用。
   */
  withQrCode(handler: QrCodeHandler, options: QrCodeOptions = {}): this {
    this.removeMethod("qr");
    this.methods.push({ kind: "qr", handler, options });
    return this;
  }

  private removeMethod(kind: LoginMethodKind): void {
    this.methods = this.methods.filter((method) => method.kind !== kind);
  }

  private hasMethod(kind: LoginMethodKind): boolean {
    return this.methods.some((method) => method.kind === kind);
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

  /**
   * 配置企业微信动态验证码（MFA）提供者。当密码 / 验证码登录被风控要求二次验证时，
   * SDK 会调用该回调获取 `phoneCode` 并自动完成挑战，因此密码登录也能在 MFA 场景下走通。
   *
   * 回调可为异步（如弹出 UI 等待用户从企业微信读取验证码后 resolve）；
   * 抛错或返回空字符串则该次密码登录失败，按登录方式序列降级（例如扫码）。
   */
  withMfaCode(provider: MfaCodeProvider): this {
    this.mfaProvider = provider;
    return this;
  }

  withAccount(account: string): this {
    this.ecard.withAccount(account);
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

  /* -------------------------------- 会话 -------------------------------- */

  get httpSession(): Session | undefined {
    return this.session;
  }

  get persistedAt(): string | undefined {
    return this.persistedAtValue;
  }

  cookiesFor(urlOrHost: string): Record<string, string> {
    return this.session ? this.session.allCookies(urlOrHost) : {};
  }

  /** 强制续期一卡通会话（先 CASTGC 免密，失败回退完整登录），返回新的 JSESSIONID */
  async renew(): Promise<string> {
    this.needsRefresh = false;
    this.logger.info("续期 CAS 会话...");
    return this.acquireService(ecardService);
  }

  /**
   * 便捷方法：确保拿到一卡通会话。**优先复用持久化的 `CASTGC`**，失效时才按配置的登录方式
   * 尝试（含企业微信扫码）。等价于先 `withQrCode(onQrCode)` 再访问业务接口。
   */
  async loginByQrCode(options: QrCodeLoginOptions = {}): Promise<void> {
    const { onQrCode, ...rest } = options;
    if (onQrCode) {
      this.withQrCode(onQrCode, rest);
    } else if (!this.hasMethod("qr")) {
      throw new Error("loginByQrCode 需要提供 onQrCode，或先调用 withQrCode(handler)");
    }
    await this.ensureService(ecardService);
    this.save();
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

  /* ------------------------------ 内部能力 ------------------------------ */

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

  private loginContext(): LoginContext {
    return { credentials: this.requireCredentials(), ocr: this.requireOcr() };
  }

  /** 子 SSO 流程的登录回退入口：以给定 service URL 执行配置好的登录方式序列 */
  private async loginFallback(serviceUrl: string, serviceName = "cas"): Promise<string> {
    return this.authenticate({
      name: serviceName,
      host: CAS_HOST,
      base: CAS_ORIGIN,
      service: serviceUrl,
      sessionCookie: CASTGC_COOKIE,
    });
  }

  private createRuntime(): ClientRuntime {
    const self = this;
    return {
      get logger() {
        return self.logger;
      },
      session: () => self.session,
      ensureReady: () => self.ensureReady(),
      ensureService: (service) => self.ensureService(service),
      serviceRequest: <T = string>(
        service: CasService,
        path: string,
        config?: RequestOptions,
      ) => self.serviceRequest<T>(service, path, config),
      loginContext: () => self.loginContext(),
      loginFallback: (serviceUrl, serviceName) => self.loginFallback(serviceUrl, serviceName),
      cookiesFor: (host) => self.cookiesFor(host),
      save: () => self.save(),
    };
  }

  /** 确保底层 cookie jar 存在（跨所有 CAS 应用共享） */
  private ensureJar(): Session {
    if (!this.session) {
      const session = new Session();
      this.attachPersistence(session);
      this.session = session;
    }
    return this.session;
  }

  private async ensureReady(): Promise<Session> {
    const session = this.ensureJar();
    if (this.needsRefresh) {
      this.needsRefresh = false;
      this.logger.info("主动续期持久化会话...");
      await this.renew();
    }
    return this.session!;
  }

  /**
   * 按配置顺序依次尝试各登录方式，返回带 ticket 的通行凭证 Location。
   * 某一种失败（缺少凭据/OCR、识别错误、用户未扫码等）会自动降级到下一种。
   */
  private async authenticate(service: CasService): Promise<string> {
    if (this.methods.length === 0) {
      throw new Error(
        "没有可用的登录方式，请使用 auth({ user_name, password }) 或 withQrCode(handler) 配置",
      );
    }

    const session = this.ensureJar();
    let lastError: unknown;

    for (let i = 0; i < this.methods.length; i++) {
      const method = this.methods[i];
      try {
        if (method.kind === "password") {
          this.logger.info(`使用密码 + 验证码登录 (${service.name})...`);
          return await performCasLogin(
            session,
            service.service,
            this.requireCredentials(),
            this.requireOcr(),
            { logger: this.logger, onMfaCode: this.mfaProvider },
          );
        }

        this.logger.info(`使用企业微信扫码登录 (${service.name})...`);
        await qrLogin(session, service.service, {
          logger: this.logger,
          intervalMs: method.options.intervalMs,
          timeoutMs: method.options.timeoutMs,
          onQrCode: method.handler,
        });
        const ticket = await requestCasTicket(session, service, this.logger);
        if (!ticket) throw new Error("扫码成功但未拿到通行凭证");
        return ticket;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const more = i < this.methods.length - 1;
        this.logger.warn(`登录方式 ${method.kind} 失败：${message}${more ? "，尝试下一种..." : ""}`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("所有登录方式均失败");
  }

  /** 获取（或重新获取）某个 CAS 应用的会话：先复用 `CASTGC`，失效再按配置的登录方式执行 */
  private async acquireService(service: CasService): Promise<string> {
    const session = this.ensureJar();
    const logger = this.logger;

    let ticket = await requestCasTicket(session, service, logger);
    if (!ticket) {
      if (service.bootstrapUrl) {
        logger.debug(`引导访问 ${service.bootstrapUrl}`);
        await session.get(service.bootstrapUrl);
      }
      ticket = await this.authenticate(service);
    }

    const value = await exchangeTicket(session, ticket, service, logger);
    this.save();
    return value;
  }

  /**
   * 检查应用会话 cookie 是否存在的参照地址：应用入口 URL 与 `service.host` 同域时用 URL，
   * 以便按 cookie `Path` 精确匹配（如 hkwxy 的 `/tp_up` 与 `/tp_wp`）；否则退回域名。
   */
  private cookieRef(service: CasService): string {
    try {
      if (new URL(service.service).hostname.toLowerCase() === service.host) return service.service;
    } catch {
      /* 不是合法 URL，退回域名 */
    }
    return service.host;
  }

  private async ensureService(service: CasService): Promise<Session> {
    const session = await this.ensureReady();
    if (!session.getCookie(service.sessionCookie, this.cookieRef(service))) {
      await this.acquireService(service);
    }
    return this.session!;
  }

  /** 统一的「应用请求 + 会话失效自动重取」 */
  private async serviceRequest<T = string>(
    service: CasService,
    path: string,
    config: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    let session = await this.ensureService(service);
    const url = serviceUrl(service, path);
    const { method, data, ...rest } = config;
    const send = (): Promise<AxiosResponse<T>> =>
      method && method.toUpperCase() === "POST"
        ? session.post<T>(url, data, { responseType: "text", ...rest })
        : session.get<T>(url, { responseType: "text", ...rest });

    const isRedirect = service.isLoginRedirect ?? isSessionExpiredResponse;
    let response = await send();

    if (isRedirect(response)) {
      this.logger.warn(`${service.name} 会话已失效，重新获取`);
      await this.acquireService(service);
      session = this.session!;
      response = await send();
    }

    if (isRedirect(response)) {
      throw new Error(`${service.name} 重新获取会话后仍被重定向到 CAS 登录`);
    }
    return response;
  }
}
