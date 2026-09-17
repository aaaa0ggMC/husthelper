# husthelper

> ## ⚠️ 免责声明（务必先读）
>
> - **侵权即删**：本项目仅用于技术学习与交流，无意侵犯任何单位或个人的合法权益。若本项目的内容（代码、文档、验证码模板等）**侵犯了您的权益，请通过 Issue 或邮件（[feeback@yslwd.eu.org](mailto:feeback@yslwd.eu.org)）联系，我们将在收到通知后 24 小时内第一时间删除相关内容**。
> - **合规使用**：本项目用于模拟登录华中科技大学统一身份认证系统并查询个人一卡通数据。请**仅用于查询本人数据**，遵守学校相关管理规定，**严禁**用于批量抓取、攻击、越权访问或任何未经授权的用途。因使用本项目产生的一切后果由使用者自行承担。
> - **保管好你的账号密码**：请务必妥善保管你的 `un`（学号）与 `pwd`（密码）。**不要把 `config.json`、密码、API Key 提交到公开仓库、粘贴到聊天或截图分享**；本项目已在 `.gitignore` 中忽略 `config.json`，但请你在 `git add` 前务必自行确认，一旦泄露请立刻改密。
> - **第三方风险**：若使用 AI 识别，验证码图片会被发送到你配置的第三方接口，请自行评估其可信度。
> - 使用本项目即表示你已阅读并同意本声明。

华中科技大学统一身份认证（CAS）模拟登录 + 一卡通流水查询的 Node.js 封装。

- 自动处理 HUST CAS 登录：RSA 加密、验证码识别、ticket 兑换 `JSESSIONID`
- 验证码识别可插拔：AI（OpenAI 兼容接口）/ 内置离线模板匹配 / 完全自定义
- `JSESSIONID` 自动续期：优先用 `CASTGC` 免密重登，失效才回退完整登录
- 一卡通流水查询与自动翻页
- 校园卡个人信息（profile）读取与解析
- 成绩查询（mhub/HUB），含加权成绩修正（排除缓考/缺考等）
- 在线设备查询（hkwxy）
- 会话持久化：自动保存/恢复 `CASTGC` 等 cookie，失效自动续期
- m.hust.edu.cn（微校园）wechat 会话获取与自动重连
- one.hust（数智华中大）OIDC 委托认证，获取 bearer token（JWT），过期自动重换
- 智慧课程（smartcourse）cookie 认证，课表 / 通知 / 课程 / 邮件
- 跨平台聚合（`client.aggregate`）：schema 驱动，多来源并发合并、按优先级去重回填、失败降级
- 日志可外部注入，默认输出到 console

📖 详细文档见 [`docs/`](./docs/README.md)：[认证 auth](./docs/auth.md) · [流水查询](./docs/transactions.md) · [个人信息 profile](./docs/profile.md) · [成绩查询](./docs/grades.md) · [在线设备](./docs/online-devices.md) · [one.hust](./docs/one-hust.md) · [智慧课程 smartcourse](./docs/smartcourse.md) · [聚合 aggregate](./docs/aggregate.md)

## 环境要求

Node.js 22+（依赖内置 TypeScript 类型剥离直接运行 `.ts`；22.x 需 `--experimental-strip-types`，23+ 默认开启）。

## 安装

```bash
pnpm add husthelper
# 或
npm i husthelper
```

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

const page = await client.ecard.getTransactions({ page: 1 });
console.log(page.records, page.total, page.nextPage);

