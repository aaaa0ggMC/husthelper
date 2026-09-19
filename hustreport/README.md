# hustreport

> ⚠️ **项目现状与开发状态说明**：
> 目前 `hustreport` **仍是半成品阶段，内部 BUG 较多**，很多边缘场景与复杂排版正在持续探索与重构中，请勿直接用于严肃生产环境。
> 欢迎在 [`examples/hustreport/`](../examples/hustreport/) 查看当前可运行的完整流程示例，或提交 Issue 共同改进！

基于 [`docx-edit`](https://github.com/CZ600/docxEdit) 的报告文档处理模块。核心目标：**保格式**地把 Markdown 内容填进已有的 Word 模板，不新建样式、不改乱排版。

整条链路（AI 只在抽模板时用一次，之后完全确定性）：

```
原始 docx
  │ analyze            按样式切分 segment，算 XML Style ID，导出带稳定 ref 的 CSV
  ▼
segments / styles
  │ ai-template        把样式表+锚点表交给 AI：出 rules / 配方 / 规范化 edits / skeleton.md
  ▼
template.docx + template.json + skeleton.md
  │ （人填 skeleton.md → fill.md）
  ▼
render  ──────────────►  final.docx
```

## 快速开始

```bash
pnpm install

# 1) 只读分析：切分 + 样式表 + CSV
node hustreport/bin/hustreport.ts analyze 任务书.docx --out ./out

# 2) 无 AI 的模板（打隐藏书签锚点 + 推断默认 DSL）
node hustreport/bin/hustreport.ts template 任务书.docx --out ./tpl

# 3) 有 AI：生成模板 + 规范化 + 填字稿（读 config.json 的 openai 段或环境变量）
node hustreport/bin/hustreport.ts ai-template 任务书.docx --out ./tpl --task "生成实验报告模板"
#   可选：--preset generic|labReport  --system-prompt my.md  --extra "附加要求"

# 4) 渲染：模板 + 填字稿 → 成稿
node hustreport/bin/hustreport.ts render ./tpl/template.docx \
  --info ./tpl/template.json --md ./tpl/fill.md --out ./final.docx
```

AI 配置（环境变量优先）：

```bash
export HUST_AI_BASE_URL=http://127.0.0.1:1145/v1
export HUST_AI_API_KEY=sk-xxxx
export HUST_AI_MODEL=deepseek/deepseek-flash
export HUST_AI_MAX_TOKENS=32768      # 推理模型需要更大的输出预算
```

## CLI 一览

| 命令 | 作用 |
| :-- | :-- |
| `analyze <docx>` | 切分 segment、样式表、`segments.csv / media.csv / styles.json / analysis.json` |
| `template <docx>` | 注入持久锚点 + 推断默认 DSL，产出 `template.docx / template.json` |
| `ai-template <docx>` | 在 template 基础上调用 AI，产出模板 + `skeleton.md`，并应用规范化 `edits` |
| `render <template.docx>` | 按 `template.json` + 填字稿渲染出成稿 |
| `edit <docx>` | 直接对文档做 set/insert/delete（见下） |

---

## Part 1 · 分析（analyze）

按「段落样式 + run 样式」切分内容，去重成数字 `XML Style ID`，导出 CSV。

```
Index , Segments , XML Style ID , Ref
0 , "Java 对象和类" , 0 , body#0/p@70040CDD/s0
1 , "Java 作为一种面向对象的编程语言，支持以下基本概念：" , 1 , body#0/p@1A2B3C4D/s0
3 , "img_0001" , 2 , body#0/p@5E6F7A8B/s0
```

- `Index`：全局序号；`Segments`：文本（多媒体是 `img_xxxx` handle）；`XML Style ID`：含义见 `styles.json`；`Ref`：稳定定位。
- 段落内**连续同样式**的 run 合并；不同段落不跨段合并。
- 转义：文本字段始终 `"` 包裹，`\`→`\\`、`"`→`\"`、换行→`\n`、Tab→`\t`。

### 稳定 Ref

```
body#0/p@4E2EFCDF/s1
 │    │   │          └─ 段内第几个 segment
 │    │   └──────────── Word 稳定段落 ID（w14:paraId）
 └────┴──────────────── part 类型 # 序号
```

ref 用 `w14:paraId` 而非 run 下标，**改写文本后重新分析 ref 不变**；文档没有 paraId 时退化为 `body#0/p12/s1`。

### 多媒体

图片不塞二进制，分配 handle（`img_0001`），元数据（relId/filename/contentType/尺寸/所在 Ref）写入 `media.csv` 与 `analysis.json`。

---

## Part 2 · 模板（template / ai-template）

### 模板 DSL（`template.json`）

```jsonc
{
  "version": 2,
  "kind": "hustreport/template",
  "anchors": {
    "hrseg0003": { "kind": "slot", "label": "学号", "styleId": 8, "style": { "anchor": "hrseg0003" } }
  },
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "styles": { "body": { "anchor": "hrseg0012" }, "code": { "anchor": "hrseg0042" } },
      "rules": [
        { "match": { "type": "heading", "level": 1 }, "style": { "anchor": "hrseg0007" } },
        { "match": { "type": "paragraph" }, "style": { "recipe": "body" } },
        { "match": { "type": "code" }, "style": { "recipe": "code" } }
      ]
    },
    "compact": { "extends": "default", "rules": [] }
  }
}
```

- **Anchor**：模板里的隐藏书签（core OOXML，Word/WPS/LibreOffice 都保留）。渲染前注入、产出成稿时剥离。
- **StyleRef**：`{anchor}`（首选，自包含）/ `{recipe}` / `{styleName}` / `{ooxmlStyleId}` / `{inline}`。全部指向已有样式，**不新建 `styles.xml` 条目**。
- **rules**：`match`（type/level/lang/ref）→ `style`，first-match-wins。
- **profiles**：一篇文章可挂多套模板（`extends` 继承覆盖）。

### AI 生成模板

提示词以 skill 文档形式维护，运行时读取（改文本即生效）：

```
hustreport/prompts/
├── template.md      # 通用：JSON schema / rules / skeleton 语法 / 约束
└── lab-report.md    # 实验报告类：逐段判断删除还是保留
```

`ai-template` 让 AI 输出 `rules / styles / anchors / edits / skeleton`：

- **`edits`（规范化）**：删除面向写作者的指令/格式要求/占位符（如「实验任务 1、2 的源程序（单倍行距，5号宋体字）」），保留标题/章节/任务描述等正文；应用后自动裁剪锚点表、重映射悬空样式引用。
- **`skeleton`（填字稿）**：只写需要填写或新增的内容，其余从模板原样保留。

三个开关精确控制提示词：`--preset generic|labReport`、`--system-prompt my.md`（完全替换内置）、`--extra "..."`（追加要求）。优先级：`systemPrompt` > `preset` > 默认 `labReport`。

---

## Part 3 · 渲染（render）

### 填字稿语法

```md
---
profile: default
---

[张三](ref:hrseg0024)                                    # 填空（原地替换）
[计算机2201班](ref:hrseg0020 | padding=cover)             # 同组补齐到等宽
[U202212345](ref:hrseg0022 | padding=cover align=center) # 组内居中
[正文内容](ref:hrseg0092 | use:body)                      # 覆盖锚点原有格式

# 六、参考文献 {ref:hrseg0095}                            # 章节插入（块）

其后段落 / 列表 / 代码块会按顺序插到该锚点之后。
```

- `[值](ref:锚点)`：**填空**，保留锚点 run 的格式。
- `# 标题 {ref:锚点}`：**块插入**，用 `rules` 的 heading 规则套样式；标题文字与锚点原文相同时不重复插入。
- 块属性还可带 `pos:before/after`、`profile:xxx`。
- 填字选项：`use:<recipe|锚点>`、`padding:<组名>`（**分组，不是长度**）、`align:left|center|right`、`profile:<名>`。

### 支持的内容

- 标题 / 段落 / 代码块 / 列表（含嵌套、任务列表 `- [x]`）/ 引用 / 分隔线；
- 行内：`**粗**`、`*斜*`、`~~删除~~`、`` `代码` ``、`[链接](url)`（外链自动注册关系）、链接内嵌强调；
- 全部通过克隆模板已有元素实现，字体/字号/下划线等 `w:rPr` 原样复用。

### 尚未支持

表格（会解析出 table block 但渲染时告警跳过）、图片插入、段落级对齐（`pAlign`）。

---

## API

```ts
import { analyzeDocx, createTemplate, buildTemplateWithAi, renderTemplateFile } from "hustreport";

const { doc, analysis } = await analyzeDocx("./任务书.docx");
const csv = formatSegmentsCsv(analysis.segments);

// 无 AI 模板
await createTemplate("./任务书.docx", "tpl/template.docx", "tpl/template.json");

// 有 AI 模板
await buildTemplateWithAi({ input: "./任务书.docx", outDir: "tpl", task: "...", chat: myChat });

// 渲染
await renderTemplateFile("tpl/template.docx", "tpl/template.json", "tpl/fill.md", "final.docx");
```

### 编辑器（会话内精确定位）

```ts
import { createEditor } from "hustreport";

const editor = await createEditor("./任务书.docx");
editor.set({ styleId: 8 }, "U202612345");                 // 选择器
editor.insertAfter(seg, "六、参考文献");                    // 默认复用目标样式
editor.insertManyAfter(anchor, [{ text: "1. ..." }, { text: "2. ..." }]);
editor.remove({ match: { contains: "占位" } }, { as: "run" });
await editor.save("./out.docx");
```

编辑用**会话 anchor**（`AnchorRegistry`，ref 形如 `a21`），跨多次 `commit()` 稳定；插入/删除只操作 OOXML 元素，不经过虚拟树 patch。

### 低级原语

- `applyEdits(doc, { set, insert, delete })`：无损改写/插入/删除，未命中的选择器只记 `warnings` 不抛错；
- `stampAnchors / readAnchors / stripAnchors`：持久书签锚点的注入/解析/剥离；
- `runEditSandbox(editor, code)`：`node:vm` 沙盒执行 AI 生成的编辑代码（`EDITOR_API_DOC` 是给 AI 的 API 说明）。

---

## 已知说明

- `docx-edit` 解析空段落时会补一个空 `<w:r><w:t/></w:r>`，属其自身行为，语义无影响。
- `edit` 的插入**不新建样式**：默认复用目标 segment 自己的样式，`useStyleId` 可显式指定。

## 测试

```bash
pnpm --filter hustreport typecheck
pnpm --filter hustreport test
```
