# 各平台认证逻辑总览

本库对接的 HUST 平台分两类：**CAS 应用**（绝大多数）与**独立认证**（校园网 eportal）。
CAS 应用共用 `pass.hust.edu.cn` 的长期票据 `CASTGC`：只要 `CASTGC` 有效，就能免密换到各应用的会话，无需再验证码。

- CAS 协议与通用换票实现：`src/cas.ts`
- 会话（cookie jar）与持久化：`src/http.ts`、`src/persist.ts`
- 校园网独立认证：`src/hustnet.ts`（见 [hustnet 文档](../hustnet.md)）

## 通用 CAS 流程

```
1. GET  pass/cas/login?service=<应用入口>       （带 CASTGC）
       命中  → 302 <应用入口>?ticket=ST-...     （免密）
       未命中 → 完整登录：RSA 加密账号密码 + 验证码识别
2. 跟随 ticket 逐跳跳转，吸收沿途 Set-Cookie
3. 读取该应用会话 cookie（多为 JSESSIONID）或最终跳转里的 token
```

`CasService` 声明了应用的 `host / base / service / sessionCookie` 与可选的：
- `bootstrapUrl`：完整登录前先访问一次，建立应用侧初始 cookie；
- `ticketHops`：换票时最多跟随的跳转次数；
- `isLoginRedirect`：**自定义失效判定**（默认只看是否跳 `/cas/login`，有些应用跳自身 `/login`）。

> **cookie 按域名存储**：同一域名下若两个应用各有一个同名 `JSESSIONID`（靠 `Path` 区分），
> 本库会互相覆盖，交替使用时会各自触发一次续期（能自愈）。见下方 petyxy / hkwxy。

## 平台一览

| 平台 | 域名 | CAS service | 会话 | 失效判定 / 备注 | 模块 |
| --- | --- | --- | --- | --- | --- |
| CAS 门面 | `pass.hust.edu.cn` | — | `CASTGC` | 所有应用的根凭据 | `cas.ts` |
| 一卡通 | `ecard.m.hust.edu.cn` | `/wechat-web/` | `JSESSIONID` | 默认 | `ecard.ts` |
| 教务成绩 | `mhub.hust.edu.cn` | `/cas/login?redirectUrl=/CjcxController/fianCjInfo` | `JSESSIONID` | 也会跳自身 `/login?` | `mhub.ts` |
| 在线设备 | `hkwxy.hust.edu.cn` | `/tp_up/v2?m=up` | `JSESSIONID` | 默认 | `hkwxy.ts` |
| 微校园服务大厅 | `hkwxy.hust.edu.cn` | `/tp_wp/403` | `JSESSIONID` | 跳 `/tp_wp/403` | `hkwxy.ts` |
| 微校园 | `m.hust.edu.cn` | `/wechat/index.jsp` | `wechat_session_id` | `ticketHops=5` | `wechat.ts` |
| 数智华中大 | `one.hust.edu.cn` | OAuth2 authorize | `accessToken`(JWT) | 见下 | `one.ts` |
| 智慧课程 | `smartcourse.hust.edu.cn` | OAuth2 authorize | `p_auth_token` 等 | 两段式 ticket | `smartcourse.ts` |
| 体育教学 | `pejxgl.hust.edu.cn` | `/cas/auth` | `JSESSIONID` | 默认 | `pejxgl.ts` |
| 华中大体育 | `petyxy.hust.edu.cn` | `/ggtypt/dologin` | `JSESSIONID`(`/pft`) | SSO 二次跳转 | `petyxy.ts` |
| 场馆服务 | `pecg.hust.edu.cn` | 经 petyxy `/cggl/appv2/loginto` | `JSESSIONID`(`/cggl`) | 200「请重新登陆」 | `pecg.ts` |
| 学期注册 | `register.hust.edu.cn` | `/WeChatLogin` | `JSESSIONID`(Shiro UUID) | 跳 `/login` | `register.ts` |
| 第二课堂 | `ihuster.hust.edu.cn:82` | `/web/cas/cas/login?...` | JWT(Bearer) | 401 | `ihuster.ts` |
| 校园网 | eportal | — 独立认证 — | `JSESSIONID` | RSA + 心跳 | `hustnet.ts` |

## 各平台细节

### 一卡通 / 教务 / 微校园（标准 CAS）

`GET <应用入口>` 未登录时 302 到 `pass/cas/login?service=<应用入口>`，换票后由应用下发自己的会话 cookie。
`ecard` 额外用 `bootstrapUrl` 先访问一次入口；`mhub` 的失效还会表现为跳转自身 `/login?`，故用自定义 `isMhubLoginRedirect`。

### hkwxy 的两个应用（tp_up / tp_wp）

- **在线设备（tp_up）**：`service=https://hkwxy.hust.edu.cn/tp_up/v2?m=up`。
- **微校园服务大厅（tp_wp）**：未登录访问 `/tp_wp/*` 会 302 到 `/tp_wp/403`，再 302 到
  `pass/cas/login?service=https://hkwxy.hust.edu.cn/tp_wp/403`。两者同名 `JSESSIONID` 靠 `Path` 区分。

