import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const summary = await client.ihuster.getCreditSummary();
  console.log(`二课学分 ${summary.sumCredit}（共 ${summary.sumCount} 次活动）`);
  for (const record of summary.record) {
    console.log(`  类别 ${record.category}: ${record.credit} 学分 / ${record.count} 次`);
  }

  const user = await client.ihuster.getUserInfo();
  console.log(`${user.loginName} ${user.className} ${user.departmentName} 状态:${user.stuStatusCode}`);
} catch (error) {
  console.warn("获取二课学分失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
