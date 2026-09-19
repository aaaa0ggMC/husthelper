# hustpass

华中科技大学统一身份认证（CAS）与下游业务 SDK。

专用于 `pass.hust.edu.cn` 单点登录：自动处理 RSA 加密提交、验证码拉取与识别、CASTGC 免密凭据维护；在此基础上开箱即用访问一卡通、HUB 成绩、数智华中大等系统。与校园网模块 [`hustnet`](../hustnet) 彼此独立，共同依赖 [`hustcore`](../hustcore)。

---

> [!IMPORTANT]
> ### 安全与合规声明（使用前必读）
>
> - **合法合规与数据边界**：本项目仅用于技术学习、个人研究及**查询本人数据**。请严格遵守学校相关管理规定与网络安全法规，**严禁用于批量抓取、暴力破解、越权访问、网络攻击或任何未经授权的用途**。因违规使用造成的一切后果由使用者自行承担。
> - **凭据安全准则**：账号学号与密码属于个人敏感资产。**严禁**将包含明文凭据的 `config.json`、`.hust-session.json` 或 API Key 提交到公开仓库、聊天群或截图分享。会话持久化文件默认以 `0600` 权限安全保存，项目已在 `.gitignore` 中默认忽略敏感配置文件。
> - **只读原则（Read-Only）**：本库封装的所有业务接口均为**只读查询**（查询余额、流水、成绩、课表、通知、在线设备等），**不提供且不背书任何写入、修改、选退课、提交作业等破坏性操作**。
> - **第三方隐私风险**：若选用 AI 验证码识别，验证码图片将被发送到您配置的第三方 OpenAI 兼容端点，请自行评估接口提供商的安全性与隐私政策。
> - **侵权即删**：若本项目任何内容（代码、文档等）侵犯了您的合法权益，请通过 Issue 或邮件（[feeback@yslwd.eu.org](mailto:feeback@yslwd.eu.org)）联系，我们将在收到通知后 24 小时内第一时间处理或删除。

---

## 环境与安装

依赖 **Node.js 22+**（Node 22 需加 `--experimental-strip-types`，Node 23+ 默认启用）。
在本仓库根目录执行 `pnpm install` 后，包内即可 `import hust from "hustpass"`（由 pnpm workspace 链接）。

## 快速上手

```ts
import hust from "hustpass";

// 初始化 CAS 客户端（支持离线模板匹配或 AI 识图，任选其一）
const client = hust
  .auth({
    user_name: "U2025xxxxx",
    password: "your-password",
  })
  .withStdChar() // 推荐：使用内置离线模板匹配，无需外部网络调用
  .persistent(".hust-session.json"); // 持久化会话：下次直接免密访问

// 示例：查询一卡通流水记录
const page = await client.ecard.getTransactions({ page: 1 });
console.log(`一卡通总记录数: ${page.total} 条`);

// 异步迭代器自动分页
for await (const record of client.ecard.iterateTransactions({})) {
  console.log(`${record.occtime} | ${record.mercname} | 消费: ${record.sign_tranamt / 100} 元`);
}

// 示例：获取个人基本档案
const profile = await client.ecard.getProfile();
console.log(`姓名: ${profile.basic?.name}，院系: ${profile.basic?.department}`);
```

*详细指南参见 [docs/auth.md](../docs/auth/auth.md) 与各业务子文档*

## 功能全景与架构设计

