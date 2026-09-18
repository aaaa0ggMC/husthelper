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

## 待办

- [ ] **hkwxy 的 `tp_up` / `tp_wp` 仍会各触发一次续期**：两者会话 cookie 路径已隔离（`/tp_up`、`/tp_wp`），
  但该站点的会话/负载均衡粘性在另一应用登录后会让先前会话失效，属服务端行为，cookie jar 无法规避（会自动自愈）。
- [ ] 若需要，可把服务大厅（`client.hkwxy.getServiceCenter`）作为静态资源纳入聚合（目录型数据，价值有限）。
