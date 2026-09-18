# 成绩查询（mhub）

成绩来自 HUB 系统：`https://mhub.hust.edu.cn`。

## 认证

mhub 有自己的登录入口，但底层仍是 `pass.hust.edu.cn` 的 CAS：

```
GET mhub /CjcxController/fianCjInfo
  -> 302 mhub /login?url=...
  -> JS 跳 mhub /cas/login?redirectUrl=...
  -> 302 pass.hust.edu.cn /cas/login?service=http://mhub.hust.edu.cn/cas/login?redirectUrl=...
```

因此复用已有的 `CASTGC` 就能**免密**换到 mhub 的 ticket，再兑换 mhub 的 `JSESSIONID`，无需验证码。客户端自动处理，过期自动重连（同 wechat/ecard）。

## client.mhub.getTerms()

返回可选学年列表，用于给 `getGrades` 传 `xn`：

```ts
const terms = await client.mhub.getTerms(); // GradeTerm[]
```

## client.mhub.getGrades(options)

```ts
const grades = await client.mhub.getGrades({ xn: "2025", xq: 0 });
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `xn` | `string?` | 第一个学年 | 学年编码，如 `"2025"`（对应 2025-2026 学年） |
| `xq` | `number?` | `0` | `0` 全学年 / `1` 第一学期 / `2` 第二学期 |

不传 `xn` 时会先请求一次页面解析可选学年。

### Grades

```ts
interface Grades {
  xn: string;
  xq: number;
  courses: Course[];
  summary: GradeSummary;   // 页面直接给出的汇总（系统口径）
  computed: WeightedResult;// 本库重算的口径（见下）
  rawHtml: string;
}

interface Course {
  name: string;
  credits: number;
  score: string;            // 原始文本，如 "91" / "通过" / "缓考/"
  scoreValue: number | null;// 数值成绩，非数值为 null
  status: string | null;    // 非数值时的状态，如 "缓考/"，否则 null
  remark: string;
}

interface GradeSummary {
  weightedScore: number | null;   // 加权排名成绩
  requiredCredits: number | null; // 必修课总学分
  electiveCredits: number | null; // 公选课总学分
  totalCredits: number | null;    // 总学分
}
```

## 加权成绩的问题与修正

学校页面的「加权排名成绩」会把**缓考/缺考等非数值成绩也纳入加权**（按低分处理），导致结果偏低。反推验证：当某学期没有这类课程时，`summary.weightedScore` 与 `computed.weightedScore` 完全一致；一旦出现「缓考」，系统值就明显低于「只算数值成绩」的结果。

`computed` 的默认口径：**只统计「有数值成绩且学分 > 0」的课程**，非数值（缓考/缺考/通过/免修…）与 0 学分课程不计入。因此 `computed.weightedScore` 通常高于 `summary.weightedScore`。

> 注：系统具体把非数值课程按多少分计入未完全确定，但可以确定它**纳入了计算**并拉低了结果；本库的做法是直接排除，得到更合理的加权分。

```ts
interface WeightedResult {
  weightedScore: number | null; // Σ(成绩×学分)/Σ学分
  credits: number;              // 参与计算的学分
  counted: number;              // 参与计算的课程数
  excluded: Course[];           // 被排除的课程（含非数值、0 学分）
}
```

需要自定义时用导出的 `computeWeighted(courses, options)`：

```ts
import { computeWeighted } from "husthelper";

const result = computeWeighted(grades.courses, {
  includeStatuses: ["缓考/"], // 若想把某些状态也算进去
});
```

> 字段与 `xn/xq` 编码可能随学校系统更新而变化，请以实际返回为准。
