import type { CasService } from "./cas.ts";
import type { ClientRuntime } from "./runtime.ts";
import { parseProfile, type Profile } from "./profile.ts";

export const ECARD_HOST = "ecard.m.hust.edu.cn";
export const ECARD_BASE = "http://ecard.m.hust.edu.cn:80/wechat-web";
export const ECARD_SERVICE = `${ECARD_BASE}/`;
export const ECARD_SESSION_COOKIE = "JSESSIONID";

/** 一卡通（ecard）作为 CAS 应用的声明 */
export const ecardService: CasService = {
  name: "ecard",
  host: ECARD_HOST,
  base: ECARD_BASE,
  service: ECARD_SERVICE,
  sessionCookie: ECARD_SESSION_COOKIE,
  bootstrapUrl: ECARD_SERVICE,
};

export interface TransactionQuery {
  account: string;
  page?: number;
  dateStatus?: number;
  typeStatus?: number;
}

export interface Transaction {
  [key: string]: unknown;
}

export interface TransactionPage {
  records: Transaction[];
  total: number;
  pageSize: number;
  nextPage: number | null;
}

export function transactionUrl(query: TransactionQuery): string {
  const params = new URLSearchParams({
    jsoncallback: `jQuery_${Date.now()}`,
    account: query.account,
    curpage: String(query.page ?? 1),
    dateStatus: String(query.dateStatus ?? 2),
    typeStatus: String(query.typeStatus ?? 1),
    _: String(Date.now()),
  });
  return `${ECARD_BASE}/QueryController/select.html?${params}`;
}

export function parseJsonp(body: string): unknown {
  const text = body.trim();
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1) return JSON.parse(text);
  return JSON.parse(text.slice(start + 1, end));
}

export function parseTransactionResponse(body: string): TransactionPage {
  const data = parseJsonp(body) as {
    retcode?: string;
    errmsg?: string;
    rowcount?: string;
    pagesize?: string;
    nextpage?: string;
    total?: Transaction[];
  };

  if (data.retcode !== "0") {
    throw new Error(`查询流水失败: ${data.errmsg ?? data.retcode}`);
  }

  return {
    records: data.total ?? [],
    total: Number(data.rowcount ?? 0),
    pageSize: Number(data.pagesize ?? 0),
    nextPage: data.nextpage && data.nextpage !== "0" ? Number(data.nextpage) : null,
  };
}

/** 一卡通 API：`client.ecard` */
export class EcardApi {
  private readonly runtime: ClientRuntime;
  private account?: string;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  withAccount(account: string): this {
    this.account = account;
    return this;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(ECARD_SESSION_COOKIE, ECARD_HOST);
  }

  /** 一卡通账号（不是学号）；首次调用会请求 Queryurl.html 自动解析并缓存 */
  async getAccount(): Promise<string> {
    if (this.account) return this.account;

    const response = await this.runtime.serviceRequest(
      ecardService,
      `${ECARD_BASE}/QueryController/Queryurl.html`,
    );
    const match = String(response.data).match(/id="account"[^>]*value="([^"]*)"/i);
    if (!match) throw new Error("未能从 Queryurl.html 解析出一卡通 account");

    this.account = match[1];
    this.runtime.logger.info(`自动获取 account: ${this.account}`);
    return this.account;
  }

  async getProfile(): Promise<Profile> {
    const response = await this.runtime.serviceRequest(
      ecardService,
      `${ECARD_BASE}/service/profile.html`,
    );
    return parseProfile(String(response.data));
  }

  async getTransactions(query: Partial<TransactionQuery> = {}): Promise<TransactionPage> {
    const account = query.account ?? (await this.getAccount());

    this.runtime.logger.debug(`查询流水 account=${account} page=${query.page ?? 1}`);
    const response = await this.runtime.serviceRequest(
      ecardService,
      transactionUrl({ ...query, account }),
      {
        headers: {
          Referer: `${ECARD_BASE}/QueryController/Queryurl.html`,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    return parseTransactionResponse(response.data as string);
  }

  async *iterateTransactions(
    query: Partial<TransactionQuery> = {},
  ): AsyncGenerator<Transaction> {
    let page = query.page ?? 1;
    while (true) {
      const result = await this.getTransactions({ ...query, page });
      for (const record of result.records) yield record;
      if (result.nextPage === null) break;
      page = result.nextPage;
    }
  }
}