for await (const record of client.ecard.iterateTransactions({})) {
  console.log(record.occtime, record.mercname, record.sign_tranamt);
}
```

`account` 会**自动获取**（登录后从 `Queryurl.html` 里解析），通常无需填写；也可用 `auth({ account })` 或 `client.ecard.getAccount()` 显式指定/读取。它不是学号。

## 客户端 API：按应用分命名空间

`client` 顶层是配置/会话入口（`.auth()` / `.withXxx()` / `.persistent()` / `.renew()`），
各业务按受 CAS 保护的应用分组：

| 命名空间 | 说明 |
| --- | --- |
| `client.ecard` | 一卡通：`getTransactions` / `iterateTransactions` / `getProfile` / `getAccount` / `sessionId` |
| `client.mhub` | 成绩：`getTerms` / `getGrades` / `request` / `sessionId` |
| `client.hkwxy` | 在线设备：`getOnlineDevices` / `request` / `sessionId` |
| `client.wechat` | 微校园：`getSession` / `getAppsCenter` / `request` / `sessionId` |
| `client.one` | one.hust：`getAccessToken` / `accessToken` / `invalidate` / `request` |
| `client.smartcourse` | 智慧课程平台：`getLoginUser` / `getMyLessons` / `getCourseList` / `getNoticeList` / `request` / `sessionId` / `cookies` |
| `client.aggregate` | 跨平台聚合：`me` / `balance` / `notifications` / `documents` / `courses` / `schedule` / `today` / `activities` / `email` / `term` / `grades` / `devices` / `transactions` / `overview` / `load` |

任一应用会话失效时，都会自动用 `CASTGC` 免密换票（必要时完整登录）并重放请求。

## 验证码识别方式（任选其一）

```ts
// 1. AI（OpenAI 兼容的 chat/completions，走 image_url）
.withAiOcr({ baseURL, apiKey, model, maxTokens: 1024, timeout: 60000, onImage: (jpg) => {} })

// 2. 内置离线模板匹配（无需联网；实现见 stdchar/，LGPLv3，子进程调用）
.withStdChar()

// 3. 拿到合成后的 JPG 自己处理
.withParsedOcr(async (jpg: Buffer) => "1234")

// 4. 拿到原始 GIF 自己处理
.withRawOcr(async (gif: Buffer) => "1234")
```

## 流水查询

```ts
interface TransactionQuery {
  account?: string;
  page?: number;
  dateStatus?: number; // 默认 2
  typeStatus?: number; // 默认 1
}

const page = await client.ecard.getTransactions({ page: 1 });
// { records, total, pageSize, nextPage }

const account = await client.ecard.getAccount(); // 自动获取一卡通 account

for await (const tx of client.ecard.iterateTransactions({})) {
  // 内部自动按 nextPage 翻页
}
```

金额字段（`tranamt`、`sign_tranamt`、`cardbal`、`ebagamt`、`bank_disamt`）单位是**分**，除以 100 为元；`sign_tranamt` 带符号。

## 会话与自动续期

- 登录后客户端持有 CAS 的 `CASTGC`，以及各应用自己的会话 cookie（ecard `JSESSIONID`、`wechat_session_id` 等）。
- 任一应用的请求被重定向回 `/cas/login` 时自动处理：先用 `CASTGC` 免密换该应用的 ticket，失败再回退到完整登录（验证码 + 密码），然后重放请求。
- 可手动触发：`await client.renew()`；查看会话状态：`client.ecard.sessionId` / `client.cookiesFor(host)`。

## one.hust（数智华中大）

`client.one` 通过 CAS 的 OAuth2/OIDC 委托流程换取 one.hust 的 bearer token（OIDC JWT，约 2 小时有效；响应里的 `expiresIn` 为 7200）：

```ts
const token = await client.one.getAccessToken(); // 自动换取并缓存，过期自动重换
client.one.accessToken;                          // 同步读取缓存（未过期才有值）
client.one.invalidate();                         // 主动作废，下次重新换取

// 自带 Authorization: Bearer <token>，401 时自动重换一次
const res = await client.one.request("/<api-path>");
```

token 以 `accessToken` cookie 的形式存进同一个 cookie jar，因此会被 `.persistent()` **一并缓存到会话文件**，下次运行直接复用（仍受 JWT 过期时间约束）。详见 [docs/one-hust.md](./docs/one-hust.md)。

## 聚合（client.aggregate）

`client.aggregate` 把各子平台的信息按「资源」聚合，尽量给出最全面的结果。它**不持有任何 session/cookie/凭据**，只引用 `client.one` / `client.smartcourse` / `client.ecard` / `client.mhub` / `client.hkwxy`；读取某属性时按内置 schema **并发**调用多个来源（`Promise.allSettled`），优先高优先级来源，重复项去重、缺失字段用次优来源回填，**仅当全部来源失败/无数据时才抛 `AggregateError`**。

```ts
const me = await client.aggregate.me;
const courses = await client.aggregate.courses;
// { enrolled, teaching, online, all, sources, raw }

