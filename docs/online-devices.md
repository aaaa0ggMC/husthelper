# 在线设备（hkwxy）

数据来自 `https://hkwxy.hust.edu.cn`。

## 认证

hkwxy 直接使用 `pass.hust.edu.cn` 的 CAS，`service` 就是页面 URL：

```
GET hkwxy /tp_up/v2?m=up
  -> 302 pass.hust.edu.cn /cas/login?service=https://hkwxy.hust.edu.cn/tp_up/v2?m=up
```

复用已有 `CASTGC` 即可免密换票，兑换 hkwxy 的 `JSESSIONID`。客户端自动处理，过期自动重连。

## getOnlineDevices()

```ts
const devices = await client.getOnlineDevices();
for (const device of devices) {
  console.log(device.onlineTime, device.userIpv4, device.userIpv6.join(", "));
}
```

实际请求 `POST https://hkwxy.hust.edu.cn/tp_up/apps/campusNetwork/onlineDevices`。

### OnlineDevice

```ts
interface OnlineDevice {
  userIpv4: string;
  userIpv6: string[];   // 接口里是逗号分隔字符串，已拆成数组
  onlineTime: string;   // 如 "2026-09-17 11:35:49"
  raw: Record<string, unknown>;
}
```

## 异常处理

接口可能返回非预期内容（无权限、错误提示等），本库会抛出带信息的错误：

- 返回 JSON 但结构不是数组（如 `{code, msg}`）：
  `在线设备接口返回异常: <msg>`
- 返回非 JSON（HTML/纯文本，含「无权限」等）：
  `在线设备返回了非 JSON 数据（无权限）: <片段>`

建议调用方 `try/catch`：

```ts
try {
  const devices = await client.getOnlineDevices();
} catch (error) {
  console.warn("获取在线设备失败:", error);
}
```

> 字段可能随学校系统更新而变化，请以实际返回为准。
