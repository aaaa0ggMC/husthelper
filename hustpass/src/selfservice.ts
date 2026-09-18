import type { AxiosResponse } from "axios";
import type { CasResponse, CasService } from "./cas.ts";
import type { RequestOptions } from "hustcore";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 校园网自助服务系统（myself.hust.edu.cn:8080/selfservice）。
 *
 * 这是一个**标准 CAS 应用**：未登录访问任意页面都会 302 到
 * `pass.hust.edu.cn/cas/login?service=http://myself.hust.edu.cn:8080/selfservice/module/scgroup/web/sso.jsf`。
 * 换票链路由 `CASTGC` 驱动：
 *
 * 1. GET  pass /cas/login?service=<sso.jsf>  → 302 sso.jsf?ticket=ST-...
 * 2. GET  myself sso.jsf?ticket=ST           → 302 webcontent/web/index_self_hk.jsf?
 * 3. GET  myself index_self_hk.jsf           → 200（种下 `JSESSIONID`，Path=/selfservice）
 *
 * 服务端页面为 **GBK** 编码、服务端渲染 HTML，因此本模块统一以 `arraybuffer`
 * 取回后按 GBK 解码，再用解析函数抽取数据。
 *
 * 会话失效时自助系统**不会** 302 回 CAS，而是返回 200 的提示页：
 * - 首页 / 个人资料等：脚本里出现 `entry.jsp`（`您还未登录或会话过期...`）；
 * - 在线设备等模块：通用错误页，引用 `common/imgs/alert.png`。
 * `isSelfserviceLoginRedirect` 据此识别并触发自动续期。
 */

export const SELFSERVICE_HOST = "myself.hust.edu.cn";
export const SELFSERVICE_BASE = `http://${SELFSERVICE_HOST}:8080`;
/** 传给 CAS 的 service：自助系统 SSO 入口 */
export const SELFSERVICE_SERVICE = `${SELFSERVICE_BASE}/selfservice/module/scgroup/web/sso.jsf`;
export const SELFSERVICE_SESSION_COOKIE = "JSESSIONID";

const INDEX_PATH = "/selfservice/module/webcontent/web/index_self_hk.jsf";
const ONLINE_DEVICE_PATH = "/selfservice/module/webcontent/web/onlinedevice_list_hk.jsf";
const PROFILE_PATH = "/selfservice/module/userself/web/regpassuserinfo_update_hk.jsf";
/** 设备操作（踢下线 / 无感认证）的 AJAX 入口 */
const USERSELF_AJAX_PATH = "/selfservice/module/userself/web/userself_ajax.jsf";

/** GBK 字节转字符串（会话失效标记与页面解析都依赖它） */
function bodyAscii(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString("latin1");
  return "";
}

/** 自助系统会以 200 + 提示页表示会话过期，需自定义失效判定 */
export function isSelfserviceLoginRedirect(response: CasResponse): boolean {
  const location = response.headers["location"];
  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    (location.includes("/cas/login") || location.includes("/sso.jsf"))
  ) {
    return true;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  if (!contentType.includes("text/html")) return false;
  const body = bodyAscii(response.data);
  return body.includes("entry.jsp") || body.includes("common/imgs/alert.png");
}

/** 校园网自助服务系统作为 CAS 应用的声明 */
export const selfserviceService: CasService = {
  name: "selfservice",
  host: SELFSERVICE_HOST,
  base: SELFSERVICE_BASE,
  service: SELFSERVICE_SERVICE,
  sessionCookie: SELFSERVICE_SESSION_COOKIE,
  isLoginRedirect: isSelfserviceLoginRedirect,
};

