import type { AxiosResponse } from "axios";
import type { RequestOptions, Session } from "./http.ts";
import type { CasService, LoginContext } from "./cas.ts";
import type { Logger } from "./logger.ts";

/**
 * HustClient 暴露给各命名空间 API（`client.ecard` / `client.mhub` / ...）的内部能力。
 * 各 API 只依赖这个接口，因此可以独立成文件，也不会与 client.ts 形成循环依赖。
 */
export interface ClientRuntime {
  readonly logger: Logger;
  session(): Session | undefined;
  ensureReady(): Promise<Session>;
  ensureService(service: CasService): Promise<Session>;
  serviceRequest<T = string>(
    service: CasService,
    path: string,
    config?: RequestOptions,
  ): Promise<AxiosResponse<T>>;
  loginContext(): LoginContext;
  cookiesFor(urlOrHost: string): Record<string, string>;
  save(): void;
}
