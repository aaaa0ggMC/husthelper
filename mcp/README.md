# husthelper MCP 服务端

把 [husthelper](../README.md) 的**聚合层**（`client.aggregate`）包成一个 MCP 服务端，
给 Claude Desktop、Cursor、Windsurf、Open WebUI 等支持 MCP 的客户端用。

- **只读、只暴露聚合层**：身份 / 余额 / 学期 / 今日 / 课表 / 成绩 / 课程 / 通知 / 公文 /
  日程 / 在线设备 / 流水 / 邮箱 / 综合概览。不暴露底层各应用接口，也没有任何写操作。
- **隐私分层**：默认 `redacted`（逐条返回但姓名/学号/卡号/手机号/邮箱/商户名/IP 打码），
  `count` 只给数量合计，`raw` 才是完整原文且需要一把模型拿不到的钥匙。
  做法参考 [`mcps/ledger-mcp-termux`](../../mcps/ledger-mcp-termux)。
- **双传输**：stdio（本机）与 Streamable HTTP / SSE（局域网 / 移动端）。

## 快速开始

```bash
cd mcp
pnpm install
node key.ts init        # 生成隐私密钥（决定谁能看 raw 原文）

# stdio：本机客户端直接用
HUST_USERNAME=U2025xxxxx HUST_PASSWORD=your-password \
  HUST_OCR=stdchar node index.ts
```

MCP 客户端配置（stdio）：

```json
{
  "mcpServers": {
    "hust": {
      "command": "node",
      "args": ["/path/to/Auth/mcp/index.ts"],
      "env": {
        "HUST_USERNAME": "U2025xxxxx",
        "HUST_PASSWORD": "your-password",
        "HUST_OCR": "stdchar",
        "HUST_SESSION_FILE": "/path/to/Auth/mcp/data/session.json"
      }
    }
  }
}
```

HTTP / SSE（默认监听 `127.0.0.1`，没有匿名访问，必须带密钥）：

```bash
HUST_USERNAME=... HUST_PASSWORD=... node index.ts --port 3000
```

- Streamable HTTP: `http://127.0.0.1:3000/mcp`
- SSE: `http://127.0.0.1:3000/sse`
- 健康检查: `http://127.0.0.1:3000/health`

请求头：

| 请求头 | 作用 |
| --- | --- |
| `X-Hust-Key`（或 `Authorization: Bearer <key>`、`X-Hust-Privacy-Key`） | 会话密钥。**没有直接 401**，不对直接 403 |
| `X-Hust-Level` | 本会话的披露上限，`count` / `redacted` / `raw`，默认 `redacted`；模型只能往下降 |

## 凭据与验证码

凭据**只来自服务进程的环境变量，绝不接受工具参数**（参数会进模型上下文与调用日志）。

| 变量 | 说明 |
| --- | --- |
| `HUST_USERNAME` / `HUST_PASSWORD` | 学号/人员编号与密码（也认 `HUST_UN` / `HUST_PWD`） |
| `HUST_ACCOUNT` | 一卡通 account，一般留空自动获取 |
| `HUST_OCR` | `ai` 或 `stdchar`（默认：配了 AI 就用 AI，否则离线模板匹配） |
| `HUST_AI_BASE_URL` / `HUST_AI_API_KEY` / `HUST_AI_MODEL` | OpenAI 兼容验证码识别（也认 `HUST_OPENAI_*` / `OPENAI_*`） |
| `HUST_SESSION_FILE` | 会话持久化路径，默认 `data/session.json`；设 `off` 关闭 |
| `HUST_SESSION_MAX_AGE_MS` | 超过该时长主动续期一次 |
| `HUST_DATA_DIR` | 密钥、会话、审计所在目录，默认 `mcp/data` |
| `HUST_DEBUG` | 设为 `1` 时把 husthelper 的 info/debug 日志打到 stderr |

> stdio 模式下日志一律走 stderr，不会污染协议流。

## 两道门：访问门禁 + 披露上限

| 门 | 谁在管 | 拒绝时的表现 |
| --- | --- | --- |
| **访问门禁** | HTTP 请求头里有没有 `X-Hust-Key` | **整个会话拒绝**（401/403），`initialize` 都不给 |
| **披露上限** | 客户端配置的 `X-Hust-Level` | 连得上，但只能看到该等级以内；越级回 `LEVEL_NOT_ALLOWED` |

- stdio 是本机进程，不做访问门禁（能启动就能连），但 raw 仍需要密钥。
- 披露上限由客户端配置写死，**模型改不了**：它只能把工具参数 `level` 往下降（比如降到
  `count` 省预算），不能往上提。
- 密钥只认环境变量 / 请求头，**绝不认工具参数** —— 参数会进模型上下文和调用日志，
  等于把钥匙一起交出去。模型无法通过调用工具给自己提权。

## 三个披露等级

| 等级 | 给什么 |
| --- | --- |
| `count` | 只有数量与合计（流水的 `count`/`sum` 等），不返回任何条目 |
| `redacted`（默认） | 逐条返回，但姓名/学号/卡号/手机号/邮箱/商户名/IP 打码；`raw`/`rawHtml` 原始对象与 SSO/VIEW 链接不返回 |
| `raw` | 完整原文，需要密钥，且等级上限必须放到 `raw` |

