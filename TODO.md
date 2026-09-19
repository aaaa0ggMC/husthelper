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

### 企业微信动态验证码（MFA）

- [x] `client.withMfaCode(provider)`：密码登录命中 CAS 风控挑战页（要求 `phoneCode`）时，
  自动识别挑战页、回调 provider 获取动态验证码并二次提交，拿到 ticket。
- [x] 未配置 / 用户放弃时抛 `MfaRequiredError`，可继续按登录方式序列降级到扫码。
- [x] `parseMfaChallenge(html)` 识别挑战页；`LoginOptions.onMfaCode` / `AcquireOptions.onMfaCode` 透传。
- [x] `examples/login_mfa.ts`（readline 交互输入动态验证码）。
- [ ] 真机验证：MFA 二次提交是否需要 `ua` / `visitorId` 指纹字段（当前按浏览器行为省略空值）。

### 企业微信扫码登录

- [x] `client.withQrCode(handler)`：走 CAS `qyQrLogin` + `checkQRCodeScan` 轮询，扫码授权后本会话直接拿到 `CASTGC`
  （无需密码/验证码/OCR，可用于强制 MFA 场景）。
- [x] 登录方式序列：`auth()` / `withQrCode()` 按调用顺序依次尝试，`.persistent()` 的 `CASTGC` 始终最优先复用；
  `hust.withQrCode(fn).auth({...})` 与 `hust.auth({...}).withQrCode(fn)` 对应两种优先级。
- [x] `client.loginByQrCode()`：便捷入口，同样持久化优先，失效才扫码。
- [x] 子 SSO 流程（`one.hust` / `pecg` / `petyxy` / `ihuster`）统一走 `runtime.loginFallback()`，
  `CASTGC` 失效时也能降级到扫码等已配置的登录方式（不再只回退密码）。

### 宿舍电费（electricity）

- [x] `client.electricity`：校区 / 楼栋 / 房间 / 电表枚举与剩余电量查询
  （`sdhq` 移动后勤，CAS 会话 + SM2/SM3 请求头），见 `docs/electricity.md`。
- [ ] 在真机验证 SM2 密文字节格式（C1C3C2 + `0x04` 前缀）与 `X-Signature`，必要时调整。
- [ ] 视需要接入 `client.aggregate`（需要房间/电表配置）。
- [x] `examples/login_qrcode.ts`：终端支持图片协议（iTerm2/WezTerm、Kitty/Ghostty、Konsole）时内联显示二维码，
  否则写入 PNG；`--file` / `--image` / `--refresh` 可指定。

### 报告文档（hustreport）

基于 `docx-edit` 的「保格式」报告自动化，整链路：`analyze → template / ai-template → render`。详见 [`hustreport/README.md`](./hustreport/README.md)。

- [x] **分析**：按「段落 + run 样式」切分 segment、去重成 `XML Style ID`，导出带稳定 ref 的 `segments.csv`；多媒体以 `img_xxxx` handle 表示。
- [x] **稳定 ref**：`w14:paraId` + 段内 segment 序号，改写文本后重新分析 ref 不变。
- [x] **无损编辑**：`applyEdits` / `DocumentEditor` 直接操作 OOXML（只改 `w:t`、克隆已有 `w:r/w:p` 元素），不新建样式、不走虚拟树 patch。
- [x] **会话 anchor**：`AnchorRegistry`（ref 形如 `a21`），跨多次 `commit()` 稳定，无需往文档写任何东西。
- [x] **持久锚点**：`stampAnchors / readAnchors / stripAnchors`（core OOXML 书签，跨 Word/WPS/LibreOffice），产出成稿前剥离。
- [x] **模板 DSL**：`rules / styles / profiles / StyleRef`（anchor 优先，自包含）；悬空引用重映射与清理。
- [x] **AI 抽模板**：`ai-template` + `prompts/template.md`、`prompts/lab-report.md`（skill 文档，可 `--preset` / `--system-prompt` / `--extra` 覆盖）；AI 输出 `edits` 规范化删除引导内容并裁剪锚点表，输出 `skeleton.md` 填字稿。
- [x] **渲染器**：填空 + 标题/正文/代码/列表（嵌套、任务列表）/引用/分隔线/行内格式（粗斜删代码链接）；支持 `use:` 覆盖样式、`padding:` 分组等宽对齐、`align:` 组内对齐。
- [x] **沙盒**：`runEditSandbox`（`node:vm`）+ `EDITOR_API_DOC`，可执行 AI 生成的编辑代码。
- [x] CLI：`analyze / template / ai-template / render / edit`；单测 32 个。

## 待办

- [ ] **hustreport 表格渲染**（`w:tbl`）：解析出的 table block 目前渲染时告警跳过；需要克隆/构造表格 + 单元格填充。
- [ ] **hustreport 图片插入**：`![alt](ref:锚点)` 目前按填空处理，未生成 `w:drawing` + 关系。
- [ ] **hustreport 段落级对齐**：`align` 现为「padding 组内空格对齐」，可补 `pAlign` 作用于 `w:jc`。
- [ ] **报告模板库**：把抽卡得到的好模板沉淀、分发（模板 + `template.json` 版本化）。
- [ ] `ai-template` 生成质量评估：对同一文档多跑几次对比产物，挑最优模板。

- [ ] **公选课全量课表获取（只读，`client.zxq`）**：公选课为抽签分配，**只抓全量课程数据供分析课标冲突，不做选/退课**。
  - 状态：**未实现**。选课系统（`wsxk.hust.edu.cn`）非选课季时 `zxqremian.action` 仅返回「本次选课安排还未公布」，无任何课程行，
    **响应 schema 无法采样**；需等选课窗口开启后（或拿到一份真实响应样本）再补。
  - 已验证的登录链（用 `CASTGC` 免密换票，`CAS service = https://wsxk.hust.edu.cn/hustpass2.action`）：
    `/hustpass2.action` → `/select.jsp` → DWR `AuthPermissionService.getUserMenuList` 取菜单 →
    公选课入口 `GGXK`：`/studentControl!chooseSystem.action?xkxt=zxq` →
    `/zxqstudentcourse/selectzxqbody.action` → 框架页 `/zxqcourse/index_zxq.jsp`。
  - 只读端点（计划在此封装）：
    - `/zxqstudentcourse/zxqremian.action` —— **公选课全量余量/课表列表（核心，选课季才有数据）**
    - `/zxqstudentcourse/zxqalreadycourse.action` —— 已选结果（含退选入口，只读解析）
    - `/zxqstudentcourse/zxqyxcourses.action` —— 已修课程
    - DWR：`ZxqCoursesService.findDbTime`（服务器时间）、
      `AuthPermissionService.selectXkqx` / `getYxCourses` / `findKtByKcmcAndXqh3`
  - 待办：新增 `hustpass/src/zxq.ts`（`wsxkService` + `ZxqApi`），接入 `client.zxq`、`hustpass/index.ts` 导出、example 与 `docs/academic/zxq.md`；
    解析策略以真实 HTML 表格字段为准（课程名 / 课程号 / 课堂号 / 教师 / 时间 / 地点 / 容量 / 已选 / 余量）。

- [ ] **hkwxy 的 `tp_up` / `tp_wp` 仍会各触发一次续期**：两者会话 cookie 路径已隔离（`/tp_up`、`/tp_wp`），
  但该站点的会话/负载均衡粘性在另一应用登录后会让先前会话失效，属服务端行为，cookie jar 无法规避（会自动自愈）。
- [ ] 若需要，可把服务大厅（`client.hkwxy.getServiceCenter`）作为静态资源纳入聚合（目录型数据，价值有限）。
