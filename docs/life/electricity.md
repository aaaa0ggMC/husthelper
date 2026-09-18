# 宿舍电费（electricity）

数据来自「移动后勤」`http://sdhq.hust.edu.cn/MobileUtilityPay`。与普通 CAS 应用不同，它需要
**两条鉴权同时满足**：

1. **CAS 会话**：以 `http://sdhq.hust.edu.cn/MobileUtilityPay/cas/neusoftcas.aspx` 为 `service`
   换票后，sdhq 侧种下 `ASP.NET_SessionId`；
2. **接口请求头**：业务接口 `PurchaseWebService.asmx` 额外要求
   `X-AuthToken`（SM2 加密 `{"um":"phAPI","pw":"phAPI","tm":<ts>}`）、`X-Timestamp`、
   `X-Signature`（`SM3(X-AuthToken + timestamp + salt)`）。

其中 `um`/`pw` 是服务端固定的接口账号（与用户无关），用户身份完全由 CAS 会话决定。

> 实现位于 `hustpass/src/electricity.ts`。SM2 用 `sm-crypto`（C1C3C2，并按服务端期望补上 `0x04` 前缀），
> SM3 用 Node 原生 `crypto.createHash("sm3")`。

## 接口

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `getAreas()` | `GET getAreaInfo?areaType=0` | 校区列表 |
| `getBuildings(areaId)` | `GET getArchitectureInfo?Area_ID=` | 校区下的楼栋 |
| `getRooms(architectureId, floor)` | `GET getRoomInfo?Architecture_ID=&Floor=` | 指定楼层的房间 |
| `getRoomMeterInfo(roomId)` | `GET getRoomMeterInfo?Room_ID=` | 房间对应的电表 |
| `getBalance(meterId)` | `GET getReserveHKAM?AmMeter_ID=` | 电表剩余电量 |
| `getRoomBalance(roomId)` | 上两步组合 | 一步拿到「房间 + 余额」 |

返回均为 XML，已解析为对象。

## 用法

```ts
const areas = await client.electricity.getAreas();
// [ { areaId: "1", areaName: "主校区" }, ... ]

const balance = await client.electricity.getRoomBalance("<Room_ID>");
// { remainPower: "12.34", unit: "度", state: "正常",
//   readTime: "2026-09-18 10:00:00", basePrice: "0.57",
//   meter: { roomNo, roomName, roomAddr, meterId } }
```

见 [`examples/get_electricity.ts`](../examples/get_electricity.ts)：

```bash
node examples/get_electricity.ts                       # 枚举校区/楼栋
HUST_ROOM_ID=<Room_ID> node examples/get_electricity.ts
HUST_METER_ID=<MeterID> node examples/get_electricity.ts
```

## 字段

```ts
interface ElectricityArea     { areaId: string; areaName: string; }
interface ElectricityBuilding { architectureId: string; architectureName: string; stories?: number; }
interface ElectricityRoom     { roomNo: string; roomName: string; }
interface ElectricityMeter    { roomNo: string; roomName: string; roomAddr: string; meterId: string; }
interface ElectricityBalance {
  remainPower: string; // 剩余电量
  unit: string;        // 单位
  state: string;       // 电表状态
  readTime: string;    // 抄表时间
  basePrice: string;   // 电价
}
interface ElectricityRoomBalance extends ElectricityBalance { meter: ElectricityMeter; }
```

## 说明

- 会话失效时接口返回 403（而非 CAS 跳转），SDK 会删除 `ASP.NET_SessionId` 后自动重取一次。
- `electricityAuthHeaders(now?)` 单独导出，便于排查签名/加密问题。
- **SM2 密文字节格式（C1C3C2 + `0x04`）尚未在真机验证**：若服务端返回鉴权失败，
  优先检查该处（`sm-crypto` 的 `cipherMode` 与是否需要 `0x04` 前缀）。
- 暂未接入 `client.aggregate`（需要房间/电表配置），见仓库根目录 `TODO.md`。
