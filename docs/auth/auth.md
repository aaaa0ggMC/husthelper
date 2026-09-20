# 认证（auth）

`husthelper` 的认证基于 HUST 统一身份认证（CAS）。`pass.hust.edu.cn` 是唯一登录门面：
ecard（一卡通）/ mhub（成绩）/ hkwxy（在线设备）/ wechat（微校园）等都是受 CAS 保护的
**应用**，各自用自己的入口 URL 作为 `service` 参数换 ticket，再兑换自己的会话 cookie。

完整登录（仅当没有可用的 `CASTGC` 时执行）：

1. `GET` CAS 登录页，解析 `lt` / `execution`
2. `POST /cas/rsa` 取 RSA 公钥，加密 `un` / `pwd`
3. 拉取并识别验证码
4. `POST` 登录表单，拿到带 ticket 的 `Location`
5. 若第 4 步返回的是 MFA 挑战页（要求 `phoneCode`），用 `withMfaCode(provider)` 提供的动态验证码二次提交
6. `GET` ticket 兑换目标应用的会话 cookie（如 ecard 的 `JSESSIONID`）

后续获取其他应用会话无需重新输入密码：带 `CASTGC` `GET /cas/login?service=...` 免密拿到
新 ticket，再兑换对应应用的 cookie。所有应用共用同一个 cookie jar 与 `CASTGC`。

## 快速开始

```ts
import hust from "husthelper";

const client = hust
  .auth({ user_name: "U2025xxxxx", password: "your-password" })
  .withAiOcr({
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-...",
    model: "gpt-4o-mini",
  });
```

`auth()` 只保存配置，**不会立即登录**；第一次真正发请求（如 `client.ecard.getTransactions`）时才登录。

> 客户端按应用分为命名空间：`client.ecard` / `client.mhub` / `client.hkwxy` / `client.wechat` / `client.one`，
> 顶层只保留配置与会话入口（`.auth()` / `.withXxx()` / `.persistent()` / `.renew()` / `.cookiesFor()`）。

## auth(options)

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_name` | `string` | 学号/人员编号（CAS 的 `un`） |
| `password` | `string` | 密码 |
| `account` | `string?` | 一卡通账号，可选；不传会自动获取，见下 |

## 验证码识别

四选一（不配置会报错）：

### withAiOcr(options)

调用 OpenAI 兼容的 `chat/completions`，把合成后的 JPG 以 `image_url` 发送。

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `baseURL` / `base_url` | `string` | 必填 | 接口根地址，如 `https://api.openai.com/v1` |
| `apiKey` / `api_key` | `string` | 必填 | API Key |
| `model` | `string` | `gpt-4o-mini` | 模型名 |
| `maxTokens` | `number` | `1024` | 对推理模型要留够，否则思考占满无正文 |
| `timeout` | `number` | `60000` | 毫秒 |
| `onImage` | `(jpg: Buffer) => void` | - | 发送前回调，可存图调试 |

### withStdChar(options)

内置离线模板匹配，无需联网。实现位于 `stdchar/`（LGPL-3.0），通过子进程调用。

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `command` | `string` | 自动探测 | 运行器命令（如 `"tsx"`）；不传则按下面的规则推断 |
| `cliPath` | `string` | 内置 `stdchar/cli.ts` | 子进程入口 |
| `timeout` | `number` | `15000` | 毫秒 |

子进程启动方式按以下顺序推断：

1. 父进程已在用 TS 运行器（`tsx`/`ts-node`/`--experimental-strip-types`/`--import`/`--loader`，含写在 `NODE_OPTIONS` 里的）——直接复用其加载参数；
2. 否则若 CLI 位于 `node_modules` 下（包被安装为依赖）——自动改用 `tsx`，找不到再试 `ts-node`；
3. 否则用当前 `node` 直接运行（单仓内 CLI 在仓库里，原生类型剥离可用）。

> ⚠️ 场景 2 中两样都找不到时会直接报错提示：Node 拒绝对 `node_modules` 内的文件剥离类型，
> 此时请安装 `tsx`（`pnpm add -D tsx`）或显式 `withStdChar({ command: "tsx" })`。

### withParsedOcr(fn)

拿到时域合成后的 JPG：

```ts
.withParsedOcr(async (jpg: Buffer) => "1234")
```

### withRawOcr(fn)

拿到原始 GIF：

```ts
.withRawOcr(async (gif: Buffer) => "1234")
```

## 其它配置

```ts
client.withAccount("123456");          // 显式指定一卡通 account，跳过自动获取
client.withLogger((msg) => sink(msg)); // 注入日志，见 README「日志」
```

## 会话与自动续期

登录成功后客户端同时持有：

- CAS `CASTGC`（长期票据，所有应用共用的登录门面）
- 各应用自己的会话 cookie（如一卡通 `JSESSIONID`、`wechat_session_id`）

