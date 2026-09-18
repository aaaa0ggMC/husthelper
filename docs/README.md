# husthelper 文档

按模块分组。返回字段与接口参数可能随学校系统更新而变化，请以实际返回为准。

## 校园网（hustnet）

- [校园网认证 hustnet](./hustnet/hustnet.md) — 独立的 eportal 认证：劫持探测、JSESSIONID、运行时 RSA、CLI

## 统一身份认证（hustpass）

- [认证 auth](./auth/auth.md) — 登录流程、验证码识别策略、会话与自动续期、account 获取
- [one.hust one-hust](./auth/one-hust.md) — one.hust OIDC 委托认证、bearer token 获取与缓存

## 生活与资产

- [流水查询 transactions](./life/transactions.md) — 查询参数、分页、返回对象字段
- [个人信息 profile](./life/profile.md) — 校园卡账户信息读取与解析
- [在线设备 online-devices](./life/online-devices.md) — hkwxy 在线设备查询
- [微校园服务大厅 service-center](./life/service-center.md) — hkwxy/tp_wp 服务大厅主界面与 JSESSIONID 换取点
- [宿舍电费 electricity](./life/electricity.md) — sdhq 移动后勤：CAS 会话 + SM2/SM3 鉴权、电表与剩余电量
- [校园网自助服务 selfservice](./life/selfservice.md) — myself：CAS 会话 + GBK HTML 解析、余额/套餐/在线设备

## 教务与学术

- [成绩查询 grades](./academic/grades.md) — mhub/HUB 成绩、学年学期、加权成绩修正
- [学业考试 exam](./academic/exam.md) — mhub/HUB 考试安排、学期与考试类型查询
- [空闲教室 free-room](./academic/free-room.md) — mhub/HUB 教学楼、教学周与空闲教室查询
- [智慧课程 smartcourse](./academic/smartcourse.md) — 课程平台 cookie 认证、课表/通知接口、enc 签名盐来源
- [学期注册 registration](./academic/registration.md) — 注册状态、当前学期与注册通知
- [第二课堂 ihuster](./academic/ihuster.md) — CAS→JWT（OAuth）、二课学分汇总与用户信息
- [体育教学管理 pejxgl](./academic/pejxgl.md) — CAS 认证、学期列表、课外锻炼次数与已修/已选体育课
- [场馆服务 pecg](./academic/pecg.md) — 经 petyxy SSO 登录、预约记录（服务端渲染 HTML 解析）
- [华中大体育 petyxy](./academic/petyxy.md) — petyxy SSO、体质测试成绩（服务端渲染 HTML 解析）

## 报告处理（hustreport）

- [报告文档 hustreport](../hustreport/README.md) — docx 样式分段、路径索引 `Ref` 与 CSV 导出，多媒体以 `img_xxxx` handle 表示

## 聚合

- [聚合 aggregate](./aggregate.md) — 跨平台聚合资源（schema 驱动、并发合并、失败降级）
