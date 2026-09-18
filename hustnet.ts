import { NetClient, auth, type NetAuthOptions } from "./src/hustnet.ts";

export * from "./src/hustnet.ts";

/** 创建校园网（eportal）认证客户端，与 `index.ts` 的 CAS 客户端彼此独立。 */
export function create(options: NetAuthOptions): NetClient {
  return auth(options);
}

const hustnet = { auth, create };

export default hustnet;