打码是**确定性**的：同一商户名每次都得到同样的结果，所以按商户聚合、去重、排名依然成立，
只是看不出全名。课程名、成绩、金额、时间这类语义本身保留 —— 遮掉它模型就没法帮你分析，
而这恰恰是最需要模型做的事。

### 遍历与预算

- 逐条披露消耗会话预算：`raw` 默认 300 条、`redacted` 默认 2000 条，用
  `HUST_REVEAL_BUDGET` / `HUST_REDACTED_BUDGET` 调整（`off` 关闭）。
- `count` 等级与聚合统计不消耗预算（它们本来就不吐出条目）。
- 超预算会明确报 `REVEAL_BUDGET_EXCEEDED` 并提示出路，而不是悄悄截断。

### 敏感条目

- 一卡通流水命中医疗类关键词（医院/药房/诊所/心理/体检/保险…）会标为敏感，
  默认隐藏，并在返回里用 `hidden_sensitive` 如实告知隐藏了几条。
- 只有 `raw` + 工具参数 `includeSensitive: true` 才看得到；也可由本人用
  `HUST_SHOW_SENSITIVE=1` 全局放行。

### 审计

每次读取都会往 `data/audit.jsonl` 追加一条记录（动作、等级、条数、筛选参数摘要），
**不记录内容本身**。可以用 `hust_privacy` 工具查看当前会话的权限边界与预算余额。

## MCP 工具

| 工具 | 一次调用能做什么 |
| --- | --- |
| `hust_overview` | 综合概览：身份、余额、学期、今日、邮箱、通知、设备（并发，失败记入 `errors`） |
| `hust_me` | 本人身份信息（跨来源合并） |
| `hust_balance` | 校园卡 / 网费 / 电子账户余额 |
| `hust_term` | 当前教学周与学期 |
| `hust_today` | 今天的课表与日程 |
| `hust_schedule` | 本学期完整课表 |
| `hust_grades` | 成绩（可指定 `xn` / `xq`，含加权修正） |
| `hust_courses` | 在学 / 任教 / 线上课程 |
| `hust_notifications` | 通知列表（门户 + 智慧课程合并去重） |
| `hust_documents` | 校园公文 / 新闻 |
| `hust_activities` | 日程活动（默认本周，可指定起止时间） |
| `hust_devices` | 在线校园网设备 |
| `hust_transactions` | 一卡通流水（分页，金额已归一为元） |
| `hust_email` | 校园邮箱信息 |
| `hust_privacy` | 当前会话的隐私策略与预算余额 |

每个工具都接受可选的 `level`（`count` / `redacted` / `raw`，默认会话默认等级）。

## 密钥管理

```bash
node key.ts init     # 生成（已存在则保留）
node key.ts show     # 查看
node key.ts path     # 查看文件路径
node key.ts rotate   # 轮换（旧的 raw 权限立即失效）
```

- 密钥文件 `data/privacy.key`（0600）。
- stdio 想开 raw：`HUST_PRIVACY_KEY=<key> HUST_MAX_LEVEL=raw node index.ts`
  （或 `HUST_DEFAULT_LEVEL=raw`）。
- HTTP 想给某个客户端 raw：请求头同时带 `X-Hust-Key: <key>` 和 `X-Hust-Level: raw`；
  只给第一行就是「能连、能做分析、但看不到原文」。

## 环境变量速查

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HUST_PRIVACY_KEY` | 空 | 提供原文（raw）权限 |
| `HUST_MAX_LEVEL` | stdio `raw` / HTTP `redacted` | 本会话等级上限 |
| `HUST_DEFAULT_LEVEL` | `redacted` | 客户端未显式指定时的等级 |
| `HUST_ALLOW_RAW` | 空 | `1` 时无条件允许 raw（可信本地环境的逃生口） |
| `HUST_REVEAL_BUDGET` | `300` | 每会话可逐条披露的 raw 条数，`off` 关闭 |
| `HUST_REDACTED_BUDGET` | `2000` | 同上，针对 redacted |
| `HUST_SHOW_SENSITIVE` | 空 | `1` 允许 redacted 下查看敏感条目，`0` 明确禁止 |
| `HUST_SESSION` | 自动 | 审计里记录的会话标识 |

## 已知局限

- 这是**最小披露**，不是加密或访问控制。模型仍可能把它读到的 `redacted` 内容写进输出、
  日志或云端。真的不想让任何模型看到的记录，就别放进这套流程。
- 打码只去掉可辨识度，不改变金额；金额本身、时间本来就能定位到某一笔。
- `HUST_ALLOW_RAW=1` 是给人调试用的逃生口，别长期开在会被外部访问的部署上。
- HTTP 模式的登录凭据仍在服务端进程环境变量里；把它暴露到不受信任的网络前请三思。

## 测试

```bash
cd mcp
pnpm test        # node --test，隐私/形状单测
pnpm typecheck   # tsc --noEmit
```
