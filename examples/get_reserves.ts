import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const reserves = await client.pecg.getMyReserveList();
  console.log(`预约记录 ${reserves.length} 条`);
  for (const reserve of reserves) {
    console.log(
      `[${reserve.reserveId}] ${reserve.useTime} ${reserve.venue} ${reserve.court} ` +
        `${reserve.orderStatus ?? ""} ${reserve.payStatus ?? ""} ￥${reserve.amount ?? 0}`,
    );
  }
} catch (error) {
  console.warn("获取场馆预约记录失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
