# one.hust（数智华中大）

one.hust（`https://one.hust.edu.cn`）使用 **OIDC（JWT bearer token）**，但登录入口挂在
`pass.hust.edu.cn` 的 CAS 上，且以 CAS 的 OAuth2 authorize 端点作为 `service`，
因此整条链路是一段「嵌套」的委托认证。

## 认证链路

```
1. GET  /cas/login?service=<authorize>          → 302 <authorize>?ticket=ST1   （CASTGC 免密，否则完整登录）
2. GET  <authorize>?ticket=ST1                   → 302 /cas/login?service=callbackAuthorize（Set-Cookie JSESSIONID）
3. GET  /cas/login?service=callbackAuthorize     → 302 callbackAuthorize?ticket=ST2
4. GET  callbackAuthorize?ticket=ST2             → 302 one.hust/cas.html?service=...&code=ST2
5. GET  one.hust/cas.html?...&code=ST2           → 200 HTML（读 defaults/js/constant.js 拿 contextpathAuthc）
6. GET  <authc>/oauth2/casToken/<code>/<clientId>→ 200 JSON { code, data: { accessToken } }
```

- `<authorize>` = `https://pass.hust.edu.cn/cas/oauth2.0/authorize?client_id=nup&response_type=code&redirect_uri=...&scope=all`
- 第 5 步页面里的 `contextpathAuthc` / `oauth_client_id` 从 `cas.html` 同目录的
  `defaults/js/constant.js` 解析，不写死。
- 第 2 / 3 步会在 `pass.hust.edu.cn` 上更新 `JSESSIONID`，与 `CASTGC` 共用同一个
  cookie jar；第 5 步会写入 `one.hust.edu.cn` 的 `BIGipServer...` / `redirectURL` cookie。
- 最终拿到的 `accessToken` 是 OIDC JWT，有效期约 **2 小时**（`casToken` 响应里 `expiresIn: 7200`，JWT `exp` 与之对应）。响应还带 `refreshToken` 与 `casTgt`，本库暂未使用。
- 因为 `CASTGC` 的有效期长得多（约半个月），2h 过期后的「重换」只是拿 `CASTGC` 重跑一遍上面的 302 跳转链（**无验证码**）；只有 `CASTGC` 也失效（约两周）时才需要完整登录。

## API

```ts
// 换取（并缓存）bearer token；已缓存且未过期时直接返回，过期自动重换
const token = await client.one.getAccessToken();

// 同步读取缓存（未过期才有值）
client.one.accessToken; // string | undefined

// 主动作废，下次 getAccessToken 会重新换取
client.one.invalidate();

// 带 Authorization: Bearer <token> 请求 one.hust；401 时自动重换 token 重试一次
const res = await client.one.request("/<api-path>");
const res2 = await client.one.request("/<api-path>", {
  method: "POST",
  data: { ... },
  headers: { "Content-Type": "application/json" },
});
```

需要自己拿着 token 调第三方/浏览器时，直接 `await client.one.getAccessToken()` 即可。

## 缓存与自动续期

`accessToken` 以 cookie 形式写进共享 cookie jar（域名 `one.hust.edu.cn`，`expiresAt`
取自 JWT 的 `exp`），因此：

- `.persistent(".hust-session.json")` 会**一并保存**该 token 到会话文件；
- 下次运行若 JWT 未过期，`getAccessToken()` 直接复用，无需重新走 OIDC；
- 过期（或距过期不足 60s）时自动重新换取；JWT 无法解析 `exp` 时按「始终可用」处理，
  由 401 触发重换。

`client.one.request` 命中 401 时会 `invalidate()` 再重试一次；若重试仍 401，则把响应
原样返回给调用方。

## 门户接口：schema 注册表

one.hust 的站点接口（通知、公文、日程、余额、个人信息等）收敛在一张声明表
`ONE_ENDPOINTS` 里，每条只声明「路径 / 方法 / 包装形式 / 是否分页 / 默认参数」：

```ts
import { ONE_ENDPOINTS } from "husthelper";

ONE_ENDPOINTS = {
  noticePage:   { path: ".../getCampusPimPageInfo", page: true, defaults: { pageNum: 1, pageSize: 10 } },
  documentPage: { path: ".../getCampusDocumentPage", page: true, defaults: { pageNum: 1, pageSize: 10 } },
  weekActivity: { path: ".../getWeekActivity", defaults: { activityType: "2", ... } },
  learnWeek:    { path: ".../getLearnweekbyDate", envelope: "raw" }, // 裸对象，无 {code,msg,data}
  emailInfo:    { path: ".../getEmailInfo" },
  balance:      { path: ".../getHustPersonBalance" },
  myInfo:       { path: ".../getInfoData/getMyInfo" },
};
```

通用执行器 `client.one.portal` 按 schema 自动发 `POST`、鉴权、解包、分页：

```ts
await client.one.portal.call("balance");                    // 解包 data
await client.one.portal.call("learnWeek");                  // raw，原样返回
await client.one.portal.page("noticePage", { pageSize: 2 }); // 一页
for await (const d of client.one.portal.iterate("documentPage", { pageSize: 50 })) { ... }
```

原有便捷方法（`getNotifications` / `getBalance` / `getMyInfo` / …）都只是上面的一行薄封装，
同样保留。**新增一个接口 ＝ 在 `ONE_ENDPOINTS` 加一行**；需要强类型再补一个可选的方法与类型即可。

## 可选参数

```ts
import { oneAuthorizeUrl, oneServiceUrl, oneRedirectUri } from "husthelper";

// 默认 act=sems-tp-nup；如需进入其它应用可覆盖
await acquireOneToken(session, login, { act: "sems-tp-nup_29827717" });
// 或直接给出完整 service / redirect_uri / client_id
await acquireOneToken(session, login, {
  clientId: "nup",
  service: oneServiceUrl("sems-tp-nup_29827717"),
  redirectUri: oneRedirectUri(oneServiceUrl()),
});
```

`oneAuthorizeUrl()` / `oneServiceUrl()` / `oneRedirectUri()` 均导出，便于自行拼链。

> `redirect_uri` / `service` 主要影响登录完回到哪个页面，不影响 `casToken` 换到的 token；
> 一般无需设置。字段与路径可能随学校系统更新而变化，请以实际返回为准。