const ov = await client.aggregate.overview(); // 并发取多资源，永不 reject
// 失败的资源在 ov.errors: [{ resource, message }]

await client.aggregate.load("activities", { beginDate, endDate });
await client.aggregate.notificationsAll({ limit: 200 }); // one 门户全量遍历
await client.aggregate.transactionsIn({ page: 2 });
```

带参数/遍历的便捷方法：`activitiesIn` / `notificationsIn` / `documentsIn` / `transactionsIn` / `gradesOf` / `notificationsAll` / `documentsAll`。每个列表项带 `source`（来源标签）与 `raw`（原始对象），对象型资源带 `sources: string[]` 与 `raw`。详见 [docs/aggregate.md](./docs/aggregate.md)。

## 会话持久化

```ts
const client = hust
  .auth({ user_name, password })
  .withStdChar()
  .persistent(".hust-session.json", { maxAgeMs: 2 * 60 * 60 * 1000 });
```

- 自动保存 `CASTGC`、ecard 的 `JSESSIONID`、`wechat_session_id` 等 cookie（含 `expires`/`path`；服务端未给 `expires` 的会话 cookie 标记为 `session: true`）。
- 下次运行自动恢复，**无需重新登录/验证码**；被服务端判定失效时自动续期。
- `maxAgeMs`（可选）：若距上次保存超过该时长，恢复后**主动续期一次**（先用 `CASTGC` 免密，失败再完整登录），避免「先失败再续期」的往返。
- `client.persistedAt` 返回最近保存时间（ISO 字符串）。
- 文件含会话凭据，以 `0600` 权限写入，已加入 `.gitignore`，**请勿提交或分享**。

## 已知限制：企业微信 MFA（二次验证）暂未处理

> ⚠️ 本项目**尚未处理企业微信 MFA / 二次验证**。因为作者目前还未遇到该流程，故未实现。若你的账号登录时被要求 MFA，脚本会失败。

**规避办法**：先用**浏览器**在同一网络/设备上完整登录一次（让系统认定你的 MAC/IP 等为可信设备），完成 MFA；之后再用本脚本登录，通常就不会再触发 MFA。若仍触发，则当前版本无法自动通过。

## 日志

默认 `console`。可外部注入：

```ts
import type { Logger } from "husthelper";

