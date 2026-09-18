import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

try {
  const periodId = process.argv[2];
  const result = await client.petyxy.getFitnessResult(periodId);

  console.log(`${result.periodName ?? result.periodId} | 体测状态: ${result.status ?? "—"}`);
  for (const item of result.items) {
    console.log(
      `  ${item.name.padEnd(8)} ${(item.value ?? "—").padEnd(12)} ` +
        `${item.grade ?? ""} ${item.score !== undefined ? `(${item.score})` : ""}`,
    );
  }
  console.log(`总分: ${result.totalScore ?? "—"} ${result.totalGrade ?? ""}`);
  console.log(`可选学期: ${result.periods.map((p) => `${p.value}=${p.text}`).join(", ")}`);
} catch (error) {
  console.warn("获取体测成绩失败:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
