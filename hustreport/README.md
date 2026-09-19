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
  --info ./tpl/template.json --md ./tpl/fill.md --out ./final.docx \
  --code-template default
```

### AI 模型配置（环境变量或 `config.json`）

系统优先读取环境变量，未提供时读取当前工作目录下的 `config.json`（`openai` 或 `ai` 段）：

```bash
export HUST_AI_BASE_URL=https://api.deepseek.com/v1
export HUST_AI_API_KEY=sk-xxxx
export HUST_AI_MODEL=deepseek-chat
export HUST_AI_MAX_TOKENS=32768      # 建议设置较大预算以生成完整 skeleton
```

或 `config.json`：
```json
{
  "openai": {
    "baseURL": "https://api.deepseek.com/v1",
    "apiKey": "sk-xxxx",
    "model": "deepseek-chat"
  }
}
```

---

## CLI 命令一览

| 命令 | 常用参数 | 作用 |
| :-- | :-- | :-- |
| `analyze <docx>` | `--out <dir>`<br>`--parts body,header`<br>`--include-empty`<br>`--stdout` | 深度分析 docx：按段落/run样式切分，输出 `segments.csv`、`media.csv`、`styles.json` 与 `analysis.json`。 |
| `template <docx>` | `--out <dir>` | 纯规则打底：注入持久隐藏书签锚点（`hrsegXXXX`），推断默认样式与规则，产出 `template.docx` 与 `template.json`。 |
| `ai-template <docx>` | `--out <dir>`<br>`--task <str>`<br>`--preset generic\|labReport`<br>`--system-prompt <file>`<br>`--extra <str>`<br>`--max-anchors <n>` | 结合 AI 审查文档：分析样式表与批注要求，执行语义级删除/清理（`edits`），校准标题样式大纲，配置目录（TOC），给出缺失样式反馈并产出 `skeleton.md`。超大文档可用 `--max-anchors` 截断喂给 AI 的锚点数量。 |
| `render <template.docx>` | `--info <template.json>`<br>`--md <fill.md>`<br>`--out <final.docx>`<br>`--config <config.json>`<br>`--code-template <name>`<br>`--keep-comments` | 将 Markdown 渲染填入模板：支持就地填空、追加/插入标题与段落、代码块语法着色、图片自适应排版、表格绘制，并自动同步更新目录与清理批注。 |
| `edit <docx>` | `--out <out.docx>`<br>`--edits <edits.json>`<br>`--set <ref>=<text>` | 针对 docx 进行精确的底层批处理改写、插入或删除（仅复用已有样式 ID，不污染 `styles.xml`）。 |

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
  - 若文档批注或规范中提出了格式要求（如“代码块要求 Consolas 小五号”），但在文档已出现样式中未检测到样本文本，AI **绝不凭空捏造未知样式**，而是通过 `feedback.missingStyles` 给出明确的操作建议，提示用户在文档中补写一行样本。
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

```c
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
     > ⚠️ **务必手动刷新一次**：生成后请在 Word / WPS 中右键目录选择「更新域 / 更新目录」（或选中目录按 `F9`），否则目录页码可能仍是占位值。模板已注入 `w:updateFields=true`，Word/WPS 打开时也会提示自动更新。
2. **代码块排版与高亮**：
   - **模式 A（原生段落模式）**：若模板原文档已定义代码样式，开启 `lint: true` 可直接沿用原文档的行距、字体与边距，同时对代码 Token 进行着色；
   - **模式 B（精美卡片表格）**：若无原生样式，默认渲染为 CodeInWord 风格的双列卡片（左侧行号栏，右侧语法高亮代码，支持背景与边框定制）；
   - 支持多种预置高亮主题（`default`、`classic`、`eclipse`、`dark`）或自定义 CSS。
3. **图片自适应排版**：
   - 自动探测 PNG/JPEG/GIF 宽高比；
   - 支持 `{center max}`、`{width=300pt}`、`{align=left}` 等控制属性；
   - 支持图注样式自动绑定与居中居左对齐。
