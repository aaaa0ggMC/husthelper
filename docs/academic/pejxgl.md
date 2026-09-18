# 体育教学管理（pejxgl）

数据来自华中科技大学体育教学管理系统 `https://pejxgl.hust.edu.cn`。提供学期列表、课外锻炼次数与已修/已选体育课查询。

## 认证

pejxgl 是普通 CAS 应用。登录页上「统一身份认证」入口会 302 到 CAS：

```
GET pejxgl /cas/auth
  -> 302 pass.hust.edu.cn /cas/login?service=https%3A%2F%2Fpejxgl.hust.edu.cn%2Fcas%2Fauth
```

复用已有 `CASTGC` 即可免密换票，兑换 pejxgl 自己的 `JSESSIONID`。客户端自动处理，过期自动重连。

> 与 mhub / hkwxy 不同，pejxgl 会话失效时跳的是**自身的** `/login`（而非 CAS 的 `/cas/login`），
> 本库用自定义的 `isPejxglLoginRedirect` 识别，因此同样能自动续期。

## client.pejxgl

```ts
const semesters = await client.pejxgl.getSemesters();
console.log(semesters[0].xqh, semesters[0].xqmc); // 20261 2026年秋季

const rows = await client.pejxgl.getNumberOfEngagements("20252");
console.log(rows[0]?.zcs); // 总次数
```

### getSemesters(type?)

实际请求 `GET /simpleSemester/{type}`，默认 `type=8`（页面下拉框的数据源），返回按时间倒序的学期数组。该接口无需学期参数、复用同一 `JSESSIONID`，作为 `getNumberOfEngagements` 的入参来源。

```ts
interface PeSemester {
  xqh?: string;        // 学期号，如 "20261"
  xqmc?: string;       // 学期名称，如 "2026年秋季"
  weeks?: number | null;
  dqxq?: number;       // 是否当前学期（1 是，0 否）
  [key: string]: unknown;
}
```

### getNumberOfEngagements(xqh)

实际请求
`GET /student/extracurricular-exercise/{xqh}/number-of-engagements`，
返回该学期的锻炼次数统计数组（字段为服务端原文，全部可选）。

> [!IMPORTANT]
> **当前学期在学期末才会汇总数据。** 学期进行中查询当前学期通常返回**空数组** `[]`，
> 这是系统正常行为，并非接口或认证失败；历史学期可正常返回数据。

```ts
interface ExerciseEngagement {
  xqh?: string;        // 学期号，如 "20252"
  sfid?: string;       // 学号（服务端字段名）
  hzdtycs?: number;    // 华中大体育 APP 次数
  fdbcs?: number;      // 辅导班次数
  cjkcs?: number;      // 促进课次数
  ptsdbtcs?: number;   // 普通生代表队训练次数
  tysscs?: number;     // 体育赛事参与次数
  cgdlcs?: number;     // 场馆锻炼次数
  zcs?: number;        // 总次数
  [key: string]: unknown;
}
```

### getCoursesTaken()

实际请求 `GET /student/courses_taken/list`，**无参数**，返回跨全部学期的已修 / 已选体育课。含尚未出分的「已选」课程（`bfzcj` 为 `null`、`cjzt` 为 `"已选"`），因此也可用于查看未来学期已选课程。

```ts
interface TakenCourse {
  xqh?: string;          // 学期号，如 "20251"
  xqmc?: string;         // 学期名称，如 "2025年秋季"
  kcbh?: string;         // 课程编号
  kcmc?: string;         // 课程名称
  kczxs?: number;        // 总学时
  kczxf?: number;        // 总学分
  bfzcj?: number | null; // 百分制成绩；未出分时为 null
  cjzt?: string;         // 成绩状态：正常 / 补考 / 重修 / 已选
  skjs?: string;         // 授课教师，多人以逗号分隔
  [key: string]: unknown;
}
```

## 聚合

目前 `client.pejxgl` **尚未**接入 `client.aggregate`，后续会把锻炼次数纳入聚合层，见仓库根目录 `TODO.md`。

> 字段可能随学校系统更新而变化，请以实际返回为准。
