import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

/**
 * 宿舍电费查询示例（sdhq 移动后勤，SM2/SM3 鉴权）。
 *
 * 电表的定位链路是「校区 → 楼栋 → 楼层 → 房间 → 电表」，房间/电表的 ID 与你宿舍相关，
 * 因此这里既支持直接指定，也支持先枚举出来：
 *
 *   node examples/get_electricity.ts                 # 枚举校区/楼栋
 *   HUST_ROOM_ID=<Room_ID> node examples/get_electricity.ts
 *   HUST_METER_ID=<MeterID> node examples/get_electricity.ts
 */
const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd, account: config.account })
  .withStdChar()
  .persistent(".hust-session.json");

const roomId = process.env.HUST_ROOM_ID;
const meterId = process.env.HUST_METER_ID;

try {
  if (roomId) {
    const data = await client.electricity.getRoomBalance(roomId);
    console.log(
      `${data.meter.roomAddr || roomId}: 剩余 ${data.remainPower} ${data.unit}（${data.state}）`,
    );
  } else if (meterId) {
    console.log(await client.electricity.getBalance(meterId));
  } else {
    const areas = await client.electricity.getAreas();
    console.log("可用校区:", areas);
    for (const area of areas) {
      const buildings = await client.electricity.getBuildings(area.areaId);
      console.log(`- ${area.areaName} (${area.areaId}) 楼栋:`, buildings);
    }
    console.log("用 HUST_ROOM_ID=<Room_ID> 可查询具体房间的电表与余额");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
