import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const overview = await client.selfservice.getOverview();
  console.log(`# 校园网自助服务（${overview.userId ?? "?"} ${overview.name ?? "?"}）`);
  if (overview.greeting) console.log(`${overview.greeting}${overview.motto ? `，${overview.motto}` : ""}`);
  if (overview.lastLoginAt) console.log(`上次登录: ${overview.lastLoginAt}`);
  console.log(`余额: ${overview.balanceText ?? "-"} 元`);
  console.log(`套餐: ${overview.package ?? "-"}`);
  console.log(`在线设备: ${overview.onlineDevices ?? "-"} 台`);
  for (const notice of overview.notices) console.log(`公告: ${notice}`);

  const devices = await client.selfservice.getOnlineDevices();
  console.log(`\n# 在线设备（${devices.online.length}）`);
  for (const device of devices.online) {
    console.log(
      `  ${device.name ?? "?"} [${device.deviceTypeText ?? "?"}] ` +
        `ip=${device.ip ?? "-"} mac=${device.mac ?? "-"} 上线=${device.onlineAt ?? "-"}`,
    );
  }
  console.log(`\n# 无感认证设备（${devices.passwordless.length}）`);
  for (const device of devices.passwordless) {
    console.log(
      `  ${device.name ?? "?"} [${device.deviceTypeText ?? "?"}] ` +
        `mac=${device.mac ?? "-"} 开启=${device.enabledAt ?? "-"}`,
    );
  }

  const profile = await client.selfservice.getProfile();
  console.log(`\n# 个人资料`);
  console.log(`  用户名: ${profile.userId ?? "-"}`);
  console.log(`  姓名: ${profile.name ?? "-"}`);
  if (profile.phone) console.log(`  手机: ${profile.phone}`);
} catch (error) {
  console.warn("获取校园网自助服务信息失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
