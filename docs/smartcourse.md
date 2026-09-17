# 智慧课程平台（smartcourse）

`https://smartcourse.hust.edu.cn`，命名空间 `client.smartcourse`。

## 认证

和 one.hust 一样是「嵌套 OAuth2」，但**不换 token**，而是由课程平台一次性下发一堆
`.hust.edu.cn` 域的会话 cookie（`p_auth_token`、`vc/vc2/vc3`、`1731userinfo`、`uname` …）：

```
/cas/login?service=<authorize>            → 302 <authorize>?ticket=ST1
<authorize>?ticket=ST1                     → 302 /cas/login?service=callbackAuthorize（轮换 CAS JSESSIONID）
/cas/login?service=callbackAuthorize       → 302 callbackAuthorize?ticket=ST2
callbackAuthorize?ticket=ST2               → 302 /sso/login/3rd?...&code=ST2
/sso/login/3rd?...&code=ST2                → 200，Set-Cookie 一大坨（Domain=.hust.edu.cn）
```

因此直接建模成普通 `CasService`（`service` = `oauth2.0/authorize` URL）。`exchangeTicket`
逐跳跟随重定向时会吸收每一跳的 `Set-Cookie`，父域 cookie 也会匹配到 smartcourse 子域。
多次 CAS `JSESSIONID` 轮换是 CAS OAuth2 两段式（authorize + callbackAuthorize 各一个 ticket）导致。

失效时会走通用逻辑：`CASTGC` 免密重换 → 失败则完整登录，cookie 一并持久化。

## API

```ts
await client.smartcourse.request("/mh-smartcourse/"); // 任意请求，首次触发认证
client.smartcourse.sessionId;  // p_auth_token
client.smartcourse.cookies();  // 平台当前全部 cookie

await client.smartcourse.getLoginUser();
// { puid, name, schoolname, pic, fid, isCertify, ... }

await client.smartcourse.getMyLessons();
// { curriculum: { schoolYear, currentWeek, ... }, lessonArray: Lesson[] }

await client.smartcourse.getCourseList();     // { teach: [], study: [课程] }
await client.smartcourse.getStudyCourses();   // 要上的线上课程（HTML 解析，支持筛选参数）
await client.smartcourse.getNoticeList();     // 默认 type=2「我接收到的」
noticeItems(result);                           // 从返回里取通知数组

await client.smartcourse.getOneDayLessons();  // 当天课表
client.smartcourse.puid;                        // 同步读 cookie
```

`getStudyCourses(query?)` 返回 `StudyCourse[]`，每项含 `courseId/clazzId/personId/name/credits/hours/url/cover/kcenc/ckenc/clazzenc/raw`。
其接口 `getStudyCourse` 返回的是**服务端渲染的 HTML**（非 JSON），解析器导出为 `parseStudyCourses(html)`。
默认参数取自线上课程页（`sectionId=14&semesterNum=20261&moreplat=0...`），可用 query 覆盖。

## 注意：空数据是正常现象

平台部分模块（如**考试 exam 信息**）在账号当下没有对应数据时会返回空结果——例如尚无考试安排时
相关接口就是空的。**这是正常的，不代表接口失败或解析有误**；等有考试/数据后自然会返回内容。

本库对这些接口只在明确的错误码（`result:0` / `status:false` / 非 200 `code`）时抛错，
空数组/空对象会原样返回，调用方自行判断是否有数据。

## 魔法数字（enc 签名盐）

`getOneDayLessons` 需要 `enc=md5(PUID + 盐)`，这个**盐是 smartcourse 平台前端硬编码的**
（不是本库能推导的）：当前为 `SMARTCOURSE_ENC_SALT = "uhZxJkJmck"`。

> 若该接口开始返回 `{result:0, errorMsg:"参数校验失败"}`，通常是平台更换了这个 magic number。
> 请访问下面这个前端 bundle，搜索 `getOneDayLessons` 附近的 `md5(PUID + ...)`，取出新盐并更新：
>
> `https://smartcourse.hust.edu.cn/noteyd-smartcourse/front/pageindex/pc/js/index.js?t=20240524`

该 bundle 里另有 `MknMOcmoOTZNOdDhzlAsollJfae8HpLP`（`getLiveStatus` 的旧 `signature` 盐）和
`glomZ43ewhJWFmbc`（旧 `clientid`），但都处于**注释掉的死代码**中；现行 `getLiveStatus`
只用查询参数 `?type=1&jxbIds=<encodeURI(JSON.stringify(jxbIds))>`，无需签名。
