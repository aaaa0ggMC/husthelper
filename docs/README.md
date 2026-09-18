# husthelper 文档

- [认证 auth](./auth.md) — 登录流程、验证码识别策略、会话与自动续期、account 获取
- [流水查询 transactions](./transactions.md) — 查询参数、分页、返回对象字段
- [个人信息 profile](./profile.md) — 校园卡账户信息读取与解析
- [成绩查询 grades](./grades.md) — mhub/HUB 成绩、学年学期、加权成绩修正
- [学业考试 exam](./exam.md) — mhub/HUB 考试安排、学期与考试类型查询
- [空闲教室 free-room](./free-room.md) — mhub/HUB 教学楼、教学周与空闲教室查询
- [在线设备 online-devices](./online-devices.md) — hkwxy 在线设备查询
- [微校园服务大厅 service-center](./service-center.md) — hkwxy/tp_wp 服务大厅主界面与 JSESSIONID 换取点
- [one.hust one-hust](./one-hust.md) — one.hust OIDC 委托认证、bearer token 获取与缓存
- [智慧课程 smartcourse](./smartcourse.md) — 课程平台 cookie 认证、课表/通知接口、enc 签名盐来源
- [体育教学管理 pejxgl](./pejxgl.md) — CAS 认证、学期列表、课外锻炼次数与已修/已选体育课
- [场馆服务 pecg](./pecg.md) — 经 petyxy SSO 登录、预约记录（服务端渲染 HTML 解析）
- [华中大体育 petyxy](./petyxy.md) — petyxy SSO、体质测试成绩（服务端渲染 HTML 解析）
- [聚合 aggregate](./aggregate.md) — 跨平台聚合资源（schema 驱动、并发合并、失败降级）
- [校园网认证 hustnet](./hustnet.md) — 独立的 eportal 认证：劫持探测、JSESSIONID、运行时 RSA、CLI

返回字段与接口参数可能随学校系统更新而变化，请以实际返回为准。
