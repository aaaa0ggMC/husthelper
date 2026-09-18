# 个人信息（profile）

登录后可读取本人校园卡账户信息。

## client.ecard.getProfile()

```ts
const profile = await client.ecard.getProfile();

profile.name;            // 姓名
profile.cardBalance;     // 校园卡余额，如 "485.8"
profile.get("校园卡余额"); // 按页面原文标签取，等价
profile.rawHtml;         // 原始 HTML，自己解析
```

请求 `http://ecard.m.hust.edu.cn/wechat-web/service/profile.html` 并解析 HTML。

### 关于会话

- 实测**用查流水得到的同一个 `JSESSIONID` 就能直接访问 profile**，无需额外登录。
- 若会话已过期，服务端会重定向到 CAS 登录：`profile -> login -> profile?ticket=... -> 新的 JSESSIONID`。这条链路由客户端的自动续期机制处理（见 [认证](./auth.md#会话与自动续期)），无需手动干预。

## Profile

```ts
interface Profile {
  sections: ProfileSection[];          // 按页面分组（如「基本信息」「电子账户信息」）
  fields: Record<string, string>;      // 全部字段扁平化：标签 -> 值
  get(label: string): string | undefined;

  raw: string;                         // 原始 HTML
  rawHtml: string;                     // 原始 HTML（同上）

  // 常用字段的英文快捷访问（未命中时为 undefined）
  name?: string;                       // 姓名
  id?: string;                         // 编号
  department?: string;                 // 部门
  identity?: string;                   // 身份
  autoTransferAlert?: string;          // 自动转账警戒额
  openDate?: string;                   // 开户日期
  expireDate?: string;                 // 有效期
  bankCard?: string;                   // 绑定银行卡账号
  cardAccount?: string;                // 校园卡帐号
  cardBalance?: string;                // 校园卡余额
  status?: string;                     // 状态
  eWalletName?: string;                // 电子账户名
  eWalletType?: string;                // 电子账户类型
  eWalletBalance?: string;             // 电子账户余额
}
```

解析规则：页面结构为重复的 `<dl><dt>标签</dt><dd>值</dd></dl>`，只有 `<dt>` 没有 `<dd>` 的作为分组标题。标签、值都会去掉内嵌标签并解码 HTML 实体。

英文快捷属性是按当前页面标签映射的，**标签一旦变化对应属性会是 `undefined`**；此时用 `profile.fields[标签]` 或 `profile.get(标签)`，或直接 `profile.rawHtml` 自己解析。

## 字段

当前实测字段（**可能随学校系统更新而变化**，以实际为准）：

| 分组 | 标签 | 快捷属性 |
| --- | --- | --- |
| 基本信息 | `姓名` | `name` |
|  | `编号` | `id` |
|  | `部门` | `department` |
|  | `身份` | `identity` |
|  | `自动转账警戒额` | `autoTransferAlert` |
|  | `开户日期` | `openDate` |
|  | `有效期` | `expireDate` |
|  | `绑定银行卡账号` | `bankCard` |
|  | `校园卡帐号` | `cardAccount` |
|  | `校园卡余额` | `cardBalance` |
|  | `状态` | `status` |
| 电子账户信息 | `电子账户名` | `eWalletName` |
|  | `电子账户类型` | `eWalletType` |
|  | `电子账户余额` | `eWalletBalance` |

> 注意标签用的是页面原文，例如是「校园卡帐号」（帐）而不是「账号」。用 `profile.fields[标签]` 直接取。

## 示例

```ts
const profile = await client.ecard.getProfile();

for (const section of profile.sections) {
  console.log(`# ${section.title}`);
  for (const { label, value } of section.fields) {
    console.log(`  ${label}: ${value}`);
  }
}

const balance = Number(profile.fields["校园卡余额"]?.replace("元", "") ?? NaN);
if (balance < 20) console.log("余额不足 20 元");
```

> ⚠️ `Profile` 含姓名、学号、银行卡等敏感个人信息，请勿提交到公开仓库或分享。
