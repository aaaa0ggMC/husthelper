# hustreport

基于 [`docx-edit`](https://github.com/CZ600/docxEdit) 的报告文档处理模块。

- **Part 1（已完成）**：读取 `.docx` → 按“段落样式 + run 样式”切分内容 → 把不同样式去重成数字 `XML Style ID` → 导出带**路径索引**的 CSV（多媒体以 `img_xxxx` handle 表示）。
- **Part 2 / 3（接口已预留）**：把 CSV 与样式表发给 AI，AI 返回 `StyleInstruction[]`，引擎按指令复制/改写样式并回写 docx。

## 快速开始

```bash
# 在仓库根目录
pnpm install

# 解析并导出到 ./report-out
pnpm report analyze /path/to/report.docx

# 或指定输出目录 / 只看 CSV
node hustreport/bin/hustreport.ts analyze /path/to/report.docx --out ./tmp/report
node hustreport/bin/hustreport.ts analyze /path/to/report.docx --stdout
```

产物：

| 文件 | 内容 |
| :-- | :-- |
| `segments.csv` | 核心产物，`Index , Segments , XML Style ID , Ref` |
| `media.csv` | 媒体清单：`Handle , Ref , Filename , Content-Type , Width , Height , Alt` |
| `styles.json` | 每个 `XML Style ID` 的段落/run 直接格式、有效样式与摘要 |
| `analysis.json` | 完整分析结果（segments + styles + media + meta） |

## CSV 格式

```
Index , Segments , XML Style ID , Ref
0 , "Java 对象和类" , 0 , body#0/p@70040CDD/s0
1 , "Java 作为一种面向对象的编程语言，支持以下基本概念：" , 1 , body#0/p@1A2B3C4D/s0
3 , "img_0001" , 2 , body#0/p@5E6F7A8B/s0
```

- `Index`：segment 全局序号（文档顺序）。
- `Segments`：内容文本；多媒体以 handle 表示（见下）。
- `XML Style ID`：数字样式 ID，含义见 `styles.json`。同一个 ID 表示“段落样式 + run 样式”完全一致；段落内**连续同样式**的 run 会合并成一个 segment，不同段落不跨段合并。
- `Ref`：稳定路径索引（见下）。

转义规则：文本字段始终用 `"` 包裹，内部 `\` → `\\`、`"` → `\"`、换行 → `\n`、Tab → `\t`；分隔符 `,` 两侧允许空格，如 `a , b`。

## 稳定路径索引 `Ref`

```
body#0/p@4E2EFCDF/s1
 │    │   │          └─ 段内第几个 segment（按样式切分后的序号）
 │    │   └──────────── Word 稳定段落 ID w14:paraId
 └────┴──────────────── part 类型 # 同类型 part 序号
```

**为什么不用 run 下标**：run 序号会随文本改写、插入、删除而漂移，导致旧 ref 失效。现在段落身份取自 Word 的 `w14:paraId`（每段唯一、跨保存不变），段内用 segment 序号定位，因此：

- 改写文本后重新分析，同一个 segment 的 `Ref` **保持不变**；
- 插入 / 删除其它段落不会影响已有段落的 `Ref`；
- 插入的新段落会自动补一个 `w14:paraId`，下次分析即可寻址。

段落没有 `paraId` 时退化为 `body#0/p12/s1`（part 内序号）。可用 `walkParagraphs()` 复现同一套遍历顺序。

## 多媒体

图片等媒体不会把二进制塞进 CSV，而是分配一个稳定 handle：

- 文本里出现 `img_0001`；
- 详细元数据（`relId` / `filename` / `contentType` / 尺寸 / 所在 `Ref`）写入 `media.csv` 与 `analysis.json`。

## API

```ts
import { analyzeDocx, formatSegmentsCsv, parseSegmentsCsv, formatMediaCsv } from "hustreport";

const { doc, analysis } = await analyzeDocx("./report.docx", {
  partTypes: ["body", "header", "footer"], // 可选，默认全部
  includeEmptyParagraphs: false,           // 可选
});

console.log(analysis.meta);                 // { segmentCount, styleCount, charCount, partParagraphCounts }
const csv = formatSegmentsCsv(analysis.segments);
const rows = parseSegmentsCsv(csv);         // 往返解析
await writeFile("media.csv", formatMediaCsv(analysis.media));
```

数据结构（详见 `src/types.ts`）：

- `Segment { index, ref, text, styleId }`
- `SegmentRef { part, partIndex, paragraph, paraId, segment, runStart, runEnd, id }`
- `StyleEntry { id, key, paragraph, run, segmentCount, examples, summary }`
- `StyleSnapshot { ooxmlStyleId, direct, effective, headingLevel? }`
- `MediaEntry { handle, relId, filename, contentType, mediaPath, width, height, alt, ... }`

`StyleSnapshot.direct` 是文档里真实写入的 `w:pPr` / `w:rPr`（可原样复制）；`effective` 是 `docDefaults → 命名样式继承链 → 直接格式` 合并后的结果（用于理解“看起来是什么样”）。

## 改写 / 插入 / 删除（无损）

统一入口 `applyEdits(doc, { set, insert, delete })`，直接操作底层 OOXML，不经过虚拟树 patch。

```ts
import { openDocx, applyEdits } from "hustreport";

const doc = await openDocx("./任务书.docx");
const result = applyEdits(doc, {
  // 改写：只换 w:t，rPr/pPr 不动
  set: [
    { ref: "body#0/p@5F753281/s1", text: "计算机科学与技术学院" },
    { index: 21, text: "U202612345" },
    { styleId: 8, text: "王五", match: { contains: "  " } },
  ],
  // 插入：必须指定已存在的 useStyleId，深拷贝其 run/段落元素，不新建样式
  insert: [
    { ref: "body#0/p@B48EA131/s0", text: "1. 参考文献条目", useStyleId: 12, as: "paragraph", position: "after" },
    { ref: "body#0/p@B48EA131/s0", text: "（补充）", useStyleId: 12, as: "run", position: "after" },
  ],
  // 删除：run=删内容，paragraph=删整段
  delete: [{ ref: "body#0/p@5B99D6D3/s0", as: "run" }],
});
await doc.saveAs("./任务书.edited.docx");
console.log(result.applied, result.inserted, result.deleted);
```

CLI：

```bash
hustreport edit 任务书.docx --out edited.docx --edits plan.json
hustreport edit 任务书.docx --out edited.docx --set "body#0/p@031C48C2/s1=U202612345"
```

`plan.json`：

```json
{
  "set":    [ { "ref": "body#0/p@5F753281/s1", "text": "计算机科学与技术学院" } ],
  "insert": [ { "ref": "body#0/p@B48EA131/s0", "text": "六、参考文献", "useStyleId": 26, "as": "paragraph", "position": "after" } ],
  "delete": [ { "ref": "body#0/p@5B99D6D3/s0", "as": "run" } ]
}
```

**选择器**：`ref` / `index` / `styleId` 任选其一，`match: { contains | regex }` 可再过滤。

**无损性**：

- 改写只改目标 run 的 `w:t`，字体 / 字号 / 下划线等 `w:rPr` 原样保留；
- 插入通过**深拷贝已有样式的 `w:r` / `w:p` 元素**实现，所以 `w:rStyle` / `w:pStyle` 引用被原样复用，**不会新增任何样式**（重新分析后新 segment 落在原有 `XML Style ID` 上）；
- 删除直接摘除 XML 元素。

> 已知副作用（来自 `docx-edit` 本身，与本模块逻辑无关）：其解析空段落时会补一个空 `<w:r><w:t/></w:r>`，因此另存后空段落会多出一个不可见的空 run，语义上无影响。

## 后续接口预留（Part 2 / 3）

计划中的 AI 契约（尚未实现，先约定形状）：

```ts
type StyleInstructionAction = "copy" | "set" | "keep" | "clear";

interface StyleInstruction {
  styleId: number;                       // 目标 XML Style ID
  action: StyleInstructionAction;
  scope?: "run" | "paragraph" | "both";   // 默认 both
  sourceStyleId?: number;                // action = copy 时的来源样式
  paragraphStyle?: Record<string, any>;  // action = set
  runStyle?: Record<string, any>;
  match?: { contains?: string; regex?: string }; // 只作用于匹配的 segment
  reason?: string;
}
```

引擎将按 `Ref` 定位虚拟树节点，把来源样式的 `direct` 对象复制到目标 segment 的 run/段落上，再 `doc.patch()` 回写。

## 测试

```bash
pnpm --filter hustreport typecheck
pnpm --filter hustreport test
```
