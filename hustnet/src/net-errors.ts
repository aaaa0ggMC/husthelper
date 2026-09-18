/**
 * 校园网（eportal）认证的错误分层。
 *
 * 设计目标：任何一个失败都必须能回答三个问题——
 *   1. 死在哪一步（`phase`）；
 *   2. 为什么（`code` + 可读中文 `message`，保留 `raw` / `responseBody` 原始响应）；
 *   3. 能不能重试（`retryable`）。
 *
 * 校园网门户本身对错误几乎不做区分（经常只回一句「认证失败」或干脆返回 HTML），
 * 因此把 HTTP 层、协议层、认证层、探测层的错误拆开，方便上层按类型决定策略。
 */

export type NetPhase =
  | "probe"
  | "session"
  | "pageInfo"
  | "login"
  | "userInfo"
  | "keepalive"
  | "logout";

export interface NetErrorInit {
  /** 出错阶段 */
  phase: NetPhase;
  /** 机器可读的错误码 */
  code: string;
  /** 人类可读的中文描述 */
  message: string;
  /** HTTP 状态码（若有） */
  httpStatus?: number;
  /** 是否建议重试（网络抖动、5xx、会话失效等） */
  retryable?: boolean;
  /** 原始异常（运行时异常链） */
  cause?: unknown;
  /** 原始解析结果（JSON 对象等） */
  raw?: unknown;
  /** 原始响应文本（截断后） */
  responseBody?: string;
}

export type NetSubErrorInit = Omit<NetErrorInit, "code"> & { code?: string };

export class NetError extends Error {
  readonly phase: NetPhase;
  readonly code: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly raw?: unknown;
  readonly responseBody?: string;
  declare readonly cause?: unknown;

  constructor(init: NetErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.phase = init.phase;
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.retryable = init.retryable ?? false;
    this.raw = init.raw;
    this.responseBody = init.responseBody;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}

export function isNetError(error: unknown): error is NetError {
  return error instanceof NetError;
}

/* ------------------------------- 传输 / HTTP ------------------------------ */

/** DNS、连接、TLS、超时等网络层失败 */
export class NetTransportError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "TRANSPORT", ...init });
  }
}

export class NetTimeoutError extends NetTransportError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "ETIMEDOUT" });
  }
}

/** 返回了 HTTP 错误状态 */
export class NetHttpError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "HTTP", ...init });
  }
}

/* -------------------------------- 协议层 -------------------------------- */

/** 响应格式与预期不符（返回 HTML、非 JSON、缺字段等） */
export class NetProtocolError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "PROTOCOL", ...init });
  }
}

/** 探测不到门户劫持跳转 */
export class NetPortalNotFoundError extends NetProtocolError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "PORTAL_NOT_FOUND" });
  }
}

/* -------------------------------- 会话层 -------------------------------- */

/** 门户 JSESSIONID 缺失或已失效，且无法自动刷新 */
export class NetSessionExpiredError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "SESSION_EXPIRED", retryable: true, ...init });
  }
}

/* -------------------------------- 认证层 -------------------------------- */

/** 认证被服务端拒绝的基类 */
export class NetAuthError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "AUTH", ...init });
  }
}

/** 账号或密码错误 */
export class NetCredentialError extends NetAuthError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "BAD_CREDENTIALS" });
  }
}

/** 欠费 / 余额不足 / 套餐到期等账号状态问题 */
export class NetAccountError extends NetAuthError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "ACCOUNT" });
  }
}

/** 终端 MAC 未绑定 / 绑定数超限 */
export class NetMacBindingError extends NetAuthError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "MAC_BINDING" });
  }
}

/** IP 不在允许范围 / 与已登录终端冲突 */
export class NetIpError extends NetAuthError {
  constructor(init: Omit<NetErrorInit, "code">) {
    super({ ...init, code: "IP" });
  }
}

/** 需要验证码（当前版本不自动识别，需人工介入） */
export class NetCaptchaRequiredError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "CAPTCHA_REQUIRED", ...init });
  }
}

/** 需要短信二次验证 */
export class NetSmsAuthRequiredError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "SMS_REQUIRED", ...init });
  }
}

/** 该账号 / 终端已经在线（登录会被拒绝，但事实上已联网） */
export class NetAlreadyOnlineError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "ALREADY_ONLINE", ...init });
  }
}

/** 当前不在线（getOnlineUserInfo 明确返回未登录 / 已下线） */
export class NetOfflineError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "OFFLINE", ...init });
  }
}

/** 登录被拒绝，但无法进一步归类 */
export class NetLoginRejectedError extends NetError {
  constructor(init: NetSubErrorInit) {
    super({ code: "LOGIN_REJECTED", ...init });
  }
}