```
                        ┌──────────────────────────────────────────────┐
                        │                 hustpass                     │
                        └───────────────────────┬──────────────────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │   校园 CAS SDK (hust) │
                                    ├───────────────────────┤
                                    │ • RSA 动态加密与凭据维护   │
                                    │ • 多策略验证码（离线/AI） │
                                    │ • CASTGC 票据免密自动续期 │
                                    │ • 统一 CookieJar 会话持久化│
                                    └───────────┬───────────┘
                    ┌───────────────────────────┴───────────────────────────┐
                    │                                                       │
            ┌───────▼────────┐  ┌────────────────▼───────────────┐  ┌───────▼────────┐
            │   生活与资产   │  │           教务与学术           │  │   跨平台聚合   │
            ├────────────────┤  ├────────────────────────────────┤  ├────────────────┤
            │ • 一卡通流水   │  │ • HUB/mhub 成绩与加权修正      │  │ • 多来源并发   │
            │ • 卡片个人信息 │  │ • 智慧课程 (课表/通知/作业)    │  │ • 字段补全降级 │
            │ • 在线设备管理 │  │ • one.hust 数智门户 (OIDC JWT) │  │ • Model Context│
            │ • 微校园会话   │  │                                │  │   Protocol(MCP)│
            └────────────────┘  └────────────────────────────────┘  └────────────────┘
```

### 客户端命名空间映射

| 命名空间 | 对应系统 / 功能 | 核心能力 |
| :--- | :--- | :--- |
| `hustnet` *(独立入口，见 [`hustnet`](../hustnet))* | 校园网门户 (eportal) | 状态探测、静默登录、网络保活、CLI 工具 |
| `client.ecard` | 校园一卡通 | 流水查询 (`getTransactions`)、分页遍历、账户信息与个人档案 |
| `client.mhub` | 教务成绩 (HUB) | 学期查询、成绩单抓取 (`getGrades`)、学业考试、空闲教室、自动加权排除缺考/缓考 |
| `client.one` | 数智华中大 (one.hust) | CAS OIDC 委托认证、Bearer JWT 自动换取与续期、门户接口调用 |
| `client.smartcourse` | 智慧课程平台 | 课程列表、课表日历、课程公告与待办通知 |
| `client.pejxgl` | 体育教学管理系统 | 学期列表、课外锻炼次数（学期末汇总）、已修/已选体育课 |
| `client.pecg` | 场馆服务（场馆预约） | 经 petyxy SSO 登录，查询本人预约记录 |
| `client.petyxy` | 华中大体育 | petyxy SSO，体质测试成绩与学期列表 |
| `client.register` | 学期注册系统 | 注册状态、当前学期起止、注册通知 |
| `client.ihuster` | IHuster 微平台 / 第二课堂 | CAS→JWT(OAuth)、二课学分汇总、用户信息 |
| `client.electricity` | 宿舍电费（sdhq 移动后勤） | 校区/楼栋/房间/电表枚举、剩余电量查询（SM2/SM3 鉴权） |
| `client.selfservice` | 校园网自助服务（myself） | 首页概览（余额/套餐/在线设备数）、在线与无感认证设备、个人资料（GBK HTML 解析） |
| `client.hkwxy` | 网络中心设备管理 | 在线物理终端与 MAC 信息、微校园服务大厅服务目录 |
| `client.wechat` | 微信/企业微信微校园 | 微校园 `wechat_session_id` 获取与应用中心调用 |
| `client.aggregate` | 跨平台统一聚合层 | 整合上述多源数据，提供 `me` / `schedule` / `balance` 等统一实体 |

## 验证码识别方案（任选其一）

CAS 登录常带有干扰型字符验证码。本库支持灵活可插拔的识别方案：

```ts
// 方案 1：【推荐】内置离线模板匹配（无需联网、零额外依赖，通过独立子进程管道调用）
client.withStdChar();

// 方案 2：AI 视觉大模型（兼容 OpenAI、DeepSeek、Local AI 等 chat/completions 格式）
client.withAiOcr({
  baseURL: "https://api.openai.com/v1",
  apiKey: "sk-...",
  model: "gpt-4o-mini",
  timeout: 60000,
});

// 方案 3：拿到中值算法合成后的 JPG 图片流自己处理（接入自建 ddddocr 或自有模型）
client.withParsedOcr(async (jpgBuffer: Buffer) => {
  return await myCustomOcr(jpgBuffer);
});

// 方案 4：直接获取原始动图 GIF Buffer 自定义处理
client.withRawOcr(async (rawGif: Buffer) => {
  return await myGifSolver(rawGif);
});
```

