# 场馆服务（pecg）

数据来自华中科技大学场馆预约系统 `https://pecg.hust.edu.cn`，登录经「华中大体育」`petyxy.hust.edu.cn` 的 SSO。

## 认证（petyxy SSO → pecg）

pecg 不直接面向 CAS，而是复用 petyxy 这个 CAS 应用。完整链路**全部由 CASTGC 驱动**，不需要企业微信：

```
1. GET  pecg   /cggl/appv2/loginto              → 302 petyxy /ggtypt/login?service=<loginto>
2. GET  petyxy /ggtypt/login?service=...        → 200（页面内 JS 跳转 CAS），并种下 /ggtypt 会话
3. GET  pass   /cas/login?service=<dologin>     → 302 petyxy /ggtypt/dologin?ticket=ST-...
4. GET  petyxy /ggtypt/dologin?ticket=ST        → 302 /ggtypt/dologin（自身）
5. GET  petyxy /ggtypt/dologin                  → 302 pecg /cggl/appv2/loginto?ticket=<uuid>
6. GET  pecg   /cggl/appv2/loginto?ticket=...   → 302 /cggl/appv2/home（pecg JSESSIONID 就绪）
```

要点：

- CAS 的 `service` 恒为 `http://petyxy.hust.edu.cn/ggtypt/dologin`；
- 最终由 pecg 侧的 `/cggl/appv2/loginto` 把 petyxy 签发的 UUID ticket 兑换成 **pecg 自己的 `JSESSIONID`**；
- 因此无法用通用 `CasService` 的一条 `exchangeTicket` 覆盖；`client.pecg` 复用 `src/petyxy.ts` 的 `acquirePetyxySession`（目标设为 pecg 的 `/loginto`），再由 `acquirePecgSession` 包装；
- 失效时页面会渲染「请重新登陆！」（HTTP 200，不是 302），客户端据此自动重走 SSO 并重试一次。

> 目前仅用 `CASTGC` 免密验证；若 `CASTGC` 缺失会回退完整登录（RSA + 验证码）。

## client.pecg.getMyReserveList()

实际请求 `GET https://pecg.hust.edu.cn/cggl/appv2/getMyReserveList`。服务端返回的是**预渲染 HTML 页面**（非 JSON），本库用 `parseReserveList` 解析成结构化数组。

```ts
const reserves = await client.pecg.getMyReserveList();
for (const r of reserves) {
  console.log(`${r.useTime} ${r.venue} ${r.court} ${r.orderStatus} ￥${r.amount}`);
}
```

### VenueReserve

```ts
interface VenueReserve {
  reserveId?: string;   // 预约 ID（详情页用）
  venue?: string;       // 场馆/场地名称，如 "(主校区)西区操场-西边网球场1小时场"
  useTime?: string;     // 使用时段，如 "2026-06-02 13:00-14:00"
  court?: string;       // 预约场地，如 "1号场地"
  orderStatus?: string; // 订单状态：已缴费 / 未成功 ...
  amount?: number;      // 订单金额（元）
  payStatus?: string;   // 支付状态：已支付 / 未支付
  orderTime?: string;   // 下单时间，如 "2026-06-02 11:18:42"
  raw: string;          // 原始 <div class="recordBox"> 片段
}
```

页面结构（每条记录）：

```html
<div class="recordBox radius">
  <div class="title" onclick="openView('/appv2/reserve_detail?reserveId='+2194587);">
    <span>(主校区)西区操场-西边网球场1小时场</span>
  </div>
  <div class="recordInfo"><div>使用时段</div><span>2026-06-02 13:00-14:00</span></div>
  <div class="recordInfo"><div>预约场地</div><span>1号场地</span></div>
  <div class="recordInfo"><div>订单状态</div><span class="normal">已缴费</span></div>
  <div class="recordInfo"><div>订单金额</div><span class="normal">9.00</span></div>
  <div class="recordInfo"><div>支付状态</div><span class="normal">已支付</span></div>
  <div class="recordInfo"><div>下单时间</div><span>2026-06-02 11:18:42</span></div>
</div>
```

解析规则：按 `recordBox` 切块，从 `title > span` 取场馆名、从 `reserveId=` 取 ID，其余按「`recordInfo` 的标签 → 值」映射；文本会去除标签、`&nbsp;` 并归一空白。

## 聚合

`client.pecg` **尚未**接入 `client.aggregate`，后续会纳入，见仓库根目录 `TODO.md`。

> 页面结构与字段可能随系统更新而变化，请以实际返回为准。
