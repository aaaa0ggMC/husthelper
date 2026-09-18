# IHuster 微平台 / 第二课堂（ihuster）

数据来自 IHuster 微平台 `http://ihuster.hust.edu.cn:82`，目前提供**二课学分汇总**与用户信息。它走 OAuth/JWT，不是 JSESSIONID。

## 认证（CAS → JWT）

CAS 换票后不种会话 cookie，而是在 302 的 URL **fragment** 里带回一个 JWT，前端取出后作为 `Authorization: Bearer <jwt>` 调用 `/web/**` 接口：

```
1. GET  pass    /cas/login?service=<ihuster login?pageUrl=..&targetUrl=..>
                                          → 302 回到该 service（追加 &ticket=ST-...）
2. GET  ihuster /web/cas/cas/login?...&ticket=ST-...
                                          → 302 http://ihuster.hust.edu.cn/#/?loginName=<jwt>&pageUrl=...
3. 解析 fragment 里的 loginName（JWT），之后接口带 Authorization: Bearer <jwt>
```

- CAS `service` 固定为
  `http://ihuster.hust.edu.cn/web/cas/cas/login?pageUrl=http://ihuster.hust.edu.cn:82/&targetUrl=HUAKEaHR0cDovL2lodXN0ZXIuaHVzdC5lZHUuY24v`
  （`targetUrl` = `"HUAKE" + base64("http://ihuster.hust.edu.cn/")`）。
- JWT 为 HS512；`sub` 是用户信息 JSON 字符串（学号、姓名、`userId` 等），`exp` 约 7 天。
- 本库把 JWT 缓存在共享 session 的 `ihuster_token` 里（复用 one.hust 的持久化方式），过期自动重换。

> `userId` 是大整数，JSON 解析会丢精度，本库从 `sub` 原文提取精确值。

## 接口

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `getCreditSummary()` | `POST /web/activity-front/creditsummary/summaryQuery`（body `{}`） | 二课学分汇总 |
| `getUserInfo(userNum?)` | `POST /web/admin/admin/sys/user/queryUserInfo`（body `{userNum}`） | 用户信息；`userNum` 缺省取 JWT 的 `userId` |

```ts
const summary = await client.ihuster.getCreditSummary();
console.log(summary.sumCredit, summary.sumCount); // "15.0" "3"
for (const r of summary.record) {
  console.log(r.category, r.credit, r.count); // 分类、学分、次数
}

const user = await client.ihuster.getUserInfo();
console.log(user.loginName, user.className, user.departmentName, user.stuStatusCode);

client.ihuster.profile; // 同步：从当前 JWT 解出的 { code, name, userId, ... }
```

### 字段

```ts
interface CreditSummary {
  sumCount?: string;   // 总活动次数
  sumCredit?: string;  // 总学分
  record: CreditSummaryRecord[];
  [key: string]: unknown;
}

interface CreditSummaryRecord {
  credit?: string;     // 该类别已获学分
  category?: string;   // 类别 id
  count?: string;      // 该类别活动次数
  userId?: string;
  userName?: string;
  [key: string]: unknown;
}
```

响应统一为 `{ code: "200", msg, data }`，非 200 会抛错；接口返回 401 时本库自动重换 JWT 重试一次。

## 聚合

尚未接入 `client.aggregate`，见仓库根目录 `TODO.md`。

> 字段可能随系统更新而变化，请以实际返回为准。