### petyxy（二次跳转 SSO）与 pecg（场馆）

`petyxy` 的企业微信/自建 SSO 比较绕，但**全程只需 CASTGC**：

```
1. GET  petyxy /ggtypt/login?service=<target>  → 200（页面内 JS 跳 CAS），种下 /ggtypt 会话
2. GET  pass   /cas/login?service=<dologin>    → 302 petyxy /ggtypt/dologin?ticket=ST-...
3. GET  petyxy /ggtypt/dologin?ticket=ST       → 302 /ggtypt/dologin（自身）
4. GET  petyxy /ggtypt/dologin                 → 302 <target>?ticket=<uuid>
5. GET  <target>?ticket=<uuid>                 → 目标应用下发自己的 JSESSIONID
```

CAS 的 `service` 恒为 `http://petyxy.hust.edu.cn/ggtypt/dologin`；`<target>` 才是真正的目标：

- `/pft` 系列（体测）：`http://petyxy.hust.edu.cn/pft/app/index`，cookie `Path=/pft`；
- 场馆 pecg：`https://pecg.hust.edu.cn/cggl/appv2/loginto`，cookie `Path=/cggl`。

实现见 `acquirePetyxySession`（`src/petyxy.ts`）。注意 Tomcat 会把重定向写成 `...;jsessionid=xxx`，
部分路由不认该矩阵参数，本库会剥离后再跟随。pecg 未登录时返回 200 的「请重新登陆！」页面（不是 302），
`isPecgLoginResponse` 据此续期。

### register（会话轮换为 Shiro UUID）

```
CAS → /WeChatLogin?ticket=ST → /WeChatLogin;jsessionid=<tomcat>（种下 JSESSIONID）
    → /WeChatLogin（自身）→ /WeChatStudentIndex（JSESSIONID 轮换为 Shiro 的 UUID，并 Set-Cookie rememberMe=deleteMe）
```

普通 `CasService` 逐跳跟随即可；最终 cookie 是 UUID 形式。接口未登录时 302 到 `/login`，用 `isRegisterLoginRedirect` 识别。

### one.hust（OIDC 委托）

CAS 的 `service` 就是 CAS 的 OAuth2 `authorize` 端点，整条链是
`CAS ticket → authorize → CAS 会话 → callbackAuthorize → one/cas.html?code=… → casToken`，
最终拿到 one.hust 自己的 OIDC JWT（约一天有效），缓存在 `accessToken` cookie 里。签发端点是
`<authc>/oauth2/casToken/<code>/<clientId>`，其中 `authc` 从 `cas.html` 同目录的 `constant.js` 解析。

### smartcourse（CAS OAuth2 两段式）

与 one.hust 类似，CAS 的 `service` 是 `authorize` 端点（`client_id=HustSmartEdu0417`），
但最终不换 token，而是由 `/sso/login/3rd?...&code=...` 一次性下发一组 `.hust.edu.cn` 父域 cookie。
多出来的 CAS `JSESSIONID` 轮换是 `authorize` + `callbackAuthorize` 各签发一个 ticket 导致。

### ihuster（OAuth/JWT）

```
1. GET pass    /cas/login?service=<ihuster login?pageUrl=..&targetUrl=..> → 302 回到该 service（带 ticket）
2. GET ihuster /web/cas/cas/login?...&ticket=ST-...                       → 302 http://ihuster.hust.edu.cn/#/?loginName=<jwt>
3. 解析 fragment 的 loginName（HS512 JWT），之后接口带 Authorization: Bearer <jwt>
```

CAS `service`：`http://ihuster.hust.edu.cn/web/cas/cas/login?pageUrl=http://ihuster.hust.edu.cn:82/&targetUrl=HUAKEaHR0cDovL2lodXN0ZXIuaHVzdC5lZHUuY24v`
（`targetUrl` = `"HUAKE" + base64("http://ihuster.hust.edu.cn/")`）。JWT 的 `sub` 是用户信息 JSON，
`exp` 约 7 天；`userId` 为大整数，本库从原文提取精确值。缓存在 `ihuster_token`，401 自动重换。

### 校园网（独立于 CAS）

校园网门户（eportal）不使用 CAS，是独立认证：`GET index.jsp` 下发 `JSESSIONID`，登录时**运行时**拉取 RSA 公钥加密口令，
并带 `userIndex`、加密 query 等；会话失效由 `NetSessionExpiredError` 表示。详见 [hustnet 文档](../hustnet.md)。

## 续期与持久化

- 应用会话失效时，`serviceRequest` 用 `isLoginRedirect` 识别并自动重走 `acquireServiceSession`：
  先 `CASTGC` 免密换票，失败才回退完整登录（RSA + 验证码 OCR）。
- `.persistent(path, { maxAgeMs })` 把 `CASTGC` 与各应用 cookie（/ JWT 缓存）写入会话文件，下次复用，无需再输密码验证码。
- 支持的验证码策略：内置离线 `stdchar`（推荐）、AI 视觉、自定义 JPG/GIF 回调。

> 以上流程均以只读查询为界；字段与服务端行为可能随系统更新变化。
