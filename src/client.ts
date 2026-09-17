import type { AxiosResponse } from "axios";
import type { AIConfig } from "./openai.ts";
import { Session, type RequestOptions } from "./http.ts";
import { defaultLogger, resolveLogger, type Logger, type LoggerInput } from "./logger.ts";
import type { StdCharOptions } from "./stdchar-pipe.ts";
import {
  ECARD_BASE,
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

export interface AuthOptions {
  user_name?: string;
  password?: string;
  account?: string;
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
  private logger: Logger = defaultLogger;

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

  get sessionId(): string | undefined {
    return this.jsessionId;
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
  }

  private async ensureSession(): Promise<Session> {
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
}
