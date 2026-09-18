# 聚合层（client.aggregate）

`client.aggregate` 把各子平台的信息按「资源」聚合起来，尽量给出最全面的结果。

- **不持有 session/cookie/凭据**，只引用 `client.one` / `client.smartcourse` / `client.ecard` / `client.mhub` / `client.hkwxy`。
- 读取某个属性时，按内置 schema（`AGGREGATE_SCHEMA`）**并发**调用多个来源（`Promise.allSettled`），再把成功的结果合并。
- 同一信息多来源时，**优先高优先级来源**；重复项按 key 去重，缺失字段用次优先级来源回填。
- **仅当所有来源都失败/无数据时**才抛 `AggregateError`；任一来源成功即返回。

## 资源（属性）

| 属性 | 来源（优先级） | 说明 |
| --- | --- | --- |
| `me` | `one.myInfo` › `ecard.profile` › `smartcourse.loginUser` | 姓名/学号/院系/身份/邮箱/手机/头像/puid |
| `balance` | `one.balance` › `ecard.profile` | 校园卡、网费、电子账户余额 |
| `notifications`（别名 `notifies`） | `one.notifications` › `smartcourse.notices` | 通知，按标题去重 |
| `documents`（别名 `news`） | `one.documents` | 公文/新闻，按 FID 去重 |
| `courses` | `smartcourse.courseList` + `smartcourse.studyCourses` | `enrolled` / `teaching` / `online` / `all` |
| `schedule` | `smartcourse.myLessons` | 学期/周次 + 逐次课 |
| `today` | `smartcourse.oneDayLessons` + `one.weekActivities` | 今天的课与日程 |
| `activities` | `one.weekActivities` | 本周日程（默认周一到周日） |
| `email` | `one.emailInfo` › `one.myInfo` | 邮箱地址/SSO 链接/未读数 |
| `term` | `one.learnWeek` › `smartcourse.curriculum` › `mhub.terms` | 教学周、学期号 |
| `grades` | `mhub.grades` | 可选学年 + 当前学期成绩 |
| `devices` | `hkwxy.onlineDevices` | 在线设备 |
| `transactions` | `ecard.transactions` | 一卡通流水首页 |
| `exams` | `mhub.exams` | 学业考试安排（默认当前学期） |
| `freeRooms` | `mhub.freeRooms` | 空闲教室（需 `building`，日期默认今天） |
| `fitness` | `petyxy.fitness` | 体质测试成绩（默认当前学期） |
| `credit` | `ihuster.credit` | 第二课堂学分汇总 |
| `registration` | `register.registration` | 学期注册状态与当前学期 |
| `reserves` | `pecg.reserves` | 场馆预约记录 |
| `peCourses` | `pejxgl.coursesTaken` | 已修 / 已选体育课 |
| `exercise` | `pejxgl.exercise` | 课外锻炼次数（默认最新学期） |

每个列表项都带 `source`（来源标签）与 `raw`（该来源的原始对象）；对象型资源带 `sources: string[]` 与 `raw: Record<来源, 原始对象>`。

## 用法

```ts
const me = await client.aggregate.me;
const notifies = await client.aggregate.notifies; // = aggregate.notifications
const courses = await client.aggregate.courses;
// { enrolled, teaching, online, all, sources, raw }

const ov = await client.aggregate.overview(); // 并发取多资源，永不 reject
// 失败的资源在 ov.errors: [{ resource, message }]
```

### 带参数 / 遍历

```ts
await client.aggregate.load("activities", { beginDate, endDate });
await client.aggregate.activitiesIn({ beginDate, endDate });
await client.aggregate.notificationsIn({ pageSize: 50 });
await client.aggregate.documentsIn({ pageNum: 1 });
await client.aggregate.transactionsIn({ page: 2 });
await client.aggregate.gradesOf({ xn: "2025", xq: 1 });

await client.aggregate.notificationsAll({ limit: 200 }); // 全量遍历（one 门户）
await client.aggregate.documentsAll({ limit: 200 });
```

### 新增资源（体育 / 注册 / 二课）

```ts
await client.aggregate.exams;                          // 当前学期考试
await client.aggregate.examsOf({ xqh: "20252", kslx: 0 }); // 补(缓)考
await client.aggregate.freeRoomsOf({ building: "C050" });  // 今天西五楼 1-2 节
await client.aggregate.fitness;                        // 当前学期体测
await client.aggregate.fitnessOf("20252");
await client.aggregate.credit;                         // 二课学分汇总
await client.aggregate.registration;                   // 注册状态 + 当前学期
await client.aggregate.reserves;                       // 场馆预约记录
await client.aggregate.peCourses;                      // 已修/已选体育课
await client.aggregate.exerciseOf({ xqh: "20252" });   // 课外锻炼次数
```

## 扩展

新增聚合资源 = 在 `AGGREGATE_SCHEMA` 加一条 `{ sources, merge, defaultArgs? }`，并加一个属性 getter。
来源可以是任意返回 Promise 的命名空间方法；合并函数自行实现（可复用 `dayRange` / `weekRange`）。
