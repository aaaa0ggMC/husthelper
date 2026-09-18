import crypto from "node:crypto";
import { sm2 } from "sm-crypto";
import { XMLParser } from "fast-xml-parser";
import type { CasService } from "./cas.ts";
import type { ClientRuntime } from "./runtime.ts";

/**
 * 宿舍电费查询（sdhq.hust.edu.cn「移动后勤」）。
 *
 * 该服务本身不面向 CAS 的普通应用形态，而是：
 * 1. 经 CAS 换取 `.../neusoftcas.aspx` 的 ASP.NET 会话；
 * 2. 业务接口（`PurchaseWebService.asmx`）额外要求 SM2 加密 + SM3 签名的一组请求头
 *    （`X-AuthToken` / `X-Timestamp` / `X-Signature`），其中凭据为服务端固定的接口账号，
 *    与用户无关。
 *
 * 因此这里既复用客户端的 CAS 会话（`electricityService`），又自行构造接口鉴权头。
 */

export const ELECTRICITY_HOST = "sdhq.hust.edu.cn";
export const ELECTRICITY_BASE = `http://${ELECTRICITY_HOST}/MobileUtilityPay`;
/** 该服务在 CAS 侧的 service（换取 sdhq 会话的入口） */
export const ELECTRICITY_SERVICE = `${ELECTRICITY_BASE}/cas/neusoftcas.aspx`;
/** sdhq 侧的 ASP.NET 会话 cookie */
export const ELECTRICITY_SESSION_COOKIE = "ASP.NET_SessionId";
export const ELECTRICITY_REFERER = `${ELECTRICITY_BASE}/hust/`;

/** 服务端接口公钥（SM2，非用户凭据） */
const SM2_PUBLIC_KEY =
  "044c964312722be15cdfb97434ca17b5e4bd99df4fca4c2187fcac69377fc2e63a61d80fd565f4caf7cf628143da4f3afb7316648a70f829c5750e22cfcf929518";
/** 签名盐（SM3） */
const SIGN_SALT = "Y4Pj05ynAZdYzp0wiXrTzMiANF9xfsP6Fc2Ax3hD5tc1XwyaNXjwTbAaJESD6Jap";

const ASMX = `${ELECTRICITY_BASE}/PurchaseWebService.asmx`;

export const electricityService: CasService = {
  name: "electricity",
  host: ELECTRICITY_HOST,
  base: ELECTRICITY_BASE,
  service: ELECTRICITY_SERVICE,
  sessionCookie: ELECTRICITY_SESSION_COOKIE,
};

export interface ElectricityArea {
  areaId: string;
  areaName: string;
}

export interface ElectricityBuilding {
  architectureId: string;
  architectureName: string;
  stories?: number;
}

export interface ElectricityRoom {
  roomNo: string;
  roomName: string;
}

export interface ElectricityMeter {
  roomNo: string;
  roomName: string;
  roomAddr: string;
  meterId: string;
}

export interface ElectricityBalance {
  remainPower: string;
  unit: string;
  state: string;
  readTime: string;
  basePrice: string;
}

export interface ElectricityRoomBalance extends ElectricityBalance {
  meter: ElectricityMeter;
}

/* -------------------------------- 内部工具 -------------------------------- */

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord);
  return value && typeof value === "object" ? [asRecord(value)] : [];
}

/** XML 根元素名不固定，统一把 `resultInfo` 所在层取出 */
function unwrap(parsed: Record<string, unknown>): Record<string, unknown> {
  if ("resultInfo" in parsed) return parsed;
  const keys = Object.keys(parsed).filter((key) => !key.startsWith("?"));
  const only = keys.length === 1 ? parsed[keys[0]] : undefined;
  return only && typeof only === "object" ? (only as Record<string, unknown>) : parsed;
}

/** SM2 加密接口凭据并做 SM3 签名，生成三个鉴权头（每次请求时间戳不同） */
export function electricityAuthHeaders(now: number = Math.floor(Date.now() / 1000)): Record<string, string> {
  const timestamp = String(now);
  const payload = `{"um":"phAPI","pw":"phAPI","tm":${timestamp}}`;
  // 服务端期望 gmsm 风格密文：0x04 || C1 || C3 || C2，而 sm-crypto 的 C1C3C2 输出省略了 0x04 前缀
  const authToken = `04${sm2.doEncrypt(payload, SM2_PUBLIC_KEY, 1)}`;
  const signature = crypto.createHash("sm3").update(authToken + timestamp + SIGN_SALT).digest("hex");
  return { "X-AuthToken": authToken, "X-Timestamp": timestamp, "X-Signature": signature };
}

