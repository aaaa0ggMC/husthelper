import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const semester = await client.register.getSemester();
  console.log(`${semester.XQH} ${semester.XQMC}（${semester.startDate} ~ ${semester.endDate}）`);

  const status = await client.register.getStatus();
  console.log(`注册状态: ${status.status}（已注册=${status.registered}）`);

  const notices = await client.register.getNotices({ pageNum: 1, pageSize: 5 });
  console.log(`注册通知 ${notices.total} 条`);
  for (const notice of notices.rows) {
    console.log(`  ${notice.PUBLISHDATE} [${notice.ARTICLEID}] ${notice.ARTICLETITLE}`);
  }
} catch (error) {
  console.warn("获取注册信息失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
