# TODO

- [ ] **把体育数据（`client.pejxgl`）接入聚合平台**：在 `AGGREGATE_SCHEMA` 增加资源（如 `exercise` / 体育已修课程）与属性 getter，来源为 `pejxgl.getNumberOfEngagements` / `pejxgl.getCoursesTaken`，并在 `docs/aggregate.md`、MCP 工具中暴露。目前先只做 `client.pejxgl` 本身，暂不写入聚合层。
- [ ] **把场馆预约（`client.pecg`）接入聚合平台**：在 `AGGREGATE_SCHEMA` 增加资源（如 `reserves`）与属性 getter，来源为 `pecg.getMyReserveList`，并在 `docs/aggregate.md`、MCP 工具中暴露。目前先只做 `client.pecg` 本身，暂不写入聚合层。
- [ ] **把空闲教室（`client.mhub.getFreeClassrooms`）接入聚合平台**：在 `AGGREGATE_SCHEMA` 增加资源（如 `freeRooms`）与属性 getter，并在 `docs/aggregate.md`、MCP 工具中暴露。
- [ ] **把学业考试（`client.mhub.getStudentExams`）接入聚合平台**：在 `AGGREGATE_SCHEMA` 增加资源（如 `exams`）与属性 getter，来源为 `mhub.getStudentExams`，并在 `docs/aggregate.md`、MCP 工具中暴露。
- [ ] **把体测成绩（`client.petyxy`）接入聚合平台**：在 `AGGREGATE_SCHEMA` 增加资源（如 `fitness`）与属性 getter，来源为 `petyxy.getFitnessResult`，并在 `docs/aggregate.md`、MCP 工具中暴露。目前先只做 `client.petyxy` 本身，暂不写入聚合层。
