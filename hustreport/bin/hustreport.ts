#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeDocx,
  applyEdits,
  buildTemplateWithAi,
  chatCompletion,
  createTemplate,
  formatMediaCsv,
  formatSegmentsCsv,
  openDocx,
  renderTemplateFile,
  type ChatConfig,
  type EditPlan,
  type TextEdit,
} from "../index.ts";

interface CliOptions {
  command: string;
  file?: string;
  outDir?: string;
  outFile?: string;
  parts?: string[];
  includeEmpty: boolean;
  toStdout: boolean;
  editsFile?: string;
  sets: string[];
  infoFile?: string;
  mdFile?: string;
  task?: string;
  systemPromptFile?: string;
  extra?: string;
  preset?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: argv[0] ?? "help",
    includeEmpty: false,
    toStdout: false,
    sets: [],
  };
  const rest = argv.slice(1);

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case "--out":
      case "-o":
        options.outDir = rest[++i];
        options.outFile = options.outDir;
        break;
      case "--edits":
      case "-e":
        options.editsFile = rest[++i];
        break;
      case "--info":
        options.infoFile = rest[++i];
        break;
      case "--md":
        options.mdFile = rest[++i];
        break;
      case "--task":
        options.task = rest[++i];
        break;
      case "--system-prompt":
        options.systemPromptFile = rest[++i];
        break;
      case "--preset":
        options.preset = rest[++i];
        break;
      case "--extra":
        options.extra = rest[++i];
        break;
      case "--set":
        options.sets.push(rest[++i]);
        break;
      case "--parts":
        options.parts = rest[++i]?.split(",").map((part) => part.trim()).filter(Boolean);
        break;
      case "--include-empty":
        options.includeEmpty = true;
        break;
      case "--stdout":
        options.toStdout = true;
        break;
      default:
        if (!arg.startsWith("-") && !options.file) options.file = arg;
    }
  }
  return options;
}

function usage(): void {
  console.log(`hustreport —— docx 样式分段 / CSV 导出 / 无损写入

用法：
  hustreport analyze  <file.docx> [--out <dir>] [--parts body,header] [--include-empty] [--stdout]
  hustreport edit     <file.docx> --out <out.docx> (--edits <edits.json> | --set <ref>=<text> ...)
  hustreport template <file.docx> [--out <dir>]      # 生成 template.docx + template.json（无 AI）
  hustreport ai-template <file.docx> [--out <dir>] [--task "说明"] [--preset generic|labReport] [--system-prompt prompt.md] [--extra "附加要求"]
      # AI 生成 template + skeleton.md；--preset 选内置策略，--system-prompt 完全替换
  hustreport render   <template.docx> --info <template.json> --md <fill.md> --out <out.docx>

edits.json 形状（数组等价于 { "set": [...] }）：
  {
    "set":    [ { "ref": "body#0/p@AAAA/s1", "text": "计算机科学与技术" } ],
    "insert": [ { "ref": "body#0/p@AAAA/s0", "text": "六、参考文献", "useStyleId": 26, "as": "paragraph", "position": "after" } ],
    "delete": [ { "ref": "body#0/p@BBBB/s0", "as": "run" } ]
  }

说明：
  analyze  解析 docx，输出 segments.csv / media.csv / styles.json / analysis.json
  edit     按 ref 改写/插入/删除，插入只复用已有 XML Style ID，不新建样式
`);
}

async function loadChatConfig(): Promise<ChatConfig> {
  let raw: { openai?: Partial<ChatConfig>; ai?: Partial<ChatConfig> } = {};
  try {
    raw = JSON.parse(await readFile(path.resolve(process.cwd(), "config.json"), "utf-8"));
  } catch {
    // 没有 config.json 就只看环境变量
  }
  const ai = raw.openai ?? raw.ai ?? {};
  const baseURL = process.env.HUST_AI_BASE_URL ?? ai.baseURL;
  const apiKey = process.env.HUST_AI_API_KEY ?? ai.apiKey;
  const model = process.env.HUST_AI_MODEL ?? ai.model;
  const maxTokens = Number(process.env.HUST_AI_MAX_TOKENS ?? ai.maxTokens ?? 0);
  if (!baseURL || !apiKey || !model) {
    throw new Error("缺少 AI 配置：请在 config.json 的 openai 段或环境变量 HUST_AI_BASE_URL / HUST_AI_API_KEY / HUST_AI_MODEL 中提供");
  }
  return { baseURL, apiKey, model, ...(maxTokens > 0 ? { maxTokens } : {}) };
}