client.withLogger((msg) => sink(msg));         // 所有级别走同一函数
client.withLogger({ info: console.log });       // 部分级别
client.withLogger({ info: () => {} });          // 静音
```

## 示例

`config.json` 由示例自己读取，框架本身不读配置文件：

> ⚠️ **`config.json` 内含你的学号、密码和 API Key，切勿提交到任何公开仓库或分享给他人。** 本项目已将其加入 `.gitignore`。

```jsonc
// config.json
{
  "un": "U2025xxxxx",
  "pwd": "your-password",
  "account": "",
  "openai": {
    "baseURL": "http://127.0.0.1:1145/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  },
  "saveDebugImage": true
}
```

```bash
cp config.example.json config.json
pnpm start                      # examples/get_costs.ts
pnpm run example:export_ledger  # 导出完整历史校园卡账单，适配 ledger-mcp-termux
node examples/compare_ocr.ts 12 # 对比 AI 与离线模板匹配
```

## 目录结构

```
index.ts                 默认导出 { auth }
src/client.ts            HustClient：链式配置 + 命名空间装配 + 会话/持久化
src/runtime.ts           命名空间 API 依赖的内部能力接口
src/cas.ts               CAS 门面：登录 / 换票 / CASTGC 续期 / CasService 抽象
src/ecard.ts             一卡通：CasService 声明 + EcardApi + 流水解析
src/mhub.ts              成绩：CasService 声明 + MhubApi
src/hkwxy.ts             在线设备：CasService 声明 + HkwxyApi + 解析
src/wechat.ts            微校园：CasService 声明 + WechatApi
src/one.ts               one.hust：OIDC 委托认证 + OneHustApi + JWT 工具
src/smartcourse.ts       智慧课程：CAS OAuth2 cookie 认证 + 课程/通知/课表解析
src/aggregate.ts         跨平台聚合：schema 驱动 + 多来源并发合并
src/captcha.ts           GIF 解码、多帧时域中位数合成 JPG
src/openai.ts            OpenAI 兼容的验证码识别
src/stdchar-pipe.ts      子进程调用 stdchar（MIT）
src/http.ts              Session：axios + 分域名 cookie jar
stdchar/                 离线模板匹配识别（LGPL-3.0，独立子进程）
examples/                使用示例
```

### 架构：CAS 是唯一门面，其余都是「应用」

`pass.hust.edu.cn`（CAS）是 HUST 登录的唯一入口，登录后签发长期票据 `CASTGC`。
一卡通（ecard）、成绩（mhub）、在线设备（hkwxy）、微校园（wechat）等都是受 CAS
保护的**应用**：各自用自己的入口 URL 作为 CAS 的 `service` 参数换 ticket，再兑换
自己的会话 cookie（多为 `JSESSIONID`）。one.hust / smartcourse 稍特殊：它们的 `service`
是 CAS 的 OAuth2 authorize 端点，走委托流程——one.hust 换到 OIDC JWT（见
[docs/one-hust.md](./docs/one-hust.md)），smartcourse 则在下发一堆 `.hust.edu.cn` 会话 cookie。

- 所有应用共用同一个 `Session`（分域名 cookie jar）和同一个 `CASTGC`。
- 获取任意应用会话都是同一个流程：`CASTGC` 免密换票 → 兑换应用会话；`CASTGC`
  失效才回退完整登录（RSA + 验证码）。
- 各应用 API 只依赖 `ClientRuntime`（`src/runtime.ts`），因此可以独立成文件；
  新增普通应用只需声明一个 `CasService`（见 `src/ecard.ts`）并复用一个 `XxxApi` 类。

## 范围声明：只读不写

> **本库封装的全部接口均为「读取类」**：查询余额/流水/成绩/课表/通知/公文/日程/在线设备等，
> **不提供任何写入、修改、删除、提交、发送类操作**（不改密码、不提交作业、不发通知、不选退课等）。

用户当然可以借用本库的**认证过程**（CAS `CASTGC`、one.hust 的 bearer token、smartcourse 的会话 cookie 等）
自行去调用学校系统的写接口——本库也确实把 token/会话暴露了出来。**但那是你自己的行为，与本仓库无关**：
作者不实现、不提供、不背书任何写操作，由此产生的一切后果由使用者自行承担。

请务必遵守学校相关规定，仅访问本人数据。

## MCP 服务

本仓库自带一个 MCP 服务端（[`mcp/`](./mcp/README.md)），把上面的**聚合层**（`client.aggregate`）
按 `count` / `redacted` / `raw` 三级隐私分层暴露给支持 MCP 的客户端，支持 stdio 与
Streamable HTTP / SSE，默认 `redacted` 打码、`raw` 需要一把模型拿不到的密钥。
详见 [mcp/README.md](./mcp/README.md)。

## License

- 除 `stdchar/` 外，本项目采用 **MIT**，见 [LICENSE](./LICENSE)。
- `stdchar/` 下的验证码算法与数字模板移植自
  [xuxinhang/HUST-CAS-login-emulator](https://github.com/xuxinhang/HUST-CAS-login-emulator)，
  采用 **LGPL-3.0-or-later**，见 `stdchar/LICENSE` 与 `stdchar/NOTICE`。
- MIT 核心不 import `stdchar/`，双方仅通过**子进程 stdin/stdout** 交互，以保持核心的 MIT 许可。

## 免责声明

本项目仅供个人查询本人数据、学习研究使用。请遵守学校相关管理规定，不得用于批量、攻击性或未经授权的用途。使用风险自负。
