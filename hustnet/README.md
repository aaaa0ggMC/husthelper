# hustnet

华中科技大学校园网门户（eportal）认证 SDK 与 `hustnet` CLI。

与 CAS（[`hustpass`](../hustpass)）**完全独立**：它是一套独立的自签名门户，认证入口是路由器对未认证终端做的 DNS / HTTP 劫持，只依赖 [`hustcore`](../hustcore) 的 `Session` 与日志。

> [!NOTE]
> 请使用**本人账号**并遵守华中科技大学校园网管理规定。本工具只是把浏览器登录流程自动化，不绕过任何认证，也不涉及 CAS 与学术数据。

## 环境与安装

依赖 **Node.js 22+**（Node 22 需加 `--experimental-strip-types`，Node 23+ 默认启用）。
在本仓库根目录执行 `pnpm install` 后，包内即可 `import hustnet from "hustnet"`（由 pnpm workspace 链接）。

## 快速上手

专用于华科校园网门户（eportal）Web 认证。自动处理重定向劫持检测、动态 RSA 密钥获取、状态查询与离线重连。

```ts
import hustnet from "hustnet";

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

## 能力

- 门户劫持探测与重定向处理
- 动态 RSA 加密认证（公钥运行时获取，不硬编码）
- 网络心跳与自动掉线重连
- 多网卡绑定支持（`localAddress` / 自定义 Agent，决定 NAS 看到的源 IP/MAC）
- 独立 CLI 命令行工具

## 命令行工具 (CLI)

方便在路由器、Termux 或无图形界面的服务器上快速使用。

```bash
# 复制配置文件模板（仓库根目录）
cp config.example.json config.json

# 快捷命令（配置 hustnet.json 或 config.json 凭据；在仓库根目录运行）
pnpm net status      # 查询当前联网状态与 IP
pnpm net login       # 执行登录认证
pnpm net logout      # 断开当前连接
pnpm net info        # 查询账户余额与资费套餐
pnpm net keepalive   # 守护模式：断网自动探测与重连
```

### 一键安装到系统全局 (Linux / Windows)

仓库 `scripts/` 目录下提供跨平台的全局安装与卸载脚本：

- **Linux / macOS**（默认安装至 `~/.local/bin/hustnet`）：
  ```bash
  bash scripts/install.sh    # 安装
  bash scripts/uninstall.sh  # 卸载
  ```
- **Windows**（PowerShell，安装并自动写入用户 PATH 环境变量）：
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/install.ps1    # 安装
  powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1  # 卸载
  ```

安装后即可在任意终端直接敲 `hustnet <command>` 使用（自动优先读取当前目录、`~/.config/hustnet/hustnet.json` 或仓库目录下的配置文件）。

## 文档

- [校园网认证 hustnet](../docs/hustnet/hustnet.md) — 劫持探测、JSESSIONID、运行时 RSA、CLI 细节
