# minimal_sdk

华中科技大学校园网（eportal）认证**最小嵌入式 C 语言 SDK 预生成快照（Pre-generated Snapshots）**。

> 专为 ESP32、STM32、树莓派 Pico 等单片机或路由器嵌入式开发者提供。  
> 如果开发环境没有 Node.js / pnpm，可直接下载此目录下的头文件集成至 C / C++ 工程中。

## 目录文件说明

- `hustnet_minimal_20260919.h`：2026-09-19 从校园网门户抓取公钥模数并注入生成的单头文件 SDK。
- `hustnet_minimal.h`：最新生成的通用版本。

## 核心特性

- **零外部依赖**：纯 C99 标准，无需 OpenSSL、mbedtls 或 GMP 等大数加密库。
- **零动态内存分配 (No malloc)**：计算完全在栈上完成，零内存泄漏与堆碎片风险。
- **超低资源开销**：
  - Flash 静态体积 (`-Os`)：约 **3.9 KB**
  - 静态 RAM (`.data`/`.bss`)：**0 字节**
  - 密码加密单函数栈峰值：**~1.0 KB**
  - 表单拼装栈开销：仅 **64 字节**
  - 单次加密计算耗时：**~0.74 ms** (PC) / **< 30 ms** (ESP32 @ 240MHz)

## 快速使用

在工程的**任意一个** `.c` 或 `.cpp` 文件中定义宏并引入头文件：

```c
#define HUSTNET_MINIMAL_C_IMPLEMENTATION
#include "hustnet_minimal_20260919.h"

void login_example(void) {
    // 1. 加密明文密码（输出 256 位十六进制字符串）
    char enc_pwd[257];
    hustnet_encrypt_password("your_password", enc_pwd, sizeof(enc_pwd));

    // 2. 构造 POST 表单 Payload
    char body[1024];
    const char *query_string = "wlanuserip=...&nasip=..."; // 由校园网劫持响应下发
    hustnet_build_login_payload("U2025xxxxx", enc_pwd, query_string, "student", body, sizeof(body));

    // 3. 底层使用任意 HTTP Client（如 esp_http_client, lwIP socket 等）
    // 向 http://<nas>:8080/eportal/InterFace.do?method=login 发送 POST 请求即可
}
```

## 如何更新公钥模数

校园网门户的 RSA 公钥通常长期保持不变。若学校更换了公钥模数，只需在有 Node.js 环境的机器上连入校园网并运行：

```bash
pnpm net generate_c -o minimal_sdk/hustnet_minimal_$(date +%Y%m%d).h
```
即可自动探测并拉取最新公钥生成新的头文件。
