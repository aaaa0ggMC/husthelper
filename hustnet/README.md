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
- 持久化会话缓存失效自愈：缓存的门户 / `JSESSIONID` 过期导致登录被拒时，自动清除缓存并重新探测门户后干净重试，无需手动删除会话文件
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
pnpm net generate_c  # 生成嵌入式最小 C 语言 SDK (hustnet_minimal.h)
```

### 嵌入式 C 语言 SDK (hustnet minimal C)

为 ESP32、STM32、树莓派 Pico 等资源受限设备打造的**零外部依赖、纯栈分配（无 malloc）、单头文件（Header-Only）**认证 SDK。

```bash
# 自动拉取校园网最新 RSA 模数/指数并生成头文件
pnpm net generate_c -o hustnet_minimal.h

# 或离线/手动指定参数生成
pnpm net generate_c -o hustnet_minimal.h -m <modulus_hex> -e 10001
```

在你的单片机 / C / C++ 工程中直接引入：

```c
#define HUSTNET_MINIMAL_C_IMPLEMENTATION
#include "hustnet_minimal.h"

void login_example() {
    // 1. 加密密码（输出 256 位 hex 字符串）
    char enc_pwd[257];
    hustnet_encrypt_password("your_password", enc_pwd, sizeof(enc_pwd));

    // 2. 一键拼装标准 POST 表单
    char body[1024];
    hustnet_build_login_payload("U2025xxxxx", enc_pwd, query_string, "student", body, sizeof(body));

    // 3. 使用任意 HTTP 客户端发送 POST 请求到 /eportal/InterFace.do?method=login
}
```

#### 资源占用与基准测试（针对 ESP32 / STM32 / FreeRTOS 深度优化）

| 维度 | 指标 | 说明 |
| :--- | :--- | :--- |
| **Flash 固件体积** | **~3.9 KB** (`.text` + `.rodata`) | 使用 `gcc -Os` 编译整个 SDK 的静态体积 |
| **静态 RAM 占用** | **0 字节** (`.data` / `.bss` = 0) | 全局零静态变量，无数据段常驻内存占用 |
| **堆内存分配** | **0 字节** (No `malloc`) | 纯栈上就地计算，零内存泄漏与堆碎片风险 |
| **密码加密栈峰值** | **~1.0 KB** | 大数运算就地复用，无临时字符串缓冲 |
| **表单拼装栈峰值** | **64 字节** | 流式追加 URL 编码，避免重复开辟 1.5KB 临时缓冲 |
| **单次加密耗时** | **~0.74 ms** (PC) / **< 30 ms** (ESP32) | 1024-bit 模幂针对 $e=65537$ 仅需 17 次乘模运算 |

> **针对嵌入式栈空间的专项优化**：
> 1. **流式 URL 编码**：`hustnet_build_login_payload` 直接流式写入目标缓冲区，相比传统方案节省了 1.8KB 临时栈开销（栈消耗从 1888 字节骤降至 64 字节，降低 96.6%）；
> 2. **零内存逆序取字**：从原始密码通过索引公式小端序提取大数字节，省去 256 字节临时逆序缓冲；
> 3. **就地十六进制输出**：`_bn_to_hex` 直接写入输出缓冲区，消除 520 字节内部缓冲与 `snprintf` 库开销。

#### 最小 Linux 原生 C 客户端例程 (`examples/chustnet.c`)

纯 C99 + POSIX socket 实现的零依赖最小命令行工具：

```bash
# 编译（零依赖，无需 libcurl 或 openssl）
gcc -O2 examples/chustnet.c -o chustnet

# 运行登录
./chustnet <学号> <密码>
# 示例：./chustnet U202512345 mypassword
```

> **真机验证**（2026-09-19）：在真实校园网环境运行通过——自动探测到网关 `172.18.18.61:8080`
> （queryString 413 字节），RSA 密码加密 → 标准表单装配 → 门户提交全链路成功登录。

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
