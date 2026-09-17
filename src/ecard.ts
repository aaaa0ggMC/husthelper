import type { AxiosResponse } from "axios";
import { ECARD_BASE } from "./auth.ts";

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
    nextPage: data.nextpage ? Number(data.nextpage) : null,
  };
}

export function isLoginRedirect(response: AxiosResponse): boolean {
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