async function readPlan(options: CliOptions): Promise<EditPlan> {
  const set: TextEdit[] = [];
  let plan: EditPlan = {};
  if (options.editsFile) {
    const raw = JSON.parse(await readFile(options.editsFile, "utf-8")) as EditPlan | TextEdit[] | { edits: TextEdit[] };
    if (Array.isArray(raw)) plan = { set: raw };
    else if (Array.isArray((raw as { edits?: TextEdit[] }).edits)) plan = { set: (raw as { edits: TextEdit[] }).edits };
    else plan = raw as EditPlan;
  }
  for (const entry of options.sets) {
    const separator = entry.indexOf("=");
    if (separator < 0) throw new Error(`--set 需要 <ref>=<text> 形式，收到：${entry}`);
    set.push({ ref: entry.slice(0, separator), text: entry.slice(separator + 1) });
  }
  if (set.length > 0) plan = { ...plan, set: [...(plan.set ?? []), ...set] };
  return plan;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const commands = new Set(["analyze", "edit", "template", "ai-template", "render"]);
  if (!options.file || !commands.has(options.command)) {
    usage();
    process.exitCode = options.command === "help" ? 0 : 1;
    return;
  }

  if (options.command === "ai-template") {
    const outDir = options.outDir ?? path.join(process.cwd(), "report-template");
    const config = await loadChatConfig();
    const systemPrompt = options.systemPromptFile ? await readFile(options.systemPromptFile, "utf-8") : undefined;
    const result = await buildTemplateWithAi({
      input: options.file,
      outDir,
      task: options.task,
      preset: options.preset as "generic" | "labReport" | undefined,
      systemPrompt,
      extraInstructions: options.extra,
      chat: chatCompletion(config),
    });
    console.log(`已生成：${result.templatePath}`);
    console.log(`模板信息：${result.infoPath}（规则 ${result.info.profiles[result.info.defaultProfile]?.rules.length ?? 0} 条）`);
    console.log(`填字稿：${result.skeletonPath}`);
    for (const warning of result.warnings) console.log(`  警告: ${warning}`);
    return;
  }

  if (options.command === "render") {
    if (!options.infoFile || !options.mdFile) throw new Error("render 需要 --info <template.json> 与 --md <fill.md>");
    const outFile = options.outFile ?? path.join(process.cwd(), "report-rendered.docx");
    const result = await renderTemplateFile(options.file, options.infoFile, options.mdFile, outFile);
    console.log(`已渲染 ${result.filled} 处（profile=${result.profile}）-> ${outFile}`);
    for (const warning of result.warnings) console.log(`  警告: ${warning}`);
    return;
  }

  if (options.command === "template") {
    const outDir = options.outDir ?? path.join(process.cwd(), "report-template");
    await mkdir(outDir, { recursive: true });
    const templatePath = path.join(outDir, "template.docx");
    const infoPath = path.join(outDir, "template.json");
    const info = await createTemplate(options.file, templatePath, infoPath, { source: options.file });
    console.log(`已生成模板：${templatePath}`);
    const defaultProfile = info.profiles[info.defaultProfile];
    console.log(
      `锚点 ${Object.keys(info.anchors).length} 个 / profile ${Object.keys(info.profiles).join(",")}` +
        `（默认 ${info.defaultProfile}：配方 ${Object.keys(defaultProfile?.styles ?? {}).join(",") || "无"}，规则 ${defaultProfile?.rules.length ?? 0} 条）`,
    );
    console.log(`模板信息：${infoPath}`);
    return;
  }

  if (options.command === "analyze") {
    const { analysis } = await analyzeDocx(options.file, {
      partTypes: options.parts,
      includeEmptyParagraphs: options.includeEmpty,
    });

    if (options.toStdout) {
      process.stdout.write(formatSegmentsCsv(analysis.segments));
      return;
    }

    const outDir = options.outDir ?? path.join(process.cwd(), "report-out");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "segments.csv"), formatSegmentsCsv(analysis.segments), "utf-8");
    await writeFile(path.join(outDir, "media.csv"), formatMediaCsv(analysis.media), "utf-8");
    await writeFile(path.join(outDir, "styles.json"), JSON.stringify(analysis.styles, null, 2), "utf-8");
    await writeFile(path.join(outDir, "analysis.json"), JSON.stringify(analysis, null, 2), "utf-8");

    console.log(
      `已分析 ${options.file}：${analysis.meta.segmentCount} 个 segment / ${analysis.meta.styleCount} 种样式 / ${analysis.media.length} 个媒体`,
    );
    console.log(`输出目录：${outDir}`);
    return;
  }

  // edit
  const plan = await readPlan(options);
  const total = (plan.set?.length ?? 0) + (plan.insert?.length ?? 0) + (plan.delete?.length ?? 0);
  if (total === 0) throw new Error("没有可用的编辑，请用 --edits 或 --set 指定");
  const outFile = options.outFile ?? path.join(process.cwd(), "report-edited.docx");

  const doc = await openDocx(options.file);
  const result = applyEdits(doc, plan);
  await doc.saveAs(outFile);

  console.log(`改写 ${result.applied} 处 / 插入 ${result.inserted} 处 / 删除 ${result.deleted} 处，输出：${outFile}`);
  for (const edit of result.edits) {
    console.log(`  [set] ${edit.ref} (index=${edit.index}, style=${edit.styleId}) : ${JSON.stringify(edit.before)} -> ${JSON.stringify(edit.after)}`);
  }
  for (const insert of result.inserts) {
    console.log(`  [insert] ${insert.as} style=${insert.styleId} ${insert.position} ${insert.anchorRef} : ${JSON.stringify(insert.text)}`);
  }
  for (const deleted of result.deletes) {
    console.log(`  [delete] ${deleted.as} ${deleted.ref} : ${JSON.stringify(deleted.text)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
