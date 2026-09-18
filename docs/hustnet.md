# 校园网认证 hustnet

华中科技大学校园网门户（eportal）认证，与 CAS（`hust`）**完全独立**，是并列的第二个入口。

```ts
import hustnet from "husthelper/hustnet";
```

> 本模块与 `stdchar/` 一样只做「认证 + 读取本人信息」，不含任何写入/修改类操作。

## 为什么必须走「劫持」

未认证终端访问任意 http 页面时，会被校园网 NAS 劫持并插入一段脚本，跳转到门户：

```
http://<nas>:8080/eportal/index.jsp?wlanuserip=<enc>&wlanacname=<enc>&...&nasportid=<enc>
```

其中 query 全部由 NAS 加密下发（`wlanuserip`、`mac`、`nasid` 等），**无法自行签发**，
所以认证的第一步只能是「探测劫持」而不是「拼 URL」。已联网时不会再被劫持，
探测会得到正常响应或连接被重置（`ECONNRESET` / socket hang up），这都表示**已在线**。

流程：

1. 探测 → 拿到门户上下文（基址 + 加密 query）；
2. `GET index.jsp` → 下发 `JSESSIONID`（已有有效 cookie 时不重发，失效才重发，本库自动刷新）；
3. `POST InterFace.do?method=pageInfo` → 返回公钥指数 / 模数与是否需要验证码 / 短信
   （**modulus / exponent 运行时动态获取，不硬编码**）；
4. 密码按门户前端 `AuthInterFace.js` 的 `encryptedPassword()` 做反转 + 分块无填充 RSA 加密；
5. `POST InterFace.do?method=login` → `result: "success"` 且返回 `userIndex`；
6. `POST InterFace.do?method=getOnlineUserInfo` 取信息；
   `POST InterFace.do?method=keepalive` 保活（对应成功页里 `AuthInterFace.keepalive(userIndex)`，
   `success.jsp` 只是约 90KB 的登录成功页）；`POST InterFace.do?method=logout` 下线。

## 快速开始

```ts
import hustnet from "husthelper/hustnet";

const client = hustnet
  .auth({ username: "U2025xxxxx", password: "your-password" })
  .persistent(".hustnet-session.json");

const info = await client.getMyInfo(); // 未认证会自动登录
console.log(info.userName, info.userIp, info.accountFee, info.userPackage);
```

## API

### `hustnet.auth(options)`

| 字段 | 说明 |
| --- | --- |
| `username` / `password` | 必填 |
| `probeUrl` | 探测地址，默认 `http://123.123.123.123/`（任意 http 页面均可） |
| `portal` / `queryString` | 直接指定门户基址与加密 query，跳过探测（一般不用） |
| `service` | 套餐 / 服务名，默认空 |
| `timeoutMs` | 单次请求超时，默认 `15000` |
| `localAddress` / `httpAgent` / `httpsAgent` | 多网卡选卡（决定 NAS 看到的源 IP / MAC） |
| `transport` | 完全自定义传输层（见下） |
| `logger` | 日志注入 |

### `NetClient`

| 方法 / 属性 | 说明 |
| --- | --- |
| `getMyInfo()` | **主 API**：已在线直接返回；否则自动登录后返回 |
| `status()` | `{ online: true \| false \| undefined, userInfo?, portal?, reason? }` |
| `login()` | 完整登录，返回门户原始结果 |
| `getOnlineUserInfo(userIndex?)` | 裸取在线信息；未登录抛 `NetOfflineError` |
| `logout()` | best-effort 下线（服务端失败也清本地会话） |
| `keepAlive()` / `startKeepAlive(ms)` / `stopKeepAlive()` | `success.jsp` 保活 |
| `persistent(file, { maxAgeMs? })` | 会话持久化（cookie + userIndex + 门户上下文） |
| `withLogger(input)` | 日志注入 |
| `portal` / `pageInfo` / `userIndex` / `sessionId` / `persistedAt` / `cookies()` | 只读状态 |

## 错误处理

所有失败都抛 `NetError` 子类，带 `phase`、`code`、`httpStatus?`、`retryable`、`raw?`、`responseBody?`：

```ts
import { isNetError } from "husthelper/hustnet";

try {
  await client.getMyInfo();
} catch (error) {
  if (isNetError(error)) {
    console.error(error.phase, error.code, error.message, error.retryable);
    console.error(error.responseBody); // 门户原始响应（截断）
  }
}
```

