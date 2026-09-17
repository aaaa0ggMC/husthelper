import hust from "../index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .persistent(".hust-session.json");

const terms = await client.mhub.getTerms();
console.log("可选学年:", terms.map((t) => `${t.XNMC}(${t.XN})`).join(", "));

const grades = await client.mhub.getGrades({ xn: terms[0]?.XN, xq: 0 });

console.log(`共 ${grades.courses.length} 门课`);
for (const course of grades.courses) {
  console.log(`  ${course.name} | ${course.credits} | ${course.score} ${course.remark}`);
}

console.log(`系统加权排名成绩: ${grades.summary.weightedScore}`);
console.log(
  `修正后加权成绩: ${grades.computed.weightedScore?.toFixed(2)} (${grades.computed.counted} 门, ${grades.computed.credits} 学分)`,
);
console.log(
  `排除: ${grades.computed.excluded.map((c) => `${c.name}(${c.score || c.status})`).join(", ")}`,
);
