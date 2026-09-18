import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const sections = await client.hkwxy.getServiceCenter();
  for (const section of sections) {
    console.log(`【${section.name}】`);
    for (const group of section.groups) {
      if (group.items.length === 0) continue;
      console.log(`  ${group.name}（${group.items.length}）`);
      for (const item of group.items) {
        console.log(`    - ${item.name}  ${item.url}`);
      }
    }
  }
} catch (error) {
  console.warn("获取服务大厅失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
