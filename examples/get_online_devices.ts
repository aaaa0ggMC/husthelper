import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const devices = await client.hkwxy.getOnlineDevices();
  console.log(`在线设备 ${devices.length} 台`);
  for (const [index, device] of devices.entries()) {
    console.log(`#${index + 1} ${device.onlineTime} ${device.userIpv4}`);
    for (const ipv6 of device.userIpv6) console.log(`    ${ipv6}`);
  }
} catch (error) {
  console.warn("获取在线设备失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