## 会话管理与自动续期

1. **凭据安全存储**：
   通过 `.persistent(filePath, { maxAgeMs })` 可将 CAS 的 `CASTGC` 及各应用的 `JSESSIONID` / `accessToken` 统一加密保存。下次程序启动时直接复用，**无需再次输入密码与验证码**。
2. **免密无感续期**：
   当某应用会话过期收到 302 重定向到 `/cas/login` 时，客户端会自动使用持有的 `CASTGC` 重新免密换取 service ticket 并重新发起请求；仅当 `CASTGC` 完全失效时，才会优雅回退至完整登录流程。

## 下游业务模块

详细开发与数据结构文档可参阅：

- [认证流程与原理解析 (docs/auth.md)](../docs/auth/auth.md)
- [一卡通流水与账户文档 (docs/transactions.md)](../docs/life/transactions.md)
- [个人档案解析文档 (docs/profile.md)](../docs/life/profile.md)
- [成绩查询与绩点算法 (docs/grades.md)](../docs/academic/grades.md)
- [学业考试查询 (docs/exam.md)](../docs/academic/exam.md)
- [空闲教室查询 (docs/free-room.md)](../docs/academic/free-room.md)
- [在线终端与设备查询 (docs/online-devices.md)](../docs/life/online-devices.md)
- [微校园服务大厅 (docs/service-center.md)](../docs/life/service-center.md)
- [数智华中大 OIDC 规范 (docs/one-hust.md)](../docs/auth/one-hust.md)
- [智慧课程平台接入 (docs/smartcourse.md)](../docs/academic/smartcourse.md)
- [体育教学管理：锻炼次数与已修课程 (docs/pejxgl.md)](../docs/academic/pejxgl.md)
- [场馆服务：预约记录 (docs/pecg.md)](../docs/academic/pecg.md)
- [华中大体育：体质测试成绩 (docs/petyxy.md)](../docs/academic/petyxy.md)
- [学期注册 (docs/registration.md)](../docs/academic/registration.md)
- [第二课堂：二课学分 (docs/ihuster.md)](../docs/academic/ihuster.md)
- [宿舍电费查询 (docs/electricity.md)](../docs/life/electricity.md)
- [校园网自助服务 (docs/selfservice.md)](../docs/life/selfservice.md)
- [统一数据聚合器 (docs/aggregate.md)](../docs/aggregate.md)

## 企业微信动态验证码（MFA）

> [!NOTE]
> 密码 / 验证码登录可能被 CAS 风控要求企业微信**动态验证码二次验证**。配置 `withMfaCode(provider)`
> 后，SDK 会自动识别挑战页并回调 `provider` 索取验证码完成登录：
>
> ```ts
> hust
>   .auth({ user_name, password })
>   .withStdChar()
>   .withMfaCode(async (challenge) => {
>     // challenge.message 为服务端提示，challenge.channel 为接收渠道
>     return await askUserForCode(challenge);
>   })
>   .persistent(".hust-session.json");
> ```
>
> 未配置或用户放弃时，会抛 `MfaRequiredError` 并按登录方式序列降级（可链式 `.withQrCode()`）。
> 也可直接用**企业微信扫码登录**（`await client.loginByQrCode()`）绕过密码与验证码，
> 详见 [docs/auth.md](../docs/auth/auth.md) 与 [`examples/login_mfa.ts`](../examples/login_mfa.ts)。

## 开源协议

- 本包核心代码基于 **[MIT License](../LICENSE)** 开源。
- `stdchar/` 目录下的验证码识别算法与字体模板移植自 [xuxinhang/HUST-CAS-login-emulator](https://github.com/xuxinhang/HUST-CAS-login-emulator)，遵循 **[LGPL-3.0-or-later](./stdchar/LICENSE)** 协议。本项目采用独立子进程标准输入输出（stdin/stdout）通信，以确保核心主干符合 MIT 商业友好性。
