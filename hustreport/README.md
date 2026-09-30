# hustreport

> 基于 [`docx-edit`](https://github.com/CZ600/docxEdit) 的报告文档处理引擎。核心目标：**保格式**地把 Markdown 内容填进已有的 Word 模板，不新建冗余样式、不改乱原有排版。

> ## ⚠️ 使用须知（请务必阅读）
>
> - **最重要**：如果文档包含**目录（TOC）**，生成后**务必在 Word / WPS 中点击「更新目录 / 更新域」**（选中目录后按 `F9`）来刷新页码与条目——打开成稿时目录页码可能仍是占位值，不点一次就不准确。
> - 本工具是**辅助排版工具**，不是代写工具；它**不保证**生成的内容或格式一定符合课程 / 单位的规范要求。
> - `ai-template` 阶段由 AI 抽取模板，可能**误删或漏删**（把客观题目当成写作指引删掉、或漏删占位符），样式与层级推断也可能不准确。`render` 虽是确定性执行，但**执行的是 AI 的决策**。
> - 因此，**最终产出的 `final.docx` 必须由使用者本人再审核一次**，确认无误后方可作为正式提交材料。
> - 其余核对清单见 [使用边界与人工审核](#使用边界与人工审核)。

整条链路（AI 只在制作模板时调用一次，后续填字与渲染完全确定性）：

```
原始 docx
  │ analyze            按样式切分 segment，算 XML Style ID，提取批注与媒体，导出带稳定 ref 的 CSV
  ▼
segments / styles / comments
  │ ai-template        把样式表+锚点表+批注交给 AI：出 rules / 配方 / 规范化 edits / TOC 配置 / skeleton.md
  ▼
template.docx + template.json + skeleton.md
  │ （人填 skeleton.md → fill.md，支持追加/修改各级标题、段落、代码块、图片、学术表格）
  ▼
render  ──────────────►  final.docx（自动更新目录域、语法高亮、三线表、自动剥离临时锚点与批注气泡）
```

---

## 快速开始

> **输入格式**：只接受 `.docx`。旧版 `.doc` 是 OLE2 二进制格式，无法在纯 JS 中无损解析，
> 遇到时会直接报错，请在 WPS / Word 中「另存为」`.docx` 后再使用。

```bash
pnpm install

# 1) 只读分析：切分 + 样式表 + 批注 + CSV
node bin/hustreport.ts analyze 任务书.docx --out ./out

# 2) 纯规则打底模板（打隐藏书签锚点 + 推断默认 DSL，无 AI）
node bin/hustreport.ts template 任务书.docx --out ./tpl

# 3) AI 智能生成模板：规范化底板 + 标题级别校准 + 提取批注规范 + 诊断缺失样式 + 填字稿
node bin/hustreport.ts ai-template 任务书.docx --out ./tpl --task "生成实验报告模板"
#    可选：--preset generic|labReport  --system-prompt my.md  --extra "附加要求"

# 4) 确定性渲染：模板 + 填字稿 → 成稿（支持代码主题、图片、表格与目录更新）
node bin/hustreport.ts render ./tpl/template.docx \
  --info ./tpl/template.json --md ./tpl/fill.md --out-file ./final.docx

# 渲染前自检：不写文件，逐块列出模式 / 主题 / 样式来源 / 跳过原因
node bin/hustreport.ts render ./tpl/template.docx \
  --info ./tpl/template.json --md ./tpl/fill.md --dry-run --trace
```

> 所有命令都支持 `--json`（stdout 只输出一个 JSON 结果，日志走 stderr），详见 [脚本与 Agent 集成](#脚本与-agent-集成)。

### 配置文件（一份就够）

推荐在项目根放一份 **`hustreport.config.json`**，AI 段（`openai`）与渲染段（`code` / `image` / `table`）共存：

```jsonc
{
  "openai": { "baseURL": "https://api.deepseek.com/v1", "apiKey": "sk-xxxx", "model": "deepseek-chat" },
  "code":   { "mode": "auto", "template": "default" },
  "table":  { "theme": "academic" }
}
```

- **查找规则**：从当前目录**逐级向上**查找，命中即用，所以在子目录里运行也能读到仓库根的配置。
  - 渲染段：`hustreport.config.json` → `report.config.json`
  - AI 段：`hustreport.config.json` → `config.json`，取**第一个真正含 `openai`（或 `ai`）段**的文件（兼容仓库根已有的 `config.json`）
- `--config <file>` 对 `ai-template` 和 `render` **都生效**；指定的文件不存在会直接报错，而不是悄悄忽略。
- 启动时会打印实际加载的配置来源（`AI 配置来源：…` / `配置：…`），`--json` 结果里也有 `configSource`。
- AI 段也可以只用环境变量（优先级高于文件）：

```bash
export HUST_AI_BASE_URL=https://api.deepseek.com/v1
export HUST_AI_API_KEY=sk-xxxx
export HUST_AI_MODEL=deepseek-chat
export HUST_AI_MAX_TOKENS=32768      # 建议设置较大预算以生成完整 skeleton
```

---

## CLI 命令一览

| 命令 | 常用参数 | 作用 |
| :-- | :-- | :-- |
| `analyze <docx>` | `--out-dir <dir>`<br>`--parts body,header`<br>`--include-empty`<br>`--stdout` | 深度分析 docx：按段落/run样式切分，输出 `segments.csv`、`styles.csv`、`media.csv`、`styles.json` 与 `analysis.json`。 |
| `template <docx>` | `--out-dir <dir>` | **离线兜底，不调用 AI**（正式使用请走 `ai-template`）：仅注入锚点、推断一条正文规则，**不产出 skeleton、标题规则，也不清理写作提示**。纯规则打底：注入持久隐藏书签锚点（`hrsegXXXX`），推断默认样式与规则，产出 `template.docx` 与 `template.json`。 |
| `ai-template <docx>` | `--out-dir <dir>`<br>`--task <str>`<br>`--preset generic\|labReport`<br>`--system-prompt <file>`<br>`--extra <str>`<br>`--max-anchors <n>`<br>`--config <file>`<br>`--from-response <file>` | 结合 AI 审查文档：执行语义级删除/清理（`edits`），校准标题样式，配置目录（TOC），给出缺失样式反馈并产出 `skeleton.md`。同时落盘 `ai-prompt.md` 与 `ai-response.txt`；`--from-response ai-response.txt` 可**不调模型**直接重新合并。请求期间每 15 秒打印一次等待进度。 |
| `render <template.docx>` | `--info <template.json>`<br>`--md <fill.md>`<br>`--out-file <final.docx>`<br>`--config <file>` / `--extra <kv>`<br>`--code-mode auto\|native\|card`<br>`--code-template <name>`<br>`--strict` / `--dry-run` / `--trace`<br>`--append-unanchored`<br>`--keep-comments` | 将 Markdown 渲染填入模板：就地填空、插入标题/段落/列表、代码块、图片、表格，同步更新目录与清理批注。结束时输出「填空 N 处 / 插入 M 块（标题、段落、表格、图片、代码原生/卡片…）」。 |
| `edit <docx>` | `--out-file <out.docx>`<br>`--edits <edits.json>`<br>`--set <ref>=<text>`<br>`--dry-run` | 针对 docx 进行精确的底层批处理改写、插入或删除（仅复用已有样式 ID，不污染 `styles.xml`）。 |

- **通用**：`--json` 输出结构化结果；`--out` 为兼容旧写法（目录型命令视为目录，`render`/`edit` 视为文件），传错类型会给出明确提示。
- 模型接口报错时会按状态码给出下一步：`402` 余额不足（充值后重跑，重试无效）、`401/403` 检查 apiKey 与模型权限、`404` 检查 baseURL 与 model、`429` 限流稍后重试；并提示可用 `--from-response ai-response.txt` 不调模型直接重新合并已有结果。
- `render --strict`：缺图直接报错；**任何警告**（未知 ref、无锚点被跳过的块等）都会报错且**不写出成稿**。默认则是“占位 + 警告”继续出稿。
- `render --append-unanchored`：没有 `{ref}` 也没有前置锚点的块追加到文末，而不是跳过。

---

## 中英文空格排版（`--cjk-spacing`）

确定性、可配置，不含随机。以「我是 Claude Code 助理」为例：

- `lspace`：中文→西文/数字 边界（「是」与「Claude」之间，即西文**左侧**）
- `rspace`：西文/数字→中文 边界（「Code」与「助理」之间，即西文**右侧**）
- 取值 `add`（保证恰有一个空格）/ `remove`（去掉空格）/ `keep`（原样）；西文词内部的空格（`Claude Code`）不受影响

| 用法 | 效果 |
| :-- | :-- |
| `--cjk-spacing space` | 两侧都加：我是 Claude Code 助理 |
| `--cjk-spacing tight` | 两侧都不留：我是Claude Code助理 |
| `--lspace add --rspace remove` | 自定义：我是 Claude Code助理 |
| 默认 / `keep` | 不改动 |

- 「西文」包含**字母与数字**（`共 3360 个用例`）；全角标点与西文之间不加空格。
- **行内代码**在边界上按西文对待（`调用 \`strlen\` 函数`），代码内部、链接目标、URL、块属性 `{…}` 不动。
- **围栏代码块一律不动**；` ```text ` 展开的纯文本段落（如参考文献）是“原样照搬”语义，同样不动。表格单元格、列表、标题、图注会处理。
- 强调标记（`**加粗**`）会隔断相邻关系，不做处理；封面填空（`[..](ref:..)`）不处理。
- 配置文件里写 `"format": { "cjkSpacing": "space", "lspace": "add", "rspace": "keep" }`，命令行优先于配置；取值写错会直接报错。

---

## 覆盖准则（谁说了算）

渲染时每一项排版设置（代码模式/主题/行号/边框、图片对齐/尺寸/图注、表格主题/表头/对齐…）都按**同一条链**取值，高 → 低：

| 层级 | 来源 | 作用范围 | 例子 |
| :-- | :-- | :-- | :-- |
| 1. **块属性** | `fill.md` 里该块的 `{...}` | 只影响这一块 | ` ```c {mode=card line=false} `、`![图](a.png){align=left}`、表格下一行 `{theme=grid}` |
| 2. **使用者** | 命令行参数 > `--extra` > 配置文件 | 整次渲染 | `--code-mode card`、`--extra "table.theme=grid"`、`hustreport.config.json` |
| 3. **模板** | `template.json` 中匹配的规则（AI / 推断产出） | 模板默认决策 | `{"match":{"type":"code"},"style":{"anchor":"hrseg0040"}}` |
| 4. **内置默认** | 代码里的 `BUILTIN_DEFAULTS` | 兜底 | 卡片主题 `default`、表格 `academic`、图片居中 `max` |

一句话原则：**越具体、越接近使用者的设置越优先；AI 的决策永远可以被你覆盖，而且不需要改 `template.json`。**

几个具体推论：

- **代码块模式**（`native` 原生段落 / `card` 行号卡片）：
  1. 块属性：`{mode=native|card}`；写了 `line` / `lineNumbers` / `border` / `theme` 视同要求卡片；
  2. 使用者：`--code-mode` 或配置 `code.mode`（`auto` = 不表态）；
  3. 模板：规则给了 `theme` → 卡片；规则绑定了原生代码样式 → 原生；
  4. 默认：卡片。要求原生但模板没有原生样式时，回退卡片并在 `--trace` 里注明。
- **代码卡片字体**（西文 `fontFamily` / 中文 `fontEastAsia` / 字号 `fontSize`）：块属性与使用者配置 > 模板规则显式写的 `options.fontFamily`（字符串，或 AI 常用的 `{ "ascii": "Consolas", "eastAsia": "仿宋" }` 对象）/`options.fontEastAsia`/`options.fontSize` > **复制文档正文样式**（中文取 eastAsia、西文取 ascii）> 主题默认。无法识别的取值（如数字）不会静默忽略，而是在渲染警告里指出。
- **行内代码**：`inlineCode` 规则若绑定文档里的真实样式则整体套用；若是 `inline` 样式（AI 常见），其中的字体/字号/颜色会叠加到代码 run 上，嵌在 `**…**` 里的行内代码同样生效。
- **`--code-template` 只换卡片配色，不再改变模式**。旧版本里它会静默把 AI 选好的原生代码样式换成卡片——现在要卡片请显式 `--code-mode card`。
- **表格样板**：模板规则的 `options.styleAnchor`（克隆文档里已有的表）属于“模板层的主题”；只要块或使用者指定了 `theme`，就改用该主题。
- **图注样式**：块属性 `captionStyle` / 配置 `image.captionStyle`（可写锚点、配方名或样式名）> 模板规则的 `captionRef` / `captionStyle` > profile 的 `caption` 规则。
- **配置文件只存“使用者层”**：内置默认值不会混进配置对象，所以“没写”永远等于“交给模板决定”，不会被默认值冒充成你的设置。

想确认某个块最终用了什么、来自哪一层：`render --dry-run --trace`（或 `--json` 里的 `trace`）。

---

## 核心特性与工作流

### 1. 结构分析与稳定定位（Part 1 · analyze）

- **段落与 Run 切分**：段落内样式相同的连续 run 会自动合并，跨段不合并，保证切分粒度贴合排版实际。
- **稳定 Ref（基于 `w14:paraId`）**：形如 `body#0/p@4E2EFCDF/s1`。基于 Word 的持久段落哈希 ID 定位，用户在 Word 中改写文本内容后重新分析，ref 依然保持稳定。
- **媒体文件抽象**：文档中的图片不以二进制写入 CSV，而是分配 `img_0001` 等 handle，并将图片格式、尺寸、关联关系输出到 `media.csv`。
- **批注（Comments）关联**：自动提取文档中的所有批注文本、作者及对应的正文锚定范围，为后续规范化提供上下文。
- **表格样式识别**：提取每张表的表级样式（`tblStyle`、边框、列宽、单元格边距、跨页表头）与单元格字体/字号/对齐，写入 `template.json.tables` 并提供给 AI；渲染时可通过 `table` 规则的 `options.styleAnchor` 复用已有表格样式。
- **样式角色识别（含图注）**：在 `styleSchema` 中为样式标注 `role`（`heading` / `caption` / `code` / `body`）。图注/表注样式是**可选**配置——识别到就生成 `styles.caption` 与 `caption` 规则（或由 AI 通过 `options.captionRef` 绑定）；文档未提供时留空，渲染器自动使用默认图注格式（居中、黑体五号）。

### 2. AI 驱动的模板提炼（Part 2 · ai-template）

`ai-template` 解决传统 Word 模板“既要删掉引导要求，又要保留既定标题与格式”的痛点：

- **无侵入持久锚点**：在模板中埋入标准 OOXML 隐藏书签（`hrseg0001`、`hrseg0002`...），Word/WPS 均完整兼容。
- **语义化底板规范（`edits`）**：
  - AI 审查每个段落：引导提示语（如“请在此填写实验原理…”）、示范占位符（“×××”）、示范参考文献整段删除；
  - 封面、既定实验题目、要求、固定表格等予以完整保留；
  - 支持删除指导性批注（气泡与内容彻底清除）：
    ```jsonc
    { "op": "delete", "target": "comment", "id": "0" }   // 精确删除某条批注
    { "op": "delete", "target": "comments" }             // 删除底板中的所有批注
    { "op": "delete", "target": "table", "ref": "hrsegXXXX" } // 删除整张表格（ref 可为表内任一锚点）
    ```
  - 表格单元格内的段落锚点会在锚点表中标注 `[表格内]`；若示范表格内容被删空，空表格框架会被自动移除。
- **标题级别与样式校准**：
  - AI 会审查样式的 `ooxmlStyleId` 与大纲级别；
  - 一级标题必须优先绑定 `Heading1`，二级标题绑定 `Heading2`，避免 Word/WPS 在更新目录时因错误的手工居中或级别错乱导致目录缩进异常。
- **缺失样式诊断与用户反馈（`feedback`）**：
  - 若要求明确（如批注写了“图注居中黑体五号”）但文档里没有现成样本，AI 会**直接用 inline 样式按要求组装**并写进规则，在 `feedback.notes` 中说明；只有要求不明确、无法可靠组装时，才通过 `feedback.missingStyles` 请你在文档中补写一行样本后重跑。AI 不会引用文档里不存在的样式 ID。
- **TOC 目录结构识别与重建**：
  - 自动识别文档原有的目录大纲级别（`maxLevel`）与目录样式（`TOC1`、`TOC2`）；
  - 支持两种底板：SDT 域式目录与手工目录，均重建为可「更新目录」的 `TOC` 域（手工目录同样包一层域）；
  - 渲染时为各级标题写入 `w:outlineLvl`，即使原文档标题缺少规范样式也能被 TOC 域正确收录。

### 3. 保格式渲染引擎（Part 3 · render）

#### 填字稿语法（`fill.md`）

```md
---
profile: default
---

[张三](ref:hrseg0024)                                    # 原地填空（保留原 run 样式）
[计算机科学与技术](ref:hrseg0018 | padding=cover)          # 同组补齐到等宽
[U202612345](ref:hrseg0022 | padding=cover align=center) # 组内居中
[报告正文内容](ref:hrseg0092 | use:body)                   # 指定配方覆盖原有格式

# 实验一 指针与数组综合设计 {ref:hrseg0001}                # 标题锚定（可修改标题文字）

## 1.1 调试与分析                                         # 插入二级标题（自动沿用 Heading2 规则）

正文段落会按顺序排版插入。

```c {line=true border=true}
#include <stdio.h>
int main() {
    printf("Hello HUST!\n");
    return 0;
}
```

![系统架构图](images/arch.png){center max}(captionStyle=caption)

| 模块名 | 状态 | 耗时 |
| :--- | :---: | ---: |
| 内存池 | 正常 | 2ms |
| 调度器 | 正常 | 15ms |
{theme=academic header=true}
```

#### 渲染能力特性

1. **标题插入与目录（TOC）更新**：
   - **标题重命名**：Markdown 中带有 `{ref:hrsegXXXX}` 的标题，如果文字与原模板不同，引擎会自动就地改写，不会产生重复段落。
   - **中间插题与尾插题**：用户可在任意章节之间插入新的一级或多级标题，引擎根据当前作用域自动维护大纲层级与样式。
   - **TOC 目录同步更新**：自动扫描渲染后的各级标题，在文档目录区域生成超链接与页码域，同时注入带点导线的 `TOC1` / `TOC2` 制表位样式。
   - 只有模板含目录时才会给标题插入 `_Toc_hr_*` 书签；无目录的文档保持干净。
     > ⚠️ **务必手动刷新一次**：生成后请在 Word / WPS 中右键目录选择「更新域 / 更新目录」（或选中目录按 `F9`），否则目录页码可能仍是占位值。模板已注入 `w:updateFields=true`，Word/WPS 打开时也会提示自动更新。
2. **代码块排版与高亮**：
   - **模式 A（原生段落模式）**：若模板原文档已定义代码样式，直接沿用原文档的行距、字体与边距，同时对代码 Token 着色（`lint`，可用块属性 `{lint=false}` 或配置 `code.lint` 关闭）；
   - **模式 B（精美卡片表格）**：若无原生样式，默认渲染为 CodeInWord 风格的双列卡片（左侧行号栏，右侧语法高亮代码，支持背景与边框定制）；
   - 两种模式如何选择见 [覆盖准则](#覆盖准则谁说了算)；
   - **块级属性可覆盖模板决策**（写在围栏信息串的花括号里，逗号/空格分隔，`key=value` 或 `key: value` 均可）：
     | 属性 | 取值 | 作用 |
     | :-- | :-- | :-- |
     | `theme` / `template` | `default`/`classic`/`eclipse`/`dark`/CSS 路径 | 指定该块的高亮主题 |
     | `line` / `lineNumbers` | `true`/`false` | 显示或隐藏左侧行号栏 |
     | `border` | `true`/`false` | 显示或去掉卡片外边框 |
     | `mode` | `card`/`native` | 强制该块使用卡片模式 / 原生段落模式 |
   - 只要写了 `line`、`border`、`theme` 或 `mode=card`，该块就**强制走卡片模式**，可用来覆盖 AI 在模板里选定的原生代码样式；例如即便 AI 选了"不要行号"，仍可写：

     ````markdown
     ```c {border=true, line=true}
     int main() { return 0; }
     ```
     ````

     反过来 `{mode=native}` 可把某一块拉回原生段落样式。`line=false`、`border=false` 则分别去掉行号栏与外边框。
   - 支持多种预置高亮主题（`default`、`classic`、`eclipse`、`dark`）或自定义 CSS。
3. **图片自适应排版**：
   - 自动探测 PNG/JPEG/GIF 宽高比；
   - 支持 `{center max}`、`{width=300pt}`、`{align=left}` 等控制属性；
   - 支持图注样式自动绑定与居中居左对齐；
   - **缺图不中断**：图片文件不存在时插入红色占位文字「【缺图：路径】图注」并给出警告，结束时汇总缺图清单，补上文件后重新渲染即可（`--strict` 下改为报错）。
4. **表格渲染**：
   - 支持标准 Markdown 表格与对齐方式（居左、居中、居右）；
   - 内置多种专业主题：`academic`（学术三线表，默认）、`grid`（标准全网格）、`striped`（斑马纹）、`clean`（极简无竖线）；
   - 支持首行表头自动加粗与重复跨页标题属性；
   - 单元格支持行内 Markdown：`` `代码` ``（等宽字体）、`**粗**`、`*斜*`、`~~删除~~`。
5. **批注与锚点清理**：
   - 渲染完成时，自动剥离所有的临时隐藏书签锚点；
   - 默认彻底清除批注 DOM、引用的空 run 以及包内冗余 XML 文件；
   - 如需保留底板中的评阅批注，可指定 `--keep-comments`。

---

## 配置项参考（`hustreport.config.json`）

查找规则与 AI 段见 [配置文件](#配置文件一份就够)；各项在覆盖链中属于“使用者层”（见 [覆盖准则](#覆盖准则谁说了算)）。以下注释里的值即内置默认：

```jsonc
{
  "openai": {
    "baseURL": "https://api.deepseek.com/v1",
    "apiKey": "sk-xxxx",
    "model": "deepseek-chat"
  },
  "code": {
    "mode": "auto",                 // auto | native | card
    "template": "default",          // 卡片模式高亮主题：default | classic | eclipse | dark | CSS 路径
    "fontFamily": "Consolas",       // 卡片字体（"inherit" 跟随模板代码/正文字体）
    "fontSize": "9.5pt",            // 卡片字号（半磅数值、"10pt" 或 "inherit"）
    "lineNumbers": true,            // 卡片是否显示行号
    "border": true,                 // 卡片是否画外边框
    "lint": true,                   // 原生段落模式是否语法着色
    "tabSize": 4                    // Tab 展开空格数
  },
  "image": {
    "align": "center",              // 图片默认对齐
    "size": "max",                  // 默认宽度匹配版心
    "maxWidth": 430,                // 版心宽度（pt）
    "captionAlign": "center",
    "captionStyle": "caption"       // 可写锚点 / 配方名 / 样式名；不写则用模板规则
  },
  "table": {
    "theme": "academic",            // academic | grid | striped | clean
    "header": true,                 // 首行作为表头
    "align": "center"
  }
}
```

`--extra` 覆盖配置文件（支持 JSON 或 `key=val` 扁平语法，例如 `--extra "code.lineNumbers=false, table.theme=grid"`），命令行专用参数（`--code-mode`、`--code-template`）再覆盖 `--extra`。

---

## 脚本与 Agent 集成

hustreport 的中间产物（`template.json`、`skeleton.md`、CSV）都是可 grep/解析的文件，渲染是确定性的；以下能力让脚本/Agent 不必解析人读文本或 XML：

- **`--json`**：每个命令在 stdout 输出一个 JSON 对象（`{"ok": true, ...}` / `{"ok": false, "error": "..."}`），进度与日志走 stderr。`render` 的结果包括：
  - `stats`：`filled`（填空）、`blocks`（插入块）、`elements`、`headings` / `paragraphs` / `lists` / `tables` / `images`、`codeNative` / `codeCard`、`missingImages`、`skipped`；
  - `trace`：逐块记录 `{ index, type, text, ref, status, mode, theme, style, elements, note }`，`status` ∈ `inserted | updated | fill | placeholder | skipped`，`style` 形如 `anchor:hrseg0012` / `recipe:body` / `inline`；
  - `warnings`、`filledRefs`、`configSource`、`hasToc`。
- **`--dry-run`**：完整跑一遍渲染但不写文件——用来增量改 `fill.md` 后快速自检。
- **`--strict`**：把“能降级的问题”变成硬错误（非零退出码且不写成稿），适合 CI / Agent 的验收步骤。
- **AI 复盘**：`ai-template` 总会落盘 `ai-prompt.md`（发给模型的完整消息）与 `ai-response.txt`（原始输出）；调整合并逻辑或手改输出后，用 `--from-response <outDir>/ai-response.txt` 重新生成模板，不再调用模型。

典型闭环：

```bash
hustreport ai-template 任务书.docx --out-dir tpl --json          # 读 feedback / warnings
cp tpl/skeleton.md tpl/fill.md && $EDITOR tpl/fill.md
hustreport render tpl/template.docx --info tpl/template.json --md tpl/fill.md --dry-run --json   # 看 stats / trace
hustreport render tpl/template.docx --info tpl/template.json --md tpl/fill.md --out-file final.docx --strict
```

---

## API 调用示例

```ts
import {
  analyzeDocx,
  createTemplate,
  buildTemplateWithAi,
  chatCompletion,
  renderTemplateFile,
  resolveChatConfig,
} from "hustreport";

// 1. 文档分析
const { doc, analysis } = await analyzeDocx("./实验任务书.docx");

// 2. AI 模板生成
const aiResult = await buildTemplateWithAi({
  input: "./实验任务书.docx",
  outDir: "./tpl",
  task: "生成计算机网络实验报告模板",
  chat: chatCompletion(resolveChatConfig()), // 或 rawResponse: 已保存的 ai-response.txt 内容
});

// 3. 填字与渲染成稿
const result = await renderTemplateFile(
  "./tpl/template.docx",
  "./tpl/template.json",
  "./tpl/fill.md",
  "./final.docx",
  {
    codeMode: "auto",     // 使用者层设置，同 --code-mode
    stripComments: true,  // 渲染完成自动清理批注
  }
);
// result.stats / result.trace / result.warnings 同 --json 输出
```

---

## 使用边界与人工审核

hustreport 负责的是**排版与格式复用**，不负责内容正确性。产出 `final.docx` 后，请至少核对：

- **目录（最重要）**：**若文档含目录，请在 Word / WPS 中点击「更新目录 / 更新域」（选中目录按 `F9`）刷新页码与条目**；确认目录条目完整（含骨架未提及的章标题）、页码正确。
- **内容与结构**：AI 规范化删除的内容是否合理（客观题目 / 要求是否被误删），章节标题层级是否正确；
- **封面字段**：姓名 / 学号 / 班级 / 日期等是否齐全，`padding=cover` 的下划线是否对齐；
- **图表与公式**：是否还有「【缺图：…】」占位（渲染输出的缺图清单）、图注/表注编号与样式、表格主题是否符合要求；
- **代码块**：字体是否等宽、字号与行距是否达到要求；
- **页眉页脚与批注**：临时锚点与批注气泡是否已按预期清除（默认清除）；
- **源文档缺陷**：AI 在 `feedback` 中提示的源文档问题（如标题样式错标）是否已在 Word 中修正。

> 一句话：**它把「跟 Word 格式搏斗」自动化了，但「这份报告是否符合要求」仍需你自己确认一次；目录尤其记得手动更新一次。**

---

## 测试与质量保障

项目配备了完整的自动化单元测试与类型检查套件：

```bash
pnpm typecheck   # TypeScript 类型全量检查
pnpm test        # 执行所有单元测试（110 用例全部通过）
```

测试覆盖了覆盖准则与配置回溯、切分分析、CSV 转义、样式配方推断、AI 校验与沙盒、Markdown 填字语法、标题粘连拆分与自动目录、代码高亮、三线表格、图片尺寸探测以及批注剥离。
