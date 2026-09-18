<p align="center">
  <img src="./assets/logo.svg" alt="husthelper logo" height="110" />
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

> [!IMPORTANT]
> ### 安全与合规声明（使用前必读）
>
> - **合法合规与数据边界**：本项目仅用于技术学习、个人研究及**查询本人数据**。请严格遵守学校相关管理规定与网络安全法规，**严禁用于批量抓取、暴力破解、越权访问、网络攻击或任何未经授权的用途**。因违规使用造成的一切后果由使用者自行承担。
> - **凭据安全准则**：账号学号与密码属于个人敏感资产。**严禁**将包含明文凭据的 `config.json`、`.hust-session.json` 或 API Key 提交到公开仓库、聊天群或截图分享。会话持久化文件默认以 `0600` 权限安全保存，项目已在 `.gitignore` 中默认忽略敏感配置文件。
> - **只读原则（Read-Only）**：本库封装的所有业务接口均为**只读查询**（查询余额、流水、成绩、课表、通知、在线设备等），**不提供且不背书任何写入、修改、选退课、提交作业等破坏性操作**。
> - **第三方隐私风险**：若选用 AI 验证码识别，验证码图片将被发送到您配置的第三方 OpenAI 兼容端点，请自行评估接口提供商的安全性与隐私政策。
> - **侵权即删**：若本项目任何内容（代码、文档等）侵犯了您的合法权益，请通过 Issue 或邮件（[feeback@yslwd.eu.org](mailto:feeback@yslwd.eu.org)）联系，我们将在收到通知后 24 小时内第一时间处理或删除。

---

## 关于本仓库
原本是想做一个流水获取软件用于[ledger](https://github.com/aaaa0ggMC/ledger-mcp-termux)的，不知不觉就做大了（多亏了AI辅助，我只需要打开浏览器把route大致讲解给AI再做一个简单的axios第一版就可以不断滚雪球了），加上名字都叫 HustHelper 了不进行一下 help 确实说不过去，因此我就想到啥做啥了。

## 大方向 TODO
- [x] md2report：以 [`hustreport`](./hustreport/README.md) 模块落地——不重复造 md2html，而是「保格式」地把 Markdown 填进已有 Word 模板：AI 只负责抽模板（`ai-template`），之后 `render` 完全确定性。
- [ ] 报告模板库：把抽卡抽出的好模板（`template.docx` + `template.json`）沉淀成可复用、可直接分发的模板。
- [ ] `hustreport` 表格渲染（`w:tbl`）。

## 模块

本仓库分多个模块，基本都是 pnpm 包，各模块文档在其子目录 README：

| 包 | 说明 | 文档 |
| :-- | :-- | :-- |
| `hustcore` | 共享核心：分域名 Cookie jar 与日志 | [hustcore/README.md](./hustcore/README.md) |
| `hustnet` | 校园网（eportal）认证 SDK + `hustnet` CLI | [hustnet/README.md](./hustnet/README.md) |
| `hustpass` | CAS 统一身份认证 + 一卡通/HUB/one.hust 等下游业务 SDK | [hustpass/README.md](./hustpass/README.md) |
| `hustreport` | 报告文档：docx 样式分段与稳定 ref、模板 DSL、AI 抽模板、Markdown 保格式渲染（基于 docx-edit） | [hustreport/README.md](./hustreport/README.md) |
| `mcp` | 把 `hustpass` 聚合层包成 MCP 服务端 | [mcp/README.md](./mcp/README.md) |

设计与接口文档见 [`docs/`](./docs/README.md)。

## 写在最后
会有人懂我的logo设计思路吗？
会吧？
我又开始幻想了。
