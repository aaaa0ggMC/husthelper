# 微校园服务大厅（hkwxy / tp_wp）

数据来自智慧校园 `https://hkwxy.hust.edu.cn` 下的 `tp_wp` 应用，即「微校园」服务大厅主界面：

```
https://hkwxy.hust.edu.cn/tp_wp/service-center/f7d79779c3fe4e2aa714ec0c5693ecb6
```

## 认证（JSESSIONID 换取点）

`tp_wp` 与在线设备用的 `tp_up` 是**不同的 CAS service**：

```
GET hkwxy /tp_wp/service-center/<id>
  -> 302 /tp_wp/403
  -> 302 pass.hust.edu.cn /cas/login?service=https://hkwxy.hust.edu.cn/tp_wp/403
```

即换取 `JSESSIONID` 的 CAS `service` 是 **`https://hkwxy.hust.edu.cn/tp_wp/403`**。复用 `CASTGC` 免密换票后即可访问服务大厅；失效时本库按此 service 自动重新换票重试。

> 注意：`tp_up`（在线设备）与 `tp_wp`（服务大厅）是两个应用，各自会话的 cookie `Path` 不同，同名 `JSESSIONID` 在浏览器里并存。本库 cookie jar 按域名存储，两者交替使用时会各自触发一次续期，属正常现象。

## client.hkwxy.getServiceCenter(id?)

实际请求 `GET /tp_wp/service-center/<id>`，返回**预渲染 HTML**，本库用 `parseServiceCenter` 解析成「大类 → 分组 → 服务」三层结构。`id` 默认 `HKWXY_SERVICE_CENTER_ID`（实测固定值）。

```ts
const sections = await client.hkwxy.getServiceCenter();
for (const section of sections) {
  for (const group of section.groups) {
    for (const item of group.items) {
      console.log(section.name, group.name, item.name, item.url);
    }
  }
}
```

```ts
interface ServiceItem  { id?: string; name: string; url: string; icon?: string; }
interface ServiceGroup { name: string; items: ServiceItem[]; }
interface ServiceSection { name: string; groups: ServiceGroup[]; }
```

实测当前页面只有一个大类「教育教学」，包含分组：课程、考试、场所、实验实践、iHuster、培养、教师发展、学生工作、就业、审核。

页面结构（每条服务）：

```html
<div class="financial-se-title"><div class="text-box">教育教学</div></div>
<ul class="financial-se-list">
  <li class="financial-se-block" index="1">
    <div class="title-box-row">课程</div>
    <div class="apps-list-block">
      <a class="apps-item" index="1" href="..." id="27524b56a8504ef4bac25913b6a9f7bf">
        <span class="icon-box"><img src="..."/></span>
        <span class="apps-title"><font class="text">课程平台</font></span>
      </a>
      ...
    </div>
  </li>
</ul>
```

## 聚合

尚未接入 `client.aggregate`。

> 页面结构与服务项 id 可能随系统更新而变化，请以实际返回为准。
