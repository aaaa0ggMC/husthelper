// husthelper 共享核心：分域名的 Cookie jar（`Session`）与日志。
//
// `hustnet` 与 `hustpass` 都依赖它；除此之外两者彼此独立。

export { Session } from "./src/http.ts";
export type {
  Cookie,
  CookieInput,
  CookieStore,
  CookieStoreInput,
  RequestOptions,
} from "./src/http.ts";
export { defaultLogger, resolveLogger } from "./src/logger.ts";
export type { Logger, LoggerInput } from "./src/logger.ts";
