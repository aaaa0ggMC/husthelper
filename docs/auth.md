# 认证（auth）

`husthelper` 的认证基于 HUST 统一身份认证（CAS）：

1. `GET` CAS 登录页，解析 `lt` / `execution`
2. `POST /cas/rsa` 取 RSA 公钥，加密 `un` / `pwd`
3. 拉取并识别验证码
4. `POST` 登录表单，拿到带 ticket 的 `Location`
5. `GET` ticket 兑换一卡通 `JSESSIONID`
6. 之后所有一卡通请求都只需 `JSESSIONID`

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

`auth()` 只保存配置，**不会立即登录**；第一次真正发请求（如 `getTransactions`）时才登录。

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
| `command` | `string` | `process.execPath` | 解释器/命令 |
| `cliPath` | `string` | 内置 `stdchar/cli.ts` | 子进程入口 |
| `timeout` | `number` | `15000` | 毫秒 |

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

- 一卡通 `JSESSIONID`（用于业务请求）
- CAS `CASTGC`（长期票据，用于免密重登）

当业务请求被重定向回 `/cas/login`（会话过期）时，客户端会自动：

1. 带上 `CASTGC` `GET` 登录页 → 直接拿到新 ticket（**无需验证码、无需密码**）
2. 用 ticket 换新 `JSESSIONID`，重放刚才失败的请求

若 `CASTGC` 也失效，则回退到完整登录（验证码 + 密码）。

```ts
await client.renew();          // 手动触发续期，返回新的 JSESSIONID
client.sessionId;              // 当前 JSESSIONID
client.httpSession;            // 底层 Session（高级用法）
client.cookiesFor("pass.hust.edu.cn"); // 查看某域下的 cookie
```

`Session` 内的 cookie 按域名隔离，CAS 与 ecard 的 `JSESSIONID` 不会互相覆盖。

## 账号（account）自动获取

一卡通账号（如 `123456`）不是学号，登录后可从页面自动解析：

- `client.getAccount()` 首次调用会请求 `Queryurl.html` 并解析 `<input id="account" ... value="...">`，之后缓存。
- 优先级：`getTransactions({ account })` > `auth({ account })` > 自动获取。
- 显式指定 `account` 时**不会**发起 `Queryurl.html` 请求。

## 错误处理

登录相关失败会抛出 `Error`，消息为中文描述，例如：

- `登录失败，响应中没有 Location 字段，未拿到通行凭证`
- `未在 ecard.m.hust.edu.cn 的 set-cookie 中找到 JSESSIONID`
- `未配置 OCR 策略，请调用 withAiOcr / withRawOcr / withParsedOcr`
- AI 失败时会带上 HTTP 状态码与网关返回的 body

自动续期后仍被重定向到 CAS 时会抛 `自动续期后仍被重定向到 CAS 登录`。

## 已知限制：企业微信 MFA

未处理企业微信 MFA / 二次验证（作者尚未遇到，暂未实现）。若登录被要求 MFA，脚本会失败。

规避：先用**浏览器**在同一网络/设备上完整登录一次（让系统认定你的 MAC/IP 为可信设备），完成 MFA 后再用本库登录，通常不会再触发；若仍触发则当前版本无法自动通过。
