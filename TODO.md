# TODO

## 已完成

### 聚合 + MCP

以下各模块已接入 `client.aggregate` 与 MCP（`AGGREGATE_SCHEMA` + 工具）：

- [x] 体育数据（`client.pejxgl`）：`exercise`（课外锻炼次数）、`peCourses`（已修/已选体育课）
- [x] 场馆预约（`client.pecg`）：`reserves`
- [x] 第二课堂（`client.ihuster`）：`credit`
- [x] 学期注册（`client.register`）：`registration`
- [x] 空闲教室（`client.mhub.getFreeClassrooms`）：`freeRooms`
- [x] 学业考试（`client.mhub.getStudentExams`）：`exams`
- [x] 体测成绩（`client.petyxy`）：`fitness`

### cookie jar 按 Path 隔离

- [x] `src/http.ts` 改为按 `domain + path + name` 存储 cookie，并按请求路径做 RFC 6265 匹配；
  持久化用 `name@path` 作 key（默认 `/` 仍用 `name`，兼容旧会话文件）。
- [x] `ensureService` / `exchangeTicket` 改用应用入口 URL 做路径匹配。
- [x] 效果：petyxy 的 `/pft`、`/ggtypt` 与 pecg 的 `/cggl` 会话可共存，交替访问**不再重复续期**。

### 企业微信扫码登录

- [x] `client.withQrCode(handler)`：走 CAS `qyQrLogin` + `checkQRCodeScan` 轮询，扫码授权后本会话直接拿到 `CASTGC`
  （无需密码/验证码/OCR，可用于强制 MFA 场景）。
- [x] 登录方式序列：`auth()` / `withQrCode()` 按调用顺序依次尝试，`.persistent()` 的 `CASTGC` 始终最优先复用；
  `hust.withQrCode(fn).auth({...})` 与 `hust.auth({...}).withQrCode(fn)` 对应两种优先级。
- [x] `client.loginByQrCode()`：便捷入口，同样持久化优先，失效才扫码。
- [x] 子 SSO 流程（`one.hust` / `pecg` / `petyxy` / `ihuster`）统一走 `runtime.loginFallback()`，
  `CASTGC` 失效时也能降级到扫码等已配置的登录方式（不再只回退密码）。
- [x] `examples/login_qrcode.ts`：终端支持图片协议（iTerm2/WezTerm、Kitty/Ghostty、Konsole）时内联显示二维码，
  否则写入 PNG；`--file` / `--image` / `--refresh` 可指定。

## 待办

- [ ] **hkwxy 的 `tp_up` / `tp_wp` 仍会各触发一次续期**：两者会话 cookie 路径已隔离（`/tp_up`、`/tp_wp`），
  但该站点的会话/负载均衡粘性在另一应用登录后会让先前会话失效，属服务端行为，cookie jar 无法规避（会自动自愈）。
- [ ] 若需要，可把服务大厅（`client.hkwxy.getServiceCenter`）作为静态资源纳入聚合（目录型数据，价值有限）。