| 类 | `code` | 场景 |
| --- | --- | --- |
| `NetTransportError` / `NetTimeoutError` | `TRANSPORT` / `ETIMEDOUT` | DNS / 连接 / 超时 |
| `NetHttpError` | `HTTP` | 非 2xx（5xx / 429 标记可重试） |
| `NetProtocolError` | `PROTOCOL` | 返回 HTML / 非 JSON / 缺字段 |
| `NetPortalNotFoundError` | `PORTAL_NOT_FOUND` | 探测不到门户劫持 |
| `NetSessionExpiredError` | `SESSION_EXPIRED` | JSESSIONID 缺失/失效 |
| `NetCredentialError` | `BAD_CREDENTIALS` | 账号或密码错误 |
| `NetAccountError` | `ACCOUNT` | 欠费 / 套餐到期 |
| `NetMacBindingError` | `MAC_BINDING` | 终端 MAC 未绑定 / 超限 |
| `NetIpError` | `IP` | IP 不在范围 / 冲突 |
| `NetCaptchaRequiredError` | `CAPTCHA_REQUIRED` | 门户要求验证码（未内置识别） |
| `NetSmsAuthRequiredError` | `SMS_REQUIRED` | 门户要求短信二次验证 |
| `NetAlreadyOnlineError` | `ALREADY_ONLINE` | 该终端已在线 |
| `NetOfflineError` | `OFFLINE` | 明确未登录 / 已下线 |
| `NetLoginRejectedError` | `LOGIN_REJECTED` | 登录被拒但无法归类 |

门户的实际文案会变，但原始响应保存在 `raw` / `responseBody` 里，必要时按 `code` 处理。

## 传输层解耦（为「指定网卡 / 发某张网卡 MAC」预留）

协议层只产出「URL + 表单 + 头部」，字节如何发送由 `NetTransport` 决定：

```ts
interface NetTransport {
  request<T>(req: {
    url: string;
    method?: "GET" | "POST";
    data?: unknown;
    headers?: Record<string, string>;
    responseType?: "text" | "buffer";
    omitCookies?: boolean;
    timeout?: number;
  }): Promise<{ status: number; headers: ...; data: T }>;
}
```

默认 `SessionTransport` 复用全库统一的 `Session`（分域名 cookie jar）。
多网卡场景一般只需 `localAddress`；若要在 L2 精确控制源 MAC，实现一个自定义
`NetTransport` 传入即可，业务代码无需改动。

## CLI

```bash
pnpm net status          # 查看在线状态
pnpm net info            # 获取本人信息（未认证自动登录，默认命令）
pnpm net login           # 登录
pnpm net logout          # 下线
pnpm net keepalive       # 执行一次保活
```

- 配置默认 `hustnet.json`：`{ "username", "password", "probeUrl?", "portal?", "queryString?", "service?" }`；
  不存在或缺字段时交互式询问（密码隐藏回显），可存盘（`--no-save` 禁用）。
- 会话默认 `.hustnet-session.json`。
- 选项：`-c/--config`、`-s/--session`、`-p/--probe`、`--portal`/`--query`、`--service`。
- `hustnet.json` 与 `.hustnet-session.json` 均含凭据，已加入 `.gitignore`，**切勿提交或分享**。

## 接口来源与核对情况

- 登出：`InterFace.do?method=logout` + `userIndex=`（已抓包核对；best-effort，服务端不认也会清本地会话）。
- 保活：`InterFace.do?method=keepalive` + `userIndex=`（已由成功页 `AuthInterFace.keepalive(userIndex)`
  确认；`success.jsp?...&keepaliveInterval=N` 只是成功页，`N` 单位是分钟，`N>0` 时才轮询保活）。
- 密码加密：来自前端 `AuthInterFace.js` 的 `RSAUtils.encryptedString`（反转 + 分块无填充 RSA）。
  若门户升级算法（表现为登录永远「用户名或密码错误」），对照该文件更新
  `src/hustnet.ts` 的 `encryptEportalPassword` / `eportalChunkSize`；
  modulus / exponent 无需改动，已全部来自运行时 `pageInfo`。

## 隐私与范围

- 仅登录并读取本人信息（姓名、学号、IP、MAC、余额、套餐、到期时间等）。
- 会话文件以 `0600` 写入，含 `JSESSIONID`、`userIndex`、加密 query，请勿提交或分享。
- 遵守学校规定，仅访问本人数据。
