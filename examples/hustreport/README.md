# hustreport 示例：C 语言程序设计实验报告

本目录包含使用 `hustreport` 自动化生成并渲染实验报告的完整产物套件。

> ⚠️ **声明**：
> 本示例中的学生姓名（李四）、学号（U202412345）、专业班级及指导教师等身份信息均为**虚构脱敏示例**。文档底板来源于华中科技大学公开课程教学大纲与实验模版。

---

## 包含文件清单

| 文件 | 说明 |
| :--- | :--- |
| `template.docx` | 注入了持久化隐藏书签（锚点 `hrsegXXXX`）的 Word 底板模板 |
| `template.json` | 经 AI 提取的样式映射规则（rules）、锚点元数据（anchors）与排版建议 |
| `skeleton.md` | 由 AI 根据文档结构生成的填空骨架（作者只需在此基础上填写内容） |
| `fill.md` | 填入实际实验内容（代码、算法分析、图表等）的完整 Markdown 文档 |
| `final.docx` | 最终通过 `hustreport render` 渲染输出的成稿报告 |

---

## 复现与运行命令

在项目根目录下执行以下命令：

```bash
# 1. 重新根据 fill.md 渲染生成 final.docx
node hustreport/bin/hustreport.ts render examples/hustreport/template.docx \
  --info examples/hustreport/template.json \
  --md examples/hustreport/fill.md \
  --out examples/hustreport/final.docx
```

如需使用 AI 重新从原始 Word 文档提取模板并生成骨架：

```bash
# 2. 配置 AI 环境变量（OpenAI 兼容端点，如本地 vLLM、DeepSeek 等）
export HUST_AI_BASE_URL="http://127.0.0.1:1145/v1"
export HUST_AI_API_KEY="sk-xxxx"
export HUST_AI_MODEL="deepseek/deepseek-flash"

# 3. 执行 AI 模板生成
node hustreport/bin/hustreport.ts ai-template your_report.docx \
  --out ./output_dir \
  --task "生成《C语言程序设计实验》报告模板"
```
