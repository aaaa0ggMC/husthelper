# TODO

## 已完成

以下各模块已接入 `client.aggregate` 与 MCP（`AGGREGATE_SCHEMA` + 工具）：

- [x] 体育数据（`client.pejxgl`）：`exercise`（课外锻炼次数）、`peCourses`（已修/已选体育课）
- [x] 场馆预约（`client.pecg`）：`reserves`
- [x] 第二课堂（`client.ihuster`）：`credit`
- [x] 学期注册（`client.register`）：`registration`
- [x] 空闲教室（`client.mhub.getFreeClassrooms`）：`freeRooms`
- [x] 学业考试（`client.mhub.getStudentExams`）：`exams`
- [x] 体测成绩（`client.petyxy`）：`fitness`

## 待办

- [ ] **cookie jar 按 Path 隔离**：`src/http.ts` 目前仅按域名存 cookie，同名 `JSESSIONID`（如 petyxy 的 `/pft` 与 `/ggtypt`、hkwxy 的 `tp_up` 与 `tp_wp`）会互相覆盖，交替使用会各自触发一次续期。可改为 `domain + path` 维度，并在请求时按路径匹配。
- [ ] 若需要，可把服务大厅（`client.hkwxy.getServiceCenter`）作为静态资源纳入聚合（目录型数据，价值有限）。