4. **表格渲染**：
   - 支持标准 Markdown 表格与对齐方式（居左、居中、居右）；
   - 内置多种专业主题：`academic`（学术三线表，默认）、`grid`（标准全网格）、`striped`（斑马纹）、`clean`（极简无竖线）；
   - 支持首行表头自动加粗与重复跨页标题属性。
5. **批注与锚点清理**：
   - 渲染完成时，自动剥离所有的临时隐藏书签锚点；
   - 默认彻底清除批注 DOM、引用的空 run 以及包内冗余 XML 文件；
   - 如需保留底板中的评阅批注，可指定 `--keep-comments`。

---

## 配置文件（`config.json`）

可在项目根目录放置 `config.json` 或在命令行通过 `-c / --config` 传入：

```jsonc
{
  "openai": {
    "baseURL": "https://api.deepseek.com/v1",
    "apiKey": "sk-xxxx",
    "model": "deepseek-chat"
  },
  "code": {
    "template": "default",          // 高亮主题
    "fontFamily": "Consolas",       // 代码字体
    "fontSize": "9.5pt",            // 字号
    "lineNumbers": true,            // 是否显示行号
    "tabSize": 4                    // Tab 展开空格数
  },
  "image": {
    "align": "center",              // 图片默认对齐
    "size": "max",                  // 默认宽度匹配版心
    "maxWidth": 430                 // 版心宽度（pt）
  },
  "table": {
    "theme": "academic",            // 表格主题：academic | grid | striped | clean
    "header": true                  // 首行作为表头
  }
}
```

命令行参数 `--extra` 也支持覆盖上述配置（支持 JSON 语法或 `key=val` 扁平语法，例如 `--extra "code.lineNumbers=false"`）。

---

## API 调用示例

```ts
import {
  analyzeDocx,
  createTemplate,
  buildTemplateWithAi,
  renderTemplateFile,
  stripDocumentComments,
} from "hustreport";

// 1. 文档分析
const { doc, analysis } = await analyzeDocx("./实验任务书.docx");

// 2. AI 模板生成
const aiResult = await buildTemplateWithAi({
  input: "./实验任务书.docx",
  outDir: "./tpl",
  task: "生成计算机网络实验报告模板",
});

// 3. 填字与渲染成稿
await renderTemplateFile(
  "./tpl/template.docx",
  "./tpl/template.json",
  "./tpl/fill.md",
  "./final.docx",
  {
    codeTemplate: "default",
    stripComments: true, // 渲染完成自动清理批注
  }
);
```

---

## 使用边界与人工审核

hustreport 负责的是**排版与格式复用**，不负责内容正确性。产出 `final.docx` 后，请至少核对：

- **目录（最重要）**：**若文档含目录，请在 Word / WPS 中点击「更新目录 / 更新域」（选中目录按 `F9`）刷新页码与条目**；确认目录条目完整（含骨架未提及的章标题）、页码正确。
- **内容与结构**：AI 规范化删除的内容是否合理（客观题目 / 要求是否被误删），章节标题层级是否正确；
- **封面字段**：姓名 / 学号 / 班级 / 日期等是否齐全，`padding=cover` 的下划线是否对齐；
- **图表与公式**：图片文件是否存在、图注/表注编号与样式、表格主题是否符合要求；
- **代码块**：字体是否等宽、字号与行距是否达到要求；
- **页眉页脚与批注**：临时锚点与批注气泡是否已按预期清除（默认清除）；
- **源文档缺陷**：AI 在 `feedback` 中提示的源文档问题（如标题样式错标）是否已在 Word 中修正。

> 一句话：**它把「跟 Word 格式搏斗」自动化了，但「这份报告是否符合要求」仍需你自己确认一次；目录尤其记得手动更新一次。**

---

## 测试与质量保障

项目配备了完整的自动化单元测试与类型检查套件：

```bash
pnpm typecheck   # TypeScript 类型全量检查
pnpm test        # 执行所有单元测试（86 用例全部通过）
```

测试覆盖了切分分析、CSV 转义、样式配方推断、AI 校验与沙盒、Markdown 填字语法、标题粘连拆分与自动目录、代码高亮、三线表格、图片尺寸探测以及批注剥离。
