# 学业考试查询（mhub）

数据来自 HUB/mhub（`http://mhub.hust.edu.cn`）。与[成绩查询](./grades.md)同一个 `client.mhub`，共用 mhub 的 CAS 会话，无需额外登录。

## 认证

考试页面入口 `/ksapController/urlUserKs` 未登录时：

```
GET mhub /ksapController/urlUserKs
  -> 302 /login?url=/ksapController/urlUserKs
  -> 200（页面内 JS） top.location.href = /cas/login?redirectUrl=/ksapController/urlUserKs
```

复用已有 `CASTGC` 即可换到 mhub 的 `JSESSIONID`，同一个 cookie 对所有 `ksapController` / `CommonController` 接口都有效（成绩用 `CjcxController`、考试用 `ksapController`，同一应用）。客户端自动处理，过期自动重连。

## 接口

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `getExamUser()` | `GET /CommonController/userList` | 姓名、学号、学院、专业、班级 |
| `getExamCurrentSemester()` | `GET /CommonController/xqOpthions` | 当前学期（`XQH`/`XQMC`/考试周次等） |
| `getExamSemesters()` | `GET /CommonController/getXqList` | 可选学期列表（倒序） |
| `getStudentExams(options?)` | `POST /ksapController/getStuKsxx` | 考试安排（分页） |
| `iterateStudentExams(options?)` | 同上，自动翻页 | 异步迭代器 |

## client.mhub.getStudentExams(options?)

```ts
const page = await client.mhub.getStudentExams();          // 当前学期
console.log(page.total, page.hasNextPage);

const page2 = await client.mhub.getStudentExams({ xqh: "20252", kslx: EXAM_TYPE.NORMAL });
for (const exam of page2.list) {
  console.log(exam.KSRQ, exam.KCMC, exam.JSMC, exam.DWMC);
}

for await (const exam of client.mhub.iterateStudentExams({ xqh: "20252" })) {
  // ...
}
```

请求体（`Content-Type: application/json;charset=UTF-8`）：

```json
{ "pageIndex": 1, "pageSize": 100, "kslx": "1", "kcmc": null, "xqh": "20261" }
```

`ExamQuery`：

```ts
interface ExamQuery {
  xqh?: string;        // 学期号，如 "20261"；不传自动取当前学期
  kcmc?: string | null;// 课程名模糊筛选
  kslx?: number | string; // 考试类型，默认 1
  pageIndex?: number;  // 默认 1
  pageSize?: number;   // 默认 100
}
```

`EXAM_TYPE`：`0` = 补(缓)考考试，`1` = 普通考试。

### ExamSchedule

```ts
interface ExamSchedule {
  XQH?: string;         // 学期号
  XQMC?: string;        // 学期名，如 "2026年秋季"
  KCBH?: string;        // 课程编号
  KCMC?: string;        // 课程名称
  KTBH?: string;        // 课堂编号
  KSRQ?: string;        // 考试日期与时段，如 "2026-12-05 下午"
  JSMC?: string | null; // 考试地点（教室），可能为 null
  DWMC?: string;        // 开课 / 考试学院
  PKDW?: string;
  SFID?: string; XM?: string;
  KSLX?: string | number;
  ZHSKZC?: number | null; // 综合上课周次
  SCHEDULEID?: string | null;
  [key: string]: unknown;
}
```

返回为 PageHelper 风格分页对象：`{ list, total, pageNum, pageSize, pages, hasNextPage, ... }`。参数缺失（如 `xqh` 为空）时服务端返回 `{ code: 400, message }`，本库会抛错。

## 聚合

尚未接入 `client.aggregate`，见仓库根目录 `TODO.md`。

> 字段可能随系统更新而变化，请以实际返回为准。