function isHttpError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  return typeof status === "number" && status >= 400;
}

/** 电费 API：`client.electricity` */
export class ElectricityApi {
  private readonly runtime: ClientRuntime;
  private readonly parser = new XMLParser({
    ignoreAttributes: true,
    ignoreDeclaration: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ["areaInfo", "architectureInfo", "RoomInfo", "MeterInfo"].includes(name),
  });

  constructor(runtime: ClientRuntime) {
    this.runtime = runtime;
  }

  get sessionId(): string | undefined {
    return this.runtime.session()?.getCookie(ELECTRICITY_SESSION_COOKIE, ELECTRICITY_HOST);
  }

  private async call(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = `${ASMX}/${endpoint}?${new URLSearchParams(params)}`;
    const send = async (): Promise<string> => {
      const session = await this.runtime.ensureService(electricityService);
      const response = await session.get<string>(url, {
        responseType: "text",
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: ELECTRICITY_REFERER,
          ...electricityAuthHeaders(),
        },
      });
      return typeof response.data === "string" ? response.data : "";
    };

    let body: string;
    try {
      body = await send();
    } catch (error) {
      if (!isHttpError(error)) throw error;
      this.runtime.logger.warn("electricity: 会话已失效，重新获取");
      const session = await this.runtime.ensureService(electricityService);
      session.deleteCookie(ELECTRICITY_SESSION_COOKIE, ELECTRICITY_HOST);
      await this.runtime.ensureService(electricityService);
      body = await send();
    }

    const parsed = unwrap(this.parser.parse(body) as Record<string, unknown>);
    const info = asRecord(parsed.resultInfo);
    if (text(info.result) !== "1") {
      throw new Error(`电费接口失败: ${text(info.msg) || "未知错误"}`);
    }
    return parsed;
  }

  /** 查询校区列表 */
  async getAreas(): Promise<ElectricityArea[]> {
    const parsed = await this.call("getAreaInfo", { areaType: "0" });
    return asList(asRecord(parsed.areaInfoList).areaInfo).map((item) => ({
      areaId: text(item.AreaID),
      areaName: text(item.AreaName),
    }));
  }

  /** 查询某校区下的楼栋 */
  async getBuildings(areaId: string): Promise<ElectricityBuilding[]> {
    const parsed = await this.call("getArchitectureInfo", { Area_ID: areaId });
    return asList(asRecord(parsed.architectureInfoList).architectureInfo).map((item) => ({
      architectureId: text(item.ArchitectureID),
      architectureName: text(item.ArchitectureName),
      stories: item.ArchitectureStorys === undefined ? undefined : Number(item.ArchitectureStorys),
    }));
  }

  /** 查询某楼栋指定楼层的房间 */
  async getRooms(architectureId: string, floor: number): Promise<ElectricityRoom[]> {
    const parsed = await this.call("getRoomInfo", {
      Architecture_ID: architectureId,
      Floor: String(floor),
    });
    return asList(asRecord(parsed.roomInfoList).RoomInfo).map((item) => ({
      roomNo: text(item.RoomNo),
      roomName: text(item.RoomName),
    }));
  }

  /** 查询房间对应的电表信息 */
  async getRoomMeterInfo(roomId: string): Promise<ElectricityMeter> {
    const parsed = await this.call("getRoomMeterInfo", { Room_ID: roomId });
    const room = asRecord(parsed.roomInfo);
    const meters = asList(asRecord(parsed.meterList).MeterInfo);
    return {
      roomNo: text(room.RoomNo),
      roomName: text(room.RoomName),
      roomAddr: text(room.RoomAddr),
      meterId: meters.length > 0 ? text(meters[0].meterId) : "",
    };
  }

  /** 按电表 ID 查询剩余电量 */
  async getBalance(meterId: string): Promise<ElectricityBalance> {
    const parsed = await this.call("getReserveHKAM", { AmMeter_ID: meterId });
    return {
      remainPower: text(parsed.remainPower),
      unit: text(parsed.unit),
      state: text(parsed.state),
      readTime: text(parsed.readTime),
      basePrice: text(asRecord(parsed.meterPrice).basePrice),
    };
  }

  /** 便捷方法：按房间入口页 URL 的 `Room_ID` 一步查询电表与余额 */
  async getRoomBalance(roomId: string): Promise<ElectricityRoomBalance> {
    const meter = await this.getRoomMeterInfo(roomId);
    if (!meter.meterId) throw new Error("未找到该房间对应的电表");
    const balance = await this.getBalance(meter.meterId);
    return { ...balance, meter };
  }
}