export function selfserviceUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${SELFSERVICE_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/* --------------------------------- 数据模型 --------------------------------- */

/** 首页概览（服务端渲染 HTML 解析结果） */
export interface SelfserviceOverview {
  /** 登录用户名（学号 / 工号），如 "U2025xxxxx" */
  userId?: string;
  /** 姓名，如 "张三" */
  name?: string;
  /** 问候语，如 "晚上好" */
  greeting?: string;
  /** 首页励志语，如 "网络虽美，但不要过度沉迷哦" */
  motto?: string;
  /** 上次登录时间，如 "2025-10-10 15:53:41" */
  lastLoginAt?: string;
  /** 账户余额（元）；无法解析时为 undefined */
  balance?: number;
  /** 余额原文（保留服务端小数位），如 "21.87" */
  balanceText?: string;
  /** 当前套餐名，如 "100元包半年" */
  package?: string;
  /** 在线设备数 */
  onlineDevices?: number;
  /** 账户 UUID（服务端 `accountInfoUuid`，在线充值 / 套餐变更用） */
  accountUuid?: string;
  /** 是否可充值 */
  canCharge?: boolean;
  /** 是否可变更套餐 */
  canChangePackage?: boolean;
  /** 是否可修改区域 */
  canChangeArea?: boolean;
  /** 是否可修改个人资料 */
  canUpdateUserinfo?: boolean;
  /** 通知公告（`forPublishContent` 去标签后的纯文本） */
  notices: string[];
}

/** 一台当前在线设备 */
export interface SelfserviceOnlineDevice {
  /** 设备标识（页面 `label` 的 id） */
  id?: string;
  /** 设备名（用户可改，默认「我的设备」） */
  name?: string;
  /** 用户 IPv4，如 "10.0.0.10" */
  ip?: string;
  /** 用户 MAC（无分隔符），如 "AABBCCDDEEFF" */
  mac?: string;
  /** 设备类型码（服务端原文，如 "1"） */
  deviceType?: string;
  /** 设备图标标题，如 "个人电脑" */
  deviceTypeText?: string;
  /** 上线时间，如 "09-18 19:11:58" */
  onlineAt?: string;
  /** 强制下线操作标识（`offline()` 入参） */
  offlineId?: string;
}

/** 一台开启无感认证的设备 */
export interface SelfservicePasswordlessDevice {
  /** 设备标识（页面 `label` 的 id） */
  id?: string;
  /** 设备名 */
  name?: string;
  /** 用户 MAC，如 "112233445566" */
  mac?: string;
  /** 设备类型码（服务端原文） */
  deviceType?: string;
  /** 设备图标标题，如 "其他设备" */
  deviceTypeText?: string;
  /** 无感认证开启时间，如 "2026-09-18 12:12:08" */
  enabledAt?: string;
  /** 关闭无感认证操作标识（`cancelNoSense()` 入参） */
  cancelNoSenseId?: string;
}

/** 在线设备查询结果 */
export interface SelfserviceOnlineDeviceResult {
  /** 当前在线设备 */
  online: SelfserviceOnlineDevice[];
  /** 其他无感认证（免密 MAC）设备 */
  passwordless: SelfservicePasswordlessDevice[];
}

/** 个人资料（`regpassuserinfo_update_hk.jsf`） */
export interface SelfserviceProfile {
  /** 用户名，如 "U2025xxxxx" */
  userId?: string;
  /** 姓名 */
  name?: string;
  /** 手机号（页面预填值，可能为空） */
  phone?: string;
}

/** 写操作（踢下线 / 无感认证）的返回结果 */
export interface SelfserviceActionResult {
  /** 服务端是否成功（响应不以 `false` 开头） */
  ok: boolean;
  /** 失败时服务端返回的信息 */
  message?: string;
  /** 服务端原始响应文本 */
  raw: string;
}

/* --------------------------------- 解析工具 --------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** 解码 HTML 实体（含十进制 / 十六进制数字实体） */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.charAt(0) === "#") {
      const hex = entity.charAt(1).toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** 去注释、去标签 + 解码实体 + 折叠空白 */
function cleanText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** 取指定 id 的隐藏 input 的 value（忽略属性顺序） */
function hiddenValue(html: string, id: string): string | undefined {
  const match = html.match(new RegExp(`id="${id}"[^>]*\\bvalue="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : undefined;
}

/** 取 “某前缀 + 任意后缀” 的第一个隐藏 input 值（设备 id 后缀不固定） */
function hiddenValuePrefix(html: string, prefix: string): string | undefined {
  const match = html.match(new RegExp(`id="${prefix}[^"]*"[^>]*\\bvalue="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : undefined;
}

/** 取 `<div ... title="X">值</div>` 的文本（跳过只含图片的同名 div） */
function titledText(html: string, title: string): string | undefined {
  const match = html.match(
    new RegExp(`<div[^>]*title="${title}"[^>]*>\\s*([^<]+?)\\s*</div>`, "i"),
  );
  if (!match) return undefined;
  const value = cleanText(match[1]);
  return value || undefined;
}

function toBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === "true";
}

/* ---------------------------------- 解析 ---------------------------------- */

/** 解析首页 `index_self_hk.jsf` 概览 */
export function parseSelfserviceOverview(html: string): SelfserviceOverview {
  const nameAndGreeting = html.match(/<span[^>]*font-size:40px[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const head = cleanText(nameAndGreeting ?? "");
  const parts = head.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  const name = parts[0];
  const greeting = parts[1];

  const motto = cleanText(
    html.match(/<span[^>]*font-family:Microsoft YaHei[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "",
  );
  const hyt2 = cleanText(html.match(/<span class="hyt2">([\s\S]*?)<\/span>/i)?.[1] ?? "");

  const balanceBlock = html.match(/id="feeChargeModule"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const balanceText = cleanText(
    balanceBlock.match(/<span class="big">([\s\S]*?)<\/span>/i)?.[1] ?? "",
  ).replace(/[^\d.-]/g, "");
  const balance = balanceText && Number.isFinite(Number(balanceText)) ? Number(balanceText) : undefined;

  const onlineBlock = html.match(/id="onlineNumModule"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const onlineText = cleanText(
    onlineBlock.match(/<span class="big">([\s\S]*?)<\/span>/i)?.[1] ?? "",
  ).replace(/[^\d]/g, "");
  const onlineDevices = onlineText ? Number(onlineText) : undefined;

  const notices: string[] = [];
  for (const match of html.matchAll(/class="forPublishContent"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const text = cleanText(match[1]);
    if (text) notices.push(text);
  }

  return {
    userId: hiddenValue(html, "hiddenuserId"),
    name,
    greeting,
    motto,
    lastLoginAt: /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/.exec(hyt2)?.[1],
    balance,
    balanceText: balanceText || undefined,
    package: hiddenValue(html, "packageName"),
    onlineDevices,
    accountUuid: hiddenValue(html, "accountInfoUuid"),
    canCharge: toBool(hiddenValue(html, "canchargefee")),
    canChangePackage: toBool(hiddenValue(html, "canchangepackage")),
    canChangeArea: toBool(hiddenValue(html, "canchangearea")),
    canUpdateUserinfo: toBool(hiddenValue(html, "canUpdateUserinfo")),
    notices,
  };
}

/** 从在线设备页里截取某个 fieldset 区块（到下一个区块 id 为止） */
function deviceSection(html: string, id: string, nextId?: string): string {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const end = nextId ? html.indexOf(`id="${nextId}"`, start) : -1;
  return html.slice(start, end > start ? end : undefined);
}

const DEVICE_LABEL =
  /<label\s+id="([^"]*)"[^>]*onclick="showchangename\('([^']*)','([^']*)'\)"[^>]*>([\s\S]*?)<\/label>/i;
const DEVICE_ICON = /<img\s+title="([^"]+)"\s+src="[^"]*\/(?:pc|phone|pad|otherterminal|wirelessdevice)\.png"/i;

/** 解析在线设备页 `onlinedevice_list_hk.jsf` */
export function parseSelfserviceOnlineDevices(html: string): SelfserviceOnlineDeviceResult {
  const onlineSection = deviceSection(html, "mainDeviceDiv", "mainNSDeviceDiv");
  const nsSection = deviceSection(html, "mainNSDeviceDiv");
  return {
    online: parseOnlineSection(onlineSection),
    passwordless: parsePasswordlessSection(nsSection),
  };
}

function parseOnlineSection(section: string): SelfserviceOnlineDevice[] {
  const devices: SelfserviceOnlineDevice[] = [];
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const block = row[1];
    const label = block.match(DEVICE_LABEL);
    if (!label) continue;
    devices.push({
      id: label[1] || label[2] || undefined,
      name: cleanText(label[4]) || undefined,
      ip: hiddenValuePrefix(block, "userIp4") || titledText(block, "IP地址"),
      mac: hiddenValuePrefix(block, "usermac") || label[3] || undefined,
      deviceType: hiddenValuePrefix(block, "devicetype"),
      deviceTypeText: block.match(DEVICE_ICON)?.[1],
      onlineAt: titledText(block, "上线时间"),
      offlineId: block.match(/offline\('([^']*)'\)/i)?.[1],
    });
  }
  return devices;
}

function parsePasswordlessSection(section: string): SelfservicePasswordlessDevice[] {
  const devices: SelfservicePasswordlessDevice[] = [];
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const block = row[1];
    const label = block.match(DEVICE_LABEL);
    if (!label) continue;
    devices.push({
      id: label[1] || label[2] || undefined,
      name: cleanText(label[4]) || undefined,
      mac: hiddenValuePrefix(block, "usermac") || label[3] || undefined,
      deviceType: hiddenValuePrefix(block, "devicetype"),
      deviceTypeText: block.match(DEVICE_ICON)?.[1],
      enabledAt: titledText(block, "无感认证的开启时间"),
      cancelNoSenseId: block.match(/cancelNoSense\('([^']*)'\)/i)?.[1],
    });
  }
  return devices;
}

/** 解析个人资料页 `regpassuserinfo_update_hk.jsf` */
export function parseSelfserviceProfile(html: string): SelfserviceProfile {
  const userId = cleanText(
    html.match(/id="RegUserinfoForm:userId"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "",
  );
  const name = cleanText(
    html.match(/id="RegUserinfoForm:userName"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "",
  );
  const phone = html.match(/id="tel"[^>]*\bvalue="([^"]*)"/i)?.[1];
  return {
    userId: userId || undefined,
    name: name || undefined,
    phone: phone || undefined,
  };
}

/* ---------------------------------- API ---------------------------------- */

/** 校园网自助服务系统 API：`client.selfservice` */
export class SelfserviceApi {
  private readonly runtime: ClientRuntime;

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(SELFSERVICE_SESSION_COOKIE, SELFSERVICE_HOST);
  }

  /** 以 GBK 解码取回自助系统文本（页面为 `text/html;charset=gbk`） */
  private async requestGbk(path: string, config: RequestOptions = {}): Promise<string> {
    const response = await this.runtime.serviceRequest<ArrayBuffer>(
      selfserviceService,
      selfserviceUrl(path),
      { ...config, responseType: "arraybuffer" },
    );
    const data = response.data;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return new TextDecoder("gbk").decode(buffer);
  }

  /** 调用 `userself_ajax.jsf` 上的 AJAX 方法（POST 表单 `key=` 参数） */
  private async action(methodName: string, key: string): Promise<SelfserviceActionResult> {
    const raw = (
      await this.requestGbk(`${USERSELF_AJAX_PATH}?methodName=${methodName}`, {
        method: "POST",
        data: `key=${key}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: selfserviceUrl(ONLINE_DEVICE_PATH),
        },
      })
    ).trim();

    if (raw.startsWith("false")) {
      const separator = raw.indexOf(":");
      return { ok: false, message: separator >= 0 ? raw.slice(separator + 1) : raw, raw };
    }
    return { ok: true, raw };
  }

  request<T = string>(path: string, config: RequestOptions = {}): Promise<AxiosResponse<T>> {
    return this.runtime.serviceRequest<T>(selfserviceService, selfserviceUrl(path), config);
  }

  /** 首页概览：姓名、余额、套餐、在线设备数、上次登录时间与通知公告 */
  async getOverview(): Promise<SelfserviceOverview> {
    return parseSelfserviceOverview(await this.requestGbk(INDEX_PATH));
  }

  /** 在线设备与无感认证设备列表 */
  async getOnlineDevices(): Promise<SelfserviceOnlineDeviceResult> {
    return parseSelfserviceOnlineDevices(await this.requestGbk(ONLINE_DEVICE_PATH));
  }

  /** 个人资料（用户名、姓名、手机号） */
  async getProfile(): Promise<SelfserviceProfile> {
    return parseSelfserviceProfile(await this.requestGbk(PROFILE_PATH));
  }

  /**
   * 将指定在线设备踢下线（页面 `offline()` → `indexBean.kickUserBySelfForAjax`）。
   *
   * @param userId 当前用户名，可用 `getOverview().userId`
   * @param target 设备 IPv4，或 `getOnlineDevices().online` 中的设备对象
   */
  async offline(
    userId: string,
    target: string | SelfserviceOnlineDevice,
  ): Promise<SelfserviceActionResult> {
    const userIp = typeof target === "string" ? target : target.ip;
    if (!userIp) throw new Error("selfservice: 缺少设备 IP，无法踢下线");
    return this.action("indexBean.kickUserBySelfForAjax", `${userId}:${userIp}`);
  }

  /** {@link offline} 的别名 */
  kickOffline(userId: string, target: string | SelfserviceOnlineDevice) {
    return this.offline(userId, target);
  }

  /**
   * 处理指定设备的无感认证（页面 `cancelNoSense()` → `indexBean.cancelUserMabInfoforAjax`，
   * 服务端页面只暴露「关闭」这一动作）。
   *
   * @param userId 当前用户名，可用 `getOverview().userId`
   * @param target 无感认证 UUID（`getOnlineDevices().passwordless[].cancelNoSenseId`），或对应设备对象
   */
  async toggleNoSense(
    userId: string,
    target: string | SelfservicePasswordlessDevice | SelfserviceOnlineDevice,
  ): Promise<SelfserviceActionResult> {
    const id =
      typeof target === "string"
        ? target
        : "cancelNoSenseId" in target
          ? target.cancelNoSenseId
          : undefined;
    if (!id) throw new Error("selfservice: 缺少无感认证标识，无法处理");
    return this.action("indexBean.cancelUserMabInfoforAjax", `${userId}:${id}`);
  }

  /** {@link toggleNoSense} 的别名（服务端语义即「取消无感认证」） */
  cancelNoSense(
    userId: string,
    target: string | SelfservicePasswordlessDevice | SelfserviceOnlineDevice,
  ) {
    return this.toggleNoSense(userId, target);
  }
}
