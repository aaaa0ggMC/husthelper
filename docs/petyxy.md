# 华中大体育（petyxy）

数据来自华中大体育平台 `https://petyxy.hust.edu.cn`，目前提供**体质测试成绩**查询。场馆服务（[pecg](./pecg.md)）也复用同一套 SSO。

## 认证（petyxy SSO）

`petyxy` 是企业微信 / 自建 SSO 入口：CAS 的 `service` 恒为 `http://petyxy.hust.edu.cn/ggtypt/dologin`，登录成功后 `ggtypt` 会向目标应用追加一次性 UUID ticket 并 302 过去。完整链路**全部由 CASTGC 驱动**，不需要企业微信：

```
1. GET  petyxy /ggtypt/login?service=<target>  → 200（页面内 JS 跳转 CAS）
2. GET  pass   /cas/login?service=<dologin>    → 302 petyxy /ggtypt/dologin?ticket=ST-...
3. GET  petyxy /ggtypt/dologin?ticket=ST       → 302 /ggtypt/dologin（自身）
4. GET  petyxy /ggtypt/dologin                 → 302 <target>?ticket=<uuid>
5. GET  <target>?ticket=<uuid>                 → 目标应用下发自己的 JSESSIONID
```

- `/pft` 系列（体测等）的目标是 `http://petyxy.hust.edu.cn/pft/app/index`，最终 cookie 为 `Path=/pft`；
- pecg 的目标是 `https://pecg.hust.edu.cn/cggl/appv2/loginto`，见 [场馆服务](./pecg.md)；
- 链路实现集中在 `src/petyxy.ts` 的 `acquirePetyxySession`，`client.petyxy` 与 `client.pecg` 共用；
- 未登录时 `/pft` 页面会 302 到 `/ggtypt/login?service=...`，客户端据此自动续期并重试一次。

> 同一域下 `/ggtypt` 与 `/pft` 各自持有同名 `JSESSIONID`（靠 `Path` 区分）。本库的 cookie jar 按域名存储，续期时以最后下发的 `/pft` 会话为准。

## client.petyxy.getFitnessResult(periodId?)

实际请求 `GET https://petyxy.hust.edu.cn/pft/app/resultList?periodId=<periodId>`，`periodId` 为学期号（如 `20252`），不传则取当前学期。服务端返回**预渲染 HTML**，本库用 `parseFitnessResult` 解析。

```ts
const result = await client.petyxy.getFitnessResult("20252");
console.log(result.periodName);            // 2025-2026学年第二学期
console.log(result.totalScore, result.totalGrade); // 68.2 及格
for (const item of result.items) {
  console.log(item.name, item.value, item.grade, item.score);
}
```

```ts
interface FitnessItem {
  name: string;     // 身高 / BMI / 1000米 ...
  value?: string;   // 原始数值文本（可能含单位或时间），如 "174.8 cm"、"4'02"
  grade?: string;   // 评价：良好 / 及格 / 超重 / 不及格 ...
  score?: number;   // 单项得分（页面里 "/xx" 的部分）
  raw: string;
}

interface FitnessResult {
  periodId?: string;    // 请求的学期号
  periodName?: string;  // 页面展示的学期名
  status?: string;      // 体测状态：缺项 / 完成 ...
  items: FitnessItem[]; // 各项目（不含「体测状态」「总分」）
  totalScore?: number;  // 总分
  totalGrade?: string;  // 总分评价
  periods: FitnessPeriod[]; // 可选学期列表
  raw: string;
}

interface FitnessPeriod {
  value: number | string; // 用作 periodId，如 20252
  text: string;           // "2025-2026学年第二学期"
}
```

`client.petyxy.getFitnessPeriods()` 是取 `periods` 的便捷封装。学期列表直接来自结果页内嵌的 picker 数据，无需额外请求。

## 聚合

`client.petyxy` **尚未**接入 `client.aggregate`，见仓库根目录 `TODO.md`。

> 页面结构与字段可能随系统更新而变化，请以实际返回为准。
