# hustcore

`husthelper` 的共享核心，被 [`hustnet`](../hustnet) 与 [`hustpass`](../hustpass) 共同依赖；除此之外两者彼此独立。

## 内容

| 文件 | 说明 |
| :-- | :-- |
| `src/http.ts` | 按 `domain + path + name` 存储的 Cookie jar（RFC 6265 路径匹配），支持会话持久化与 `localAddress`（多网卡选卡时自动构造 Agent） |
| `src/logger.ts` | 轻量日志接口与默认实现 |

## 导出

- `Session`、`RequestOptions`
- 类型：`Cookie`、`CookieInput`、`CookieStore`、`CookieStoreInput`
- `defaultLogger`、`resolveLogger`
- 类型：`Logger`、`LoggerInput`

```ts
import { Session, defaultLogger } from "hustcore";
```

## 依赖

- 运行时：Node.js 22+
- 第三方：`axios`
