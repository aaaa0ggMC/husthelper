<p align="center">
  <img src="./assets/logo-card.svg" alt="husthelper logo" height="110" />
</p>

<h1 align="center">husthelper</h1>

<p align="center">
  <strong>专为华中科技大学（HUST）打造的现代化认证套件与校园网络工具箱</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22%2B-brightgreen?logo=node.js" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/TypeScript-Native-blue?logo=typescript" alt="TypeScript Native" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License MIT" />
</p>

---

`husthelper` 核心聚焦于解决华科开发者最常面临的身份认证与网络接入痛点，提供两大核心 SDK：

1. **校园网登录 SDK (`husthelper/hustnet`)**：校园网门户（eportal）网页认证、掉线重连、心跳保活、网卡绑定及开箱即用的 CLI 工具。
2. **校园 CAS 统一身份认证 SDK (`husthelper`)**：模拟登录、离线/AI 验证码识别、CASTGC 免密自动续期，一站式对接一卡通、数智华中大 (one.hust)、成绩、课表等下游平台。

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

## 快速导航

- [环境要求与安装](#环境要求与安装)
- [核心 SDK 快速上手](#核心-sdk-快速上手)
  - [1. 校园网登录 SDK (hustnet)](#1-校园网登录-sdk-hustnethustnet)
  - [2. 统一身份认证 CAS SDK (husthelper)](#2-统一身份认证-cas-sdk-husthelper)
- [功能全景与架构设计](#功能全景与架构设计)
- [验证码识别方案](#验证码识别方案任选其一)
- [会话管理与持久化](#会话管理与自动续期)
- [下游业务模块](#下游业务模块)
- [校园网命令行工具 (CLI)](#校园网命令行工具-cli)
- [生态与扩展 (MCP)](#生态与扩展-mcp)
- [已知限制 (MFA)](#已知限制企业微信-mfa-二次验证)
- [开源协议](#开源协议)

---

## 环境要求与安装

依赖 **Node.js 22+**（内置支持直接运行 TypeScript；Node 22 需加上 `--experimental-strip-types`，Node 23+ 默认启用）。

```bash
# 使用 pnpm（推荐）
pnpm add husthelper

# 或使用 npm
npm i husthelper
```

---

## 核心 SDK 快速上手

### 1. 校园网登录 SDK (`husthelper/hustnet`)

专用于华科校园网门户（eportal）Web 认证。自动处理重定向劫持检测、动态 RSA 密钥获取、状态查询与离线重连。

```ts
import hustnet from "husthelper/hustnet";

// 初始化校园网认证客户端
const client = hustnet
  .auth({
    username: "U2025xxxxx",
    password: "your-password",
  })
  .persistent(".hustnet-session.json"); // 可选：持久化存储网关会话

// 查询联网状态（若当前未通过认证，会自动触发登录认证流程）
const info = await client.getMyInfo();
console.log(`在线用户: ${info.userName} | IP: ${info.userIp} | 套餐: ${info.userPackage}`);

// 主动登出
// await client.logout();
```

*详细指南参见 [docs/hustnet.md](./docs/hustnet.md)*

---

### 2. 统一身份认证 CAS SDK (`husthelper`)

专用于 `pass.hust.edu.cn` 单点登录。自动处理 RSA 加密提交、验证码拉取与识别、CASTGC 免密凭据维护。在此基础上开箱即用访问一卡通、HUB 成绩、数智华中大等系统。

```ts
import hust from "husthelper";

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

*详细指南参见 [docs/auth.md](./docs/auth.md) 与各业务子文档*

---

## 功能全景与架构设计

整个库围绕两个独立又互为补充的模块构建：

```
                        ┌──────────────────────────────────────────────┐
                        │                 husthelper                   │
                        └───────┬──────────────────────────────┬───────┘
                                │                              │
                ┌───────────────▼──────────────┐ ┌─────────────▼─────────────┐
                │   校园网 SDK (hustnet)       │ │     校园 CAS SDK (hust)     │
                ├──────────────────────────────┤ ├───────────────────────────┤
                │ • 门户劫持探测与重定向处理     │ │ • RSA 动态加密与凭据维护   │
                │ • 动态 RSA 加密认证          │ │ • 多策略验证码（离线/AI） │
                │ • 网络心跳与自动掉线重连      │ │ • CASTGC 票据免密自动续期 │
                │ • 多网卡绑定支持 (IP/MAC)     │ │ • 统一 CookieJar 会话持久化│
                │ • 独立 CLI 命令行工具        │ └─────────────┬─────────────┘
                └──────────────────────────────┘               │
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
| `hustnet` *(独立入口)* | 校园网门户 (eportal) | 状态探测、静默登录、网络保活、CLI 工具 |
| `client.ecard` | 校园一卡通 | 流水查询 (`getTransactions`)、分页遍历、账户信息与个人档案 |
| `client.mhub` | 教务成绩 (HUB) | 学期查询、成绩单抓取 (`getGrades`)、自动加权排除缺考/缓考 |
| `client.one` | 数智华中大 (one.hust) | CAS OIDC 委托认证、Bearer JWT 自动换取与续期、门户接口调用 |
| `client.smartcourse` | 智慧课程平台 | 课程列表、课表日历、课程公告与待办通知 |
| `client.hkwxy` | 网络中心设备管理 | 查阅当前校园网已在线的物理终端与 MAC 信息 |
| `client.wechat` | 微信/企业微信微校园 | 微校园 `wechat_session_id` 获取与应用中心调用 |
| `client.aggregate` | 跨平台统一聚合层 | 整合上述多源数据，提供 `me` / `schedule` / `balance` 等统一实体 |

---

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

---

## 会话管理与自动续期

1. **凭据安全存储**：
   通过 `.persistent(filePath, { maxAgeMs })` 可将 CAS 的 `CASTGC` 及各应用的 `JSESSIONID` / `accessToken` 统一加密保存。下次程序启动时直接复用，**无需再次输入密码与验证码**。
2. **免密无感续期**：
   当某应用会话过期收到 302 重定向到 `/cas/login` 时，客户端会自动使用持有的 `CASTGC` 重新免密换取 service ticket 并重新发起请求；仅当 `CASTGC` 完全失效时，才会优雅回退至完整登录流程。

---

## 下游业务模块

详细开发与数据结构文档可参阅：

- [认证流程与原理解析 (docs/auth.md)](./docs/auth.md)
- [一卡通流水与账户文档 (docs/transactions.md)](./docs/transactions.md)
- [个人档案解析文档 (docs/profile.md)](./docs/profile.md)
- [成绩查询与绩点算法 (docs/grades.md)](./docs/grades.md)
- [在线终端与设备查询 (docs/online-devices.md)](./docs/online-devices.md)
- [数智华中大 OIDC 规范 (docs/one-hust.md)](./docs/one-hust.md)
- [智慧课程平台接入 (docs/smartcourse.md)](./docs/smartcourse.md)
- [统一数据聚合器 (docs/aggregate.md)](./docs/aggregate.md)

---

## 校园网命令行工具 (CLI)

本项目为校园网模块配备了便捷的 CLI 工具，方便在路由器、Termux 或无图形界面的服务器上快速使用。

```bash
# 复制配置文件模板
cp config.example.json config.json

# 快捷命令（配置 hustnet.json 或 config.json 凭据）
pnpm net status      # 查询当前联网状态与 IP
pnpm net login       # 执行登录认证
pnpm net logout      # 断开当前连接
pnpm net info        # 查询账户余额与资费套餐
pnpm net keepalive   # 守护模式：断网自动探测与重连
```

---

## 生态与扩展 (MCP)

本项目内置符合 **Model Context Protocol (MCP)** 标准的服务端（位于 [`mcp/`](./mcp/README.md)）。
可直接为 Claude Desktop、Cursor 等大模型客户端注入统一的华中大校园助手上下文能力。支持 `count` / `redacted`（默认脱敏）/ `raw` 三级隐私分层。

---

## 已知限制：企业微信 MFA 二次验证

> [!WARNING]
> 本项目**尚未实现企业微信扫码 MFA / 动态验证码拦截流程**。若您的账号在 CAS 开启了强制 MFA，自动化登录将会遇到阻断。
>
> **建议规避方案**：先在同一网络环境下使用**常规浏览器**完整登录一次，完成 MFA 认证以令学校风控系统信任当前 IP/设备；随后再使用本 SDK，通常短时间内不会再次触发二次验证。

---

## 开源协议

- 本仓库核心代码基于 **[MIT License](./LICENSE)** 开源。
- `stdchar/` 目录下的验证码识别算法与字体模板移植自 [xuxinhang/HUST-CAS-login-emulator](https://github.com/xuxinhang/HUST-CAS-login-emulator)，遵循 **[LGPL-3.0-or-later](./stdchar/LICENSE)** 协议。本项目采用独立子进程标准输入输出（stdin/stdout）通信，以确保核心主干符合 MIT 商业友好性。