当某个应用的业务请求被重定向回 `/cas/login`（该应用会话过期）时，客户端会自动：

1. 带上 `CASTGC` 访问该应用的 `service` → 直接拿到新 ticket（**无需验证码、无需密码**）
2. 用 ticket 换该应用的新会话，重放刚才失败的请求

若 `CASTGC` 也失效，则回退到完整登录（验证码 + 密码）。每个应用独立管理自己的会话，
互不影响；ecard 是默认用于手动续期的应用。

```ts
await client.renew();                  // 手动触发 ecard 续期，返回新的 JSESSIONID
client.ecard.sessionId;                // 当前一卡通 JSESSIONID
client.mhub.sessionId;                 // 当前 mhub JSESSIONID
client.wechat.sessionId;               // 当前微校园会话
client.httpSession;                    // 底层 Session（高级用法）
client.cookiesFor("pass.hust.edu.cn"); // 查看某域下的 cookie
```

`Session` 内的 cookie 按 `域名 + Path` 隔离，CAS 与 ecard 的 `JSESSIONID` 不会互相覆盖；同一域名下同名但不同 `Path` 的 cookie（如 petyxy 的 `/pft` 与 `/ggtypt`）也能共存，并按请求路径匹配发送。

## 会话持久化

```ts
client.persistent(".hust-session.json", { maxAgeMs: 2 * 60 * 60 * 1000 });
```

- 自动将各域 cookie（`CASTGC`、ecard `JSESSIONID`、`wechat_session_id` 等）写入文件；cookie 会连同 `expiresAt`/`path` 一起保存，服务端未给 `expires` 的会话 cookie 标记 `session: true`。
- 下次构造客户端时自动恢复；恢复出的 cookie 若已过期（有 `expiresAt` 且已过）会被丢弃。
- `maxAgeMs`：距上次保存超过该时长时，恢复后**主动续期一次**（先 `CASTGC`，失败再完整登录）。不传则直接复用，等被服务端拒绝时再续期。
- `client.persistedAt`：最近保存时间（ISO）。
- 文件以 `0600` 权限写入，内含会话凭据，**请勿提交或分享**（已加入 `.gitignore`）。

持久化文件格式（v2）：

```jsonc
{
  "version": 2,
  "savedAt": "2026-09-17T03:54:43.633Z",
  "hosts": {
    "pass.hust.edu.cn": {
      "CASTGC": { "value": "...", "expiresAt": null, "session": true, "path": "/cas/", "domain": "pass.hust.edu.cn" }
    },
    "ecard.m.hust.edu.cn": { "JSESSIONID": { "value": "...", "session": true } },
    "m.hust.edu.cn": { "wechat_session_id": { "value": "...", "session": true } }
  }
}
```

> 旧版（v1，值为纯字符串）文件仍可读取。

## 账号（account）自动获取

一卡通账号（如 `123456`）不是学号，登录后可从页面自动解析：

- `client.ecard.getAccount()` 首次调用会请求 `Queryurl.html` 并解析 `<input id="account" ... value="...">`，之后缓存。
- 优先级：`client.ecard.getTransactions({ account })` > `auth({ account })` > 自动获取。
- 显式指定 `account` 时**不会**发起 `Queryurl.html` 请求。

## 错误处理

登录相关失败会抛出 `Error`，消息为中文描述，例如：

- `登录失败，响应中没有 Location 字段，未拿到通行凭证`
- `未在 ecard.m.hust.edu.cn 的 set-cookie 中找到 JSESSIONID`
- `未配置 OCR 策略，请调用 withAiOcr / withRawOcr / withParsedOcr`
- AI 失败时会带上 HTTP 状态码与网关返回的 body

自动续期后仍被重定向到 CAS 时会抛 `自动续期后仍被重定向到 CAS 登录`。

## 登录方式与顺序

`HustClient` 支持多种登录方式，按配置的先后顺序依次尝试；**已持久化的会话（`.persistent()`）
始终最优先复用**（先用 `CASTGC` 免密换票），只有持久化会话失效时才执行登录方式序列。

- `auth({ user_name, password })`：密码 + 验证码登录（需配合 `withXxxOcr()`）
- `withMfaCode(provider)`：密码登录命中企业微信 MFA 时，用 `provider` 提供的动态验证码自动完成二次验证
- `withQrCode(handler)`：企业微信扫码登录（无需密码 / 验证码 / OCR）

顺序即调用顺序：

```ts
// 先密码，失败再扫码
hust.auth({ user_name, password }).withQrCode(showQr).persistent(".hust-session.json");

// 先扫码，失败再密码（扫码作为默认方式）
hust.withQrCode(showQr).auth({ user_name, password }).persistent(".hust-session.json");
```

`one.hust` / `pecg` / `petyxy` / `ihuster` 等「子 SSO」流程在 `CASTGC` 失效时也会走同一序列，
因此配置了扫码后它们同样能降级到扫码登录。

