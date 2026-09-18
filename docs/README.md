# husthelper 文档

- [认证 auth](./auth.md) — 登录流程、验证码识别策略、会话与自动续期、account 获取
- [流水查询 transactions](./transactions.md) — 查询参数、分页、返回对象字段
- [个人信息 profile](./profile.md) — 校园卡账户信息读取与解析
- [成绩查询 grades](./grades.md) — mhub/HUB 成绩、学年学期、加权成绩修正
- [在线设备 online-devices](./online-devices.md) — hkwxy 在线设备查询
- [one.hust one-hust](./one-hust.md) — one.hust OIDC 委托认证、bearer token 获取与缓存
- [智慧课程 smartcourse](./smartcourse.md) — 课程平台 cookie 认证、课表/通知接口、enc 签名盐来源
- [聚合 aggregate](./aggregate.md) — 跨平台聚合资源（schema 驱动、并发合并、失败降级）
- [校园网认证 hustnet](./hustnet.md) — 独立的 eportal 认证：劫持探测、JSESSIONID、运行时 RSA、CLI

返回字段与接口参数可能随学校系统更新而变化，请以实际返回为准。
