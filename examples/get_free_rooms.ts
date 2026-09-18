import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const semesters = await client.mhub.getExamSemesters();
  const xqh = process.argv[2] ?? semesters[0]?.XQH;
  if (!xqh) throw new Error("没有可用学期");

  const buildings = await client.mhub.getTeachingBuildings();
  const keyword = process.argv[3] ?? "西五楼";
  const building = buildings.find((b) => (b.JXLMC ?? "").includes(keyword));
  if (!building?.JXLBH) throw new Error(`找不到教学楼：${keyword}`);

  const date = process.argv[4] ?? new Date().toISOString().slice(0, 10);
  const week = await client.mhub.getWeekByDate(xqh, date);
  console.log(`${xqh} ${date}：第 ${week.ZC} 周 星期${week.XQ}`);

  const result = await client.mhub.getFreeClassrooms({
    date,
    building: building.JXLBH,
    startPeriod: 1,
    endPeriod: 2,
  });
  console.log(`${building.JXLMC}（${building.JXLBH}）空闲教室 ${result.dataList.length} 间`);
  for (const room of result.dataList) {
    console.log(`  ${room.JSMC}  ${room.SZLC}楼  容量${room.JSRL}  ${room.JSBH}`);
  }
} catch (error) {
  console.warn("查询空闲教室失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