> **推荐组合：密码优先 + 扫码兜底**
>
> 扫码登录必须由人操作，无法在后台静默完成，因此不适合频繁续期；而密码登录遇到 MFA 又需要人工输入。
> 两者组合正好互补：
>
> ```ts
> hust
>   .auth({ user_name, password })
>   .withStdChar()          // 密码登录用离线验证码识别
>   .withMfaCode(askCode)   // 命中 MFA 时索取企业微信动态验证码
>   .withQrCode(showQr)     // 无法完成二次验证时，自动降级到扫码
>   .persistent(".hust-session.json");
> ```
>
> `CASTGC` 失效时先用密码**静默续期**；一旦被风控拦截，`withMfaCode` 会介入完成二次验证
> （若未配置或用户放弃，则继续降级为扫码一次）。

## 企业微信扫码登录

用企业微信扫码授权后，CAS 会向当前会话下发长期票据 `CASTGC`，随后即可正常获取各应用会话，
可作为强制 MFA 场景下的替代登录方式。

```ts
import hust from "husthelper";

const client = hust
  .withQrCode((scanUrl) => {
    // scanUrl 即二维码内容（企业微信扫码入口），可自行渲染为终端图片/文件
    // 返回 Promise 可阻塞等待用户扫码；扫码状态轮询由 SDK 在后台继续
    console.log(scanUrl);
  })
  .persistent(".hust-session.json");
```

`handler` 可为异步函数，在其中注入阻塞逻辑（例如前端 UI 显示二维码并等待用户扫码后再 resolve）。
轮询默认 3s 一次、二维码 180s 失效，可用 `withQrCode(handler, { intervalMs, timeoutMs })` 调整。

便捷方法 `client.loginByQrCode({ onQrCode, intervalMs?, timeoutMs? })` 等价于「注册扫码方式 + 首次访问」，
同样**优先复用持久化会话**；如需强制重新扫码，可清除 `.hust-session.json`，或调用
`client.httpSession?.deleteCookie("CASTGC", "pass.hust.edu.cn")`。

底层能力也单独导出：

| 导出 | 说明 |
| --- | --- |
| `qrLogin(session, service, options)` | 生成二维码并轮询，成功返回 `{ scanUrl, redirectUrl? }` |
| `qrScanUrl(uuid, service)` / `qrCheckUrl(uuid)` | 二维码内容 / 状态轮询地址 |
| `CAS_QR_LOGIN` / `CAS_QR_CHECK` | 对应 CAS 端点常量 |

完整示例见 [`examples/login_qrcode.ts`](../examples/login_qrcode.ts)（终端支持图片协议时内联显示二维码，否则写入 PNG 文件；`--file` / `--image` / `--refresh` 可指定）。

## 企业微信动态验证码（MFA）

CAS 风控在判定「终端疑似发生变化」时不会直接签发 ticket，而是返回要求动态验证码的
**双因子认证**页（`双因子认证 / 验证码 / 登录`），并把验证码发送到用户的企业微信。
配置 `withMfaCode(provider)` 后，SDK 会自动识别该挑战页、回调 `provider` 获取验证码并完成二次提交，
密码登录因此也能在 MFA 场景下走通。

```ts
import readline from "node:readline/promises";
import hust from "husthelper";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const client = hust
  .auth({ user_name, password })
  .withStdChar()
  .withMfaCode(async (challenge) => {
    // challenge.message 为服务端提示，challenge.channel 为接收渠道（如「企业微信」）
    console.log(challenge.message ?? "请输入企业微信动态验证码");
    return await rl.question("验证码: "); // 返回 Promise 可阻塞等待用户输入
  })
  .persistent(".hust-session.json");
```

- `provider` 收到 `MfaChallenge`（含 `message` / `channel` / 原始 `html`），返回验证码字符串即可；
  异步回调会被 `await`，可在其中接入任意 UI 或消息通道。
- 返回空字符串或抛错，则该次密码登录失败，按登录方式序列继续降级（例如 `withQrCode`）。
- 未配置 `withMfaCode` 时命中 MFA 会抛出 `MfaRequiredError`（`error.challenge` 为挑战详情），
  调用方也可据此自行处理。
- 底层：`parseMfaChallenge(html)` 负责识别挑战页；`performCasLogin` / `fullLogin` 通过
  `LoginOptions.onMfaCode` 接收提供者。

完整示例见 [`examples/login_mfa.ts`](../examples/login_mfa.ts)。

## 关于强制 MFA

若账号开启了强制企业微信 MFA，有两种走法：

- 配置 `withMfaCode(provider)`：密码登录照常自动完成，只是在 MFA 步骤需要提供（或自动获取）动态验证码。
- 改用企业微信扫码登录（`hust.withQrCode(handler)` 或 `client.loginByQrCode()`），无需密码与验证码。

两者也可组合：密码 + MFA 优先，失败自动降级到扫码。
