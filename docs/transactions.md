# 流水查询

登录后即可查询本人一卡通消费/交易流水。

## getTransactions(query)

```ts
const page = await client.getTransactions({ page: 1 });
```

### TransactionQuery

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `account` | `string?` | 自动获取 | 一卡通账号；不传则用 `auth({ account })` 或自动解析 |
| `page` | `number?` | `1` | 页码，从 1 开始 |
| `dateStatus` | `number?` | `2` | 学校接口的日期范围参数 |
| `typeStatus` | `number?` | `1` | 学校接口的交易类型参数 |

> `dateStatus` / `typeStatus` 是学校接口的私有参数，含义可能随学校改动。默认值（`2` / `1`）对应「近期全部」。

### TransactionPage

```ts
interface TransactionPage {
  records: Transaction[]; // 当前页记录
  total: number;          // 总记录数
  pageSize: number;       // 每页条数
  nextPage: number | null;// 下一页页码；null 表示没有更多
}
```

## iterateTransactions(query)

自动按 `nextPage` 翻页的异步迭代器：

```ts
for await (const record of client.iterateTransactions({})) {
  console.log(record.occtime, record.mercname, record.sign_tranamt);
}
```

`query.page` 可指定起始页；其余字段同 `getTransactions`。

## 返回对象（Transaction）

学校接口返回的字段全部为**字符串**（包括金额、时间）。以下为当前实测字段，**可能随学校系统更新而变化**，请以实际返回为准：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `account` | `"123456"` | 一卡通账号 |
| `acctype` | `"000"` | 账户类型 |
| `trancode` | `"15"` | 交易码 |
| `tranname` | `"卡账户消费"` | 交易名称（如「电子账户银行转账」） |
| `mercacc` | `"2000205"` | 商户账号 |
| `mercname` | `"后勤开水机"` | 商户名称 |
| `tranamt` | `"1"` | 交易金额（**分**，无符号） |
| `sign_tranamt` | `"-1"` | 带符号金额（**分**），消费为负、充值/转入为正 |
| `cardbal` | `"48580"` | 卡余额（**分**） |
| `ebagamt` | `"48580"` | 电子账户余额（**分**） |
| `occtime` | `"20260916220800"` | 发生时间，格式 `YYYYMMDDHHmmss` |
| `remark` | `"posno:3100,..."` | 备注（POS/门禁等信息） |
| `bank_disamt` | `"0"` | 银行优惠金额（**分**） |

### 金额与时间处理

金额单位是**分**，除以 100 得元：

```ts
const yuan = Number(record.sign_tranamt) / 100; // -570 -> -5.70
```

`sign_tranamt` 带符号，适合展示净额；`tranamt` 是无符号金额。

`occtime` 为 `YYYYMMDDHHmmss`：

```ts
const t = record.occtime as string;
const date = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}`;
```

## 完整示例

```ts
import hust from "husthelper";

const client = hust
  .auth({ user_name: process.env.UN!, password: process.env.PWD! })
  .withStdChar();

let count = 0;
let sum = 0;
for await (const tx of client.iterateTransactions({})) {
  count++;
  sum += Number(tx.sign_tranamt) / 100;
}

console.log(`共 ${count} 笔，净额 ${sum.toFixed(2)} 元`);
```
