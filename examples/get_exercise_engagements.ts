import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const semesters = await client.pejxgl.getSemesters();
  console.log(`共 ${semesters.length} 个学期`);
  for (const semester of semesters) {
    console.log(`  ${semester.xqh} ${semester.xqmc}${semester.dqxq ? "（当前学期）" : ""}`);
  }

  const xqh = process.argv[2] ?? semesters[0]?.xqh;
  if (!xqh) throw new Error("没有可用学期，请手动传入学期号");

  const rows = await client.pejxgl.getNumberOfEngagements(xqh);
  if (rows.length === 0) {
    console.log(`${xqh} 暂无数据（当前学期通常要到学期末才汇总）`);
  }
  for (const row of rows) {
    console.log(
      `${row.xqh} 总次数 ${row.zcs ?? 0}：` +
        `APP ${row.hzdtycs ?? 0} / 辅导班 ${row.fdbcs ?? 0} / 促进课 ${row.cjkcs ?? 0} / ` +
        `代表队 ${row.ptsdbtcs ?? 0} / 赛事 ${row.tysscs ?? 0} / 场馆 ${row.cgdlcs ?? 0}`,
    );
  }
  const taken = await client.pejxgl.getCoursesTaken();
  console.log(`\n已修 / 已选体育课 ${taken.length} 门`);
  for (const course of taken) {
    const score = course.bfzcj ?? "—";
    console.log(`  ${course.xqmc ?? course.xqh} ${course.kcmc}  ${course.kczxf} 学分  成绩 ${score}  ${course.cjzt}`);
  }
} catch (error) {
  console.warn("获取体育数据失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
