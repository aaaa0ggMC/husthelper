# 校园网自助服务（selfservice）

数据来自华中科技大学**校园网自助服务系统** `http://myself.hust.edu.cn:8080/selfservice`。

## 认证

标准 CAS 应用。未登录访问任意页面都会 302 到 CAS，`service` 为 SSO 入口：

```
GET myself /selfservice/module/webcontent/web/index_self_hk.jsf
  -> 302 pass.hust.edu.cn /cas/login?service=http://myself.hust.edu.cn:8080/selfservice/module/scgroup/web/sso.jsf

带 CASTGC:  GET pass /cas/login?service=<sso.jsf>  -> 302 sso.jsf?ticket=ST-...
            GET myself /sso.jsf?ticket=ST            -> 302 index_self_hk.jsf?
            GET myself /index_self_hk.jsf            -> 200（种下 JSESSIONID，Path=/selfservice）
```

之后所有模块页面复用该 `JSESSIONID`，由 [`CasService`](../auth/auth.md) 自动续期。

> **注意**：自助系统的页面是服务端渲染的 **GBK** HTML，且会话过期时**不跳 CAS**，
> 而是返回 200 提示页（脚本含 `entry.jsp`，或错误页引用 `common/imgs/alert.png`）。
> SDK 以 `arraybuffer` 取回后按 GBK 解码，并用 `isSelfserviceLoginRedirect` 识别过期后自动重取。

## 接口

| 方法 | 页面 | 说明 |
| --- | --- | --- |
| `getOverview()` | `webcontent/web/index_self_hk.jsf` | 姓名、余额、套餐、在线设备数、上次登录、通知公告 |
| `getOnlineDevices()` | `webcontent/web/onlinedevice_list_hk.jsf` | 当前在线设备 + 无感认证（免密）设备 |
| `getProfile()` | `userself/web/regpassuserinfo_update_hk.jsf` | 用户名、姓名、手机号 |

## 用法

```ts
const overview = await client.selfservice.getOverview();
// {
//   userId: "U2025xxxxx", name: "张三", greeting: "晚上好",
//   lastLoginAt: "2025-10-10 15:53:41",
//   balance: 21.87, balanceText: "21.87",
//   package: "100元包半年", onlineDevices: 1,
//   canCharge: true, canChangePackage: true, canUpdateUserinfo: true,
//   notices: ["校园网服务电话：..."],
// }

const devices = await client.selfservice.getOnlineDevices();
// {
//   online: [ { name: "我的设备", ip: "10.0.0.10", mac: "AABBCCDDEEFF",
//               deviceTypeText: "个人电脑", onlineAt: "09-18 19:11:58" } ],
//   passwordless: [ { name: "我的设备", mac: "112233445566",
//                     deviceTypeText: "个人电脑", enabledAt: "2026-09-18 12:12:08" } ],
// }

const profile = await client.selfservice.getProfile();
// { userId: "U2025xxxxx", name: "张三" }
```

见 [`examples/get_selfservice.ts`](../../examples/get_selfservice.ts)：

```bash
node examples/get_selfservice.ts
```

## 字段

```ts
interface SelfserviceOverview {
  userId?: string; name?: string; greeting?: string; motto?: string;
  lastLoginAt?: string;
  balance?: number; balanceText?: string;
  package?: string; onlineDevices?: number;
  accountUuid?: string;
  canCharge?: boolean; canChangePackage?: boolean;
  canChangeArea?: boolean; canUpdateUserinfo?: boolean;
  notices: string[];
}

interface SelfserviceOnlineDevice {
  id?: string; name?: string; ip?: string; mac?: string;
  deviceType?: string; deviceTypeText?: string;
  onlineAt?: string;
}

interface SelfservicePasswordlessDevice {
  id?: string; name?: string; mac?: string;
  deviceType?: string; deviceTypeText?: string;
  enabledAt?: string;
}

interface SelfserviceProfile { userId?: string; name?: string; phone?: string; }
```

## 说明

- 解析函数 `parseSelfserviceOverview` / `parseSelfserviceOnlineDevices` / `parseSelfserviceProfile`
  独立导出，便于用离线 HTML 回归测试。
- 字段随学校系统更新可能变化，以实际返回为准。
