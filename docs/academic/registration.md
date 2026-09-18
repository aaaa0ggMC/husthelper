# 学期注册（register）

数据来自学期注册及基本信息管理系统 `http://register.hust.edu.cn`（微信端 `/WeChatStudentIndex`）。

## 认证

普通 CAS 应用，`service` 为 `http://register.hust.edu.cn/WeChatLogin`。链路（CASTGC 驱动）：

```
1. GET  pass     /cas/login?service=<WeChatLogin>   → 302 register /WeChatLogin?ticket=ST-...
2. GET  register /WeChatLogin?ticket=ST             → 302 /WeChatLogin;jsessionid=<tomcat>（种下 JSESSIONID）
3. GET  register /WeChatLogin                       → 302 /WeChatStudentIndex
                                                      （JSESSIONID 轮换为 Shiro 的 UUID 会话，并 Set-Cookie rememberMe=deleteMe）
4. GET  register /WeChatStudentIndex                → 200
```

即用通用 `CasService` 逐跳跟随即可，最终会话是 UUID 形式的 `JSESSIONID`。之后 `/weChat/student/*` 接口复用该 cookie；失效时接口 302 到 `/login`，据此自动重连。

## 接口

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `getSemester()` | `POST /weChat/student/getXqmc` | 当前学期（学期号 / 学期名 / 起止日期） |
| `getStatus()` | `POST /weChat/student/getZczt` | 注册状态（如「已注册」） |
| `getNotices(query?)` | `POST /weChat/student/infor/noticeListData` | 注册通知（分页） |

> 这三个接口服务端是 POST（`getXqmc`/`getZczt` 实测 GET 也可用），`noticeListData` 必须用**表单**参数。

```ts
const semester = await client.register.getSemester();
// { XQH: "20261", XQMC: "2026年秋季", YWXQMC: "autumn 2026",
//   startDate: "2026-08-31", endDate: "2027-01-17" }

const status = await client.register.getStatus();
// { status: "已注册", registered: true }

const notices = await client.register.getNotices({ pageNum: 1, pageSize: 5 });
for (const n of notices.rows) console.log(n.PUBLISHDATE, n.ARTICLETITLE, n.ARTICLEID);
```

### 字段

```ts
interface RegistrationSemester {
  XQH?: string; XQMC?: string; YWXQMC?: string;
  startDate?: string; // 服务端键为 "TO_CHAR(QSRQ,'YYYY-MM-DD')"，已归一
  endDate?: string;   // 服务端键为 "TO_CHAR(JSRQ,'YYYY-MM-DD')"，已归一
  [key: string]: unknown;
}

interface RegistrationStatus {
  status?: string;    // 服务端提示，如 "已注册"
  registered: boolean;// status 是否包含「已注册」
  code?: number;
  [key: string]: unknown;
}

interface RegistrationNotice {
  ARTICLEID?: string;
  ARTICLETITLE?: string;
  PUBLISHDATE?: string; // 如 "2023-02-09"
  ROW_ID?: number;
  [key: string]: unknown;
}
```

`getNotices` 返回 `{ total, rows, code }`；请求体为 `pageNum=&pageSize=`（表单编码）。

## 聚合

尚未接入 `client.aggregate`，见仓库根目录 `TODO.md`。

> 字段可能随系统更新而变化，请以实际返回为准。
