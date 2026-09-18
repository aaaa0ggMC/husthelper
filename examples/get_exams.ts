import hust, { EXAM_TYPE } from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const xqh = process.argv[2];
  const current = await client.mhub.getExamCurrentSemester();
  console.log(`当前学期: ${current.XQH} ${current.XQMC}`);

  const page = await client.mhub.getStudentExams({
    ...(xqh ? { xqh } : {}),
    kslx: EXAM_TYPE.NORMAL,
  });
  console.log(`考试 ${page.total} 场（学期 ${xqh ?? current.XQH}，共 ${page.pages} 页）`);
  for (const exam of page.list) {
    console.log(`  ${exam.KSRQ} ${exam.KCMC} @ ${exam.JSMC ?? "地点待定"} (${exam.DWMC ?? ""})`);
  }
} catch (error) {
  console.warn("获取考试安排失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
