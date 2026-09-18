# 空闲教室查询（mhub）

数据来自 HUB/mhub（`http://mhub.hust.edu.cn`），与[成绩](./grades.md)/[考试](./exam.md)共用 `client.mhub` 的 CAS 会话，无需额外登录。

## 接口

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `getTeachingBuildings()` | `GET /CommonController/jslOpthions` | 可查询的教学楼列表（`JXLBH` 编号 / `JXLMC` 名称） |
| `getExamSemesters()` | `GET /CommonController/getXqList` | 学期列表（见[考试文档](./exam.md)） |
| `getWeekByDate(xqh, rq)` | `GET /LsController/finddqzc?xqh=&rq=` | 某日期所在的教学周（`ZC`）与星期（`XQ`） |
| `getWeekDates(xqh, zc)` | `GET /LsController/queryrqByXqhzc?xqh=&zc=` | 某教学周周一到周日的日期 |
| `getFreeClassrooms(query)` | `GET /kxjsController/selectFreeRoom?sj=&jxlbh=&qsjcp=&jsjcp=` | 指定日期 / 教学楼 / 节次的空闲教室 |

## 典型流程

```ts
// 1. 当前学期与教学楼
const semesters = await client.mhub.getExamSemesters();
const xqh = semesters[0].XQH;                    // 如 "20261"
const buildings = await client.mhub.getTeachingBuildings();
const building = buildings.find((b) => b.JXLMC?.includes("西五楼"))!.JXLBH; // "C050"

// 2. 日期 → 教学周 → 该周日期
const { ZC } = await client.mhub.getWeekByDate(xqh!, "2026-09-18");
const days = await client.mhub.getWeekDates(xqh!, ZC!);
const friday = days.find((d) => d.xq === 5)!.rq; // "2026-09-18"

// 3. 查空闲教室（第 1-2 节）
const result = await client.mhub.getFreeClassrooms({
  date: friday!,
  building: building!,
  startPeriod: 1,
  endPeriod: 2,
});
for (const room of result.dataList) {
  console.log(room.JSMC, room.SZLC, room.JSRL, room.JSBH);
}
```

## getFreeClassrooms(query)

```ts
interface FreeRoomQuery {
  date: string;        // sj，格式 "YYYY-MM-DD"
  building: string;    // jxlbh，教学楼编号
  startPeriod?: number;// qsjcp，起始节次，默认 1
  endPeriod?: number;  // jsjcp，结束节次，默认 2
}
```

```ts
interface FreeRoomResult {
  borrowDate?: string;   // 日期
  jxlbh?: string;
  building?: string;
  buildingCode?: string;
  buildingText?: string;
  str?: string;          // 头部提示，如 "2026秋季学期- 张三(U2025xxxxx)"
  dataList: FreeRoom[];  // 空闲教室
  [key: string]: unknown;
}

interface FreeRoom {
  JSBH?: string;   // 教室编号，如 "C05002002"
  JSMC?: string;   // 教室名称，如 "202教室"
  JXLBH?: string;  // 教学楼编号
  SZLC?: number;   // 所在楼层
  JSRL?: number;   // 教室容量
  DWBH?: string;   // 单位编号
  [key: string]: unknown;
}
```

### TeachingBuilding

```ts
interface TeachingBuilding {
  JXLBH?: string;   // 教学楼编号（getFreeClassrooms 的 building）
  JXLMC?: string;   // 名称，如 "西五楼"
  JXLLC?: number;   // 楼层数
  LDBH?: string;    // 楼栋编号
  XQ?: string;      // 校区代码
  JXLSFKY?: string; // 是否可借用
  [key: string]: unknown;
}
```

## 聚合

尚未接入 `client.aggregate`，见仓库根目录 `TODO.md`。

> 字段可能随系统更新而变化，请以实际返回为准。
