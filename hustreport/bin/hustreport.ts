#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
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
  formatStylesCsv,
  openDocx,
  parseSpaceAction,
  renderTemplateFile,
  resolveChatConfig,
  type ChatFn,
  type EditPlan,
  type RenderResult,
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
  configFile?: string;
  codeTemplate?: string;
  keepComments?: boolean;
  maxAnchors?: number;
  codeMode?: "auto" | "native" | "card";
  cjkSpacing?: string;
  lspace?: string;
  rspace?: string;
  strict: boolean;
  dryRun: boolean;
  json: boolean;
  trace: boolean;
  appendUnanchored: boolean;
  fromResponse?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: argv[0] ?? "help",
    includeEmpty: false,
    toStdout: false,
    sets: [],
    strict: false,
    dryRun: false,
    json: false,
    trace: false,
    appendUnanchored: false,
  };
  const rest = argv.slice(1);

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case "--out":
      case "-o":
        // 兼容写法：analyze/template/ai-template 视为目录，edit/render 视为文件（见 normalizeOut）
        options.outDir = rest[++i];
        options.outFile = options.outDir;
        break;
      case "--out-dir":
        options.outDir = rest[++i];
        break;
      case "--out-file":
        options.outFile = rest[++i];
        break;
      case "--code-mode": {
        const mode = rest[++i];
        if (mode !== "auto" && mode !== "native" && mode !== "card") {
          throw new Error(`--code-mode 只接受 auto | native | card，收到：${mode}`);
        }
        options.codeMode = mode;
        break;
      }
      case "--cjk-spacing":
        options.cjkSpacing = rest[++i];
        parseSpaceAction(options.cjkSpacing, "--cjk-spacing");
        break;
      case "--lspace":
        options.lspace = rest[++i];
        parseSpaceAction(options.lspace, "--lspace");
        break;
      case "--rspace":
        options.rspace = rest[++i];
        parseSpaceAction(options.rspace, "--rspace");
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--trace":
        options.trace = true;
        break;
      case "--append-unanchored":
        options.appendUnanchored = true;
        break;
      case "--from-response":
        options.fromResponse = rest[++i];
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
      case "--config":
      case "-c":
        options.configFile = rest[++i];
        break;
      case "--code-template":
      case "--code-theme":
        options.codeTemplate = rest[++i];
        break;
      case "--keep-comments":
        options.keepComments = true;
        break;
      case "--max-anchors":
        options.maxAnchors = Number(rest[++i]);
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
  console.log(`hustreport —— 基于 docx-edit 的报告文档样式分析与保格式渲染引擎

用法：
  hustreport analyze     <file.docx> [--out-dir <dir>] [--parts body,header] [--include-empty] [--stdout]
  hustreport template    <file.docx> [--out-dir <dir>]
      # 纯规则打底：注入持久书签锚点并推断默认 DSL，产出 template.docx + template.json（无 AI）
  hustreport ai-template <file.docx> [--out-dir <dir>] [--task "说明"] [--preset generic|labReport]
                         [--system-prompt prompt.md] [--extra "附加要求"] [--max-anchors <n>]
                         [--config <file>] [--from-response <ai-response.txt>]
      # AI 生成模板：产出 template.docx / template.json / skeleton.md，并落盘 ai-prompt.md / ai-response.txt
      # --from-response 直接复用已保存的模型输出重新合并，不再调用模型
  hustreport render      <template.docx> --info <template.json> --md <fill.md> [--out-file <out.docx>]
                         [--config <file>] [--extra "key=val"] [--code-template <name>] [--code-mode auto|native|card]
                         [--cjk-spacing keep|space|tight] [--lspace add|remove|keep] [--rspace add|remove|keep]
                         [--strict] [--dry-run] [--trace] [--append-unanchored] [--keep-comments]
  hustreport edit        <file.docx> --out-file <out.docx> (--edits <edits.json> | --set <ref>=<text> ...) [--dry-run]

通用参数：
  --json       stdout 只输出一个 JSON 结果（日志与进度走 stderr），便于脚本 / Agent 解析
  --out        兼容旧写法：analyze/template/ai-template 视为目录，render/edit 视为文件

render 参数：
  --cjk-spacing    中英文/数字之间的空格：keep（默认，不动）/ space（两侧都加）/ tight（两侧都不留）
  --lspace         中文→西文/数字 边界（西文左侧）：add | remove | keep，覆盖 --cjk-spacing
  --rspace         西文/数字→中文 边界（西文右侧）：add | remove | keep，覆盖 --cjk-spacing
  --code-mode      代码块排版：auto（默认，模板有原生代码样式就用原生段落）/ native / card（行号卡片）
  --code-template  卡片模式的配色主题（default/classic/eclipse/dark 或 CSS 路径），不改变模式
  --strict         缺图直接报错；有任何警告时报错且不写出成稿
  --dry-run        只渲染与统计，不写文件（配合 --json / --trace 自检）
  --trace          逐块列出渲染结果：状态、模式、主题、样式来源

覆盖准则（高 → 低）：fill.md 块属性 > 命令行 > --extra > 配置文件 > template.json 规则 > 内置默认
配置文件：从当前目录向上查找 hustreport.config.json（渲染段与 openai 段可共存）；AI 段也兼容 config.json

⚠️ 本工具为辅助排版，产出后需人工审核；若模板含目录（TOC），请在 Word/WPS 中执行「更新目录 / 更新域」刷新页码。
`);
}

/** 输出通道：--json 时人读日志改走 stderr，stdout 只留最终 JSON。 */
function createLogger(json: boolean): (message?: string) => void {
  return json ? (message = "") => process.stderr.write(`${message}\n`) : (message = "") => console.log(message);
}

/** 目录型命令（analyze/template/ai-template）的输出位置：拒绝看起来像 .docx 文件的路径。 */
function resolveOutDir(options: CliOptions, fallback: string): string {
  const out = options.outDir ?? fallback;
  if (/\.docx$/i.test(out)) {
    throw new Error(`${options.command} 的 --out 是输出目录，收到的却像文件：${out}（请改用 --out-dir <dir>）`);
  }
  return out;
}

/** 文件型命令（render/edit）的输出位置：给了已存在的目录就写入其中的默认文件名。 */
function resolveOutFile(options: CliOptions, defaultName: string): string {
  const out = options.outFile ?? path.join(process.cwd(), defaultName);
  if (existsSync(out) && statSync(out).isDirectory()) return path.join(out, defaultName);
  if (!/\.docx$/i.test(out)) {
    throw new Error(`${options.command} 的 --out 应是 .docx 文件路径，收到：${out}（若想写入目录，请先创建该目录）`);
  }
  return out;
}

/** 给慢模型加进度提示：开始、每 15 秒心跳、结束耗时（全部写 stderr，不污染 --json 输出）。 */
function withProgress(chat: ChatFn, model: string): ChatFn {
  let round = 0;
  return async (messages) => {
    round += 1;
    const started = Date.now();
    const label = round === 1 ? "正在请求模型" : `上次输出不是合法 JSON，第 ${round} 次请求`;
    process.stderr.write(`⏳ ${label} ${model}…（大文档可能需要一两分钟）\n`);
    const timer = setInterval(() => {
      process.stderr.write(`   …已等待 ${Math.round((Date.now() - started) / 1000)}s\n`);
    }, 15000);
    try {
      const reply = await chat(messages);
      process.stderr.write(`✓ 模型响应完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
      return reply;
    } finally {
      clearInterval(timer);
    }
  };
}

function formatRenderSummary(result: RenderResult): string[] {
  const { stats } = result;
  const codeTotal = stats.codeNative + stats.codeCard;
  const parts = [
    stats.headings > 0 && `标题 ${stats.headings}`,
    stats.paragraphs > 0 && `段落 ${stats.paragraphs}`,
    stats.lists > 0 && `列表 ${stats.lists}`,
    stats.tables > 0 && `表格 ${stats.tables}`,
    stats.images > 0 && `图片 ${stats.images}`,
    codeTotal > 0 && `代码 ${codeTotal}（原生 ${stats.codeNative} / 卡片 ${stats.codeCard}）`,
  ].filter(Boolean);
  const lines = [
    `  填空 ${stats.filled} 处 / 插入 ${stats.blocks} 块${parts.length ? `（${parts.join("、")}）` : ""} / 共 ${stats.elements} 个段落或表格`,
  ];
  if (stats.missingImages.length > 0) {
    lines.push(`  缺图 ${stats.missingImages.length} 张（已插入红色占位文字）：${stats.missingImages.join("、")}`);
  }
  if (stats.skipped > 0) lines.push(`  跳过 ${stats.skipped} 块（原因见下方警告；--trace 查看逐块详情）`);
  return lines;
}

function formatTrace(result: RenderResult): string[] {
  const statusMark: Record<string, string> = { inserted: "+", updated: "~", fill: "=", placeholder: "?", skipped: "✗" };
  return result.trace.map((entry) => {
    const detail = [
      entry.mode && `mode=${entry.mode}`,
      entry.theme && `theme=${entry.theme}`,
      entry.style && `style=${entry.style}`,
      entry.ref && `ref=${entry.ref}`,
      entry.note && `// ${entry.note}`,
    ]
      .filter(Boolean)
      .join(" ");
    return `  ${statusMark[entry.status] ?? " "} #${String(entry.index).padStart(3, "0")} ${entry.type.padEnd(9)} ${JSON.stringify(entry.text)} ${detail}`;
  });
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

async function main(options: CliOptions): Promise<unknown> {
  const log = createLogger(options.json);
  const commands = new Set(["analyze", "edit", "template", "ai-template", "render"]);
  if (!options.file || !commands.has(options.command)) {
    usage();
    process.exitCode = options.command === "help" ? 0 : 1;
    return undefined;
  }

  if (options.command === "ai-template") {
    const outDir = resolveOutDir(options, path.join(process.cwd(), "report-template"));
    const rawResponse = options.fromResponse ? await readFile(options.fromResponse, "utf-8") : undefined;
    let chat: ChatFn | undefined;
    if (rawResponse === undefined) {
      const config = resolveChatConfig({ configFile: options.configFile });
      log(`AI 配置来源：${config.source === "env" ? "环境变量 HUST_AI_*" : config.source}（model=${config.model}）`);
      chat = withProgress(chatCompletion(config), config.model);
    } else {
      log(`复用已保存的模型输出：${options.fromResponse}（不调用模型）`);
    }
    const systemPrompt = options.systemPromptFile ? await readFile(options.systemPromptFile, "utf-8") : undefined;
    const result = await buildTemplateWithAi({
      input: options.file,
      outDir,
      task: options.task,
      preset: options.preset as "generic" | "labReport" | undefined,
      systemPrompt,
      extraInstructions: options.extra,
      maxAnchors: Number.isFinite(options.maxAnchors) && (options.maxAnchors ?? 0) > 0 ? options.maxAnchors : undefined,
      chat,
      rawResponse,
    });
    const ruleCount = result.info.profiles[result.info.defaultProfile]?.rules.length ?? 0;
    log(`已生成：${result.templatePath}`);
    log(`模板信息：${result.infoPath}（规则 ${ruleCount} 条）`);
    log(`填字稿：${result.skeletonPath}`);
    if (result.responsePath) log(`模型原始输出：${result.responsePath}（可用 --from-response 重新合并）`);
    for (const warning of result.warnings) log(`  警告: ${warning}`);
    const feedback = result.info.feedback;
    if (feedback?.missingStyles && feedback.missingStyles.length > 0) {
      log("\n💡 模板格式反馈与建议：");
      log("原文档要求或常用格式中，缺少以下样式的示例文本：");
      for (const item of feedback.missingStyles) {
        log(`  • [${item.name}]${item.requirement ? ` (要求: ${item.requirement})` : ""}`);
        log(`    👉 建议操作: ${item.instruction}`);
      }
    }
    if (feedback?.notes) log(`  📝 说明: ${feedback.notes}`);
    if (result.info.toc?.enabled) {
      log("ℹ️  模板包含目录（TOC）：渲染成稿后请在 Word / WPS 中「更新目录 / 更新域」以刷新页码。");
    }
    return {
      command: "ai-template",
      templatePath: result.templatePath,
      infoPath: result.infoPath,
      skeletonPath: result.skeletonPath,
      responsePath: result.responsePath ?? null,
      reusedResponse: result.reusedResponse,
      rules: ruleCount,
      anchors: Object.keys(result.info.anchors).length,
      normalized: result.normalized,
      toc: Boolean(result.info.toc?.enabled),
      feedback: feedback ?? null,
      warnings: result.warnings,
    };
  }

  if (options.command === "render") {
    if (!options.infoFile || !options.mdFile) throw new Error("render 需要 --info <template.json> 与 --md <fill.md>");
    const outFile = resolveOutFile(options, "report-rendered.docx");
    const result = await renderTemplateFile(options.file, options.infoFile, options.mdFile, outFile, {
      codeTemplate: options.codeTemplate,
      codeMode: options.codeMode,
      format: { cjkSpacing: options.cjkSpacing, lspace: options.lspace, rspace: options.rspace },
      configFile: options.configFile,
      extra: options.extra,
      strict: options.strict,
      dryRun: options.dryRun,
      appendUnanchored: options.appendUnanchored || undefined,
      stripComments: options.keepComments ? false : undefined,
    });
    log(
      `${options.dryRun ? "[dry-run] 未写文件" : `已渲染 -> ${outFile}`}（profile=${result.profile}，配置：${result.configSource ?? "无（仅内置默认）"}）`,
    );
    for (const line of formatRenderSummary(result)) log(line);
    if (result.cjkSpacing) log(`  中英文空格：lspace=${result.cjkSpacing.lspace} rspace=${result.cjkSpacing.rspace}`);
    if (options.trace) {
      log("逐块渲染记录（+ 插入  ~ 改写已有  = 填空  ? 占位  ✗ 跳过）：");
      for (const line of formatTrace(result)) log(line);
    }
    for (const warning of result.warnings) log(`  警告: ${warning}`);
    if (result.hasToc) {
      log("");
      log("⚠️  该模板包含目录（TOC）。请在 Word / WPS 中打开成稿后，右键目录 →「更新域 / 更新目录」（或选中目录按 F9）刷新页码与条目。");
    }
    return {
      command: "render",
      output: options.dryRun ? null : outFile,
      dryRun: options.dryRun,
      profile: result.profile,
      configSource: result.configSource ?? null,
      cjkSpacing: result.cjkSpacing ?? null,
      hasToc: result.hasToc,
      stats: result.stats,
      warnings: result.warnings,
      filledRefs: result.fills.map((fill) => fill.ref),
      trace: result.trace,
    };
  }

  if (options.command === "template") {
    const outDir = resolveOutDir(options, path.join(process.cwd(), "report-template"));
    await mkdir(outDir, { recursive: true });
    const templatePath = path.join(outDir, "template.docx");
    const infoPath = path.join(outDir, "template.json");
    const info = await createTemplate(options.file, templatePath, infoPath, { source: options.file });
    const defaultProfile = info.profiles[info.defaultProfile];
    log(`已生成模板：${templatePath}`);
    log(
      `锚点 ${Object.keys(info.anchors).length} 个 / profile ${Object.keys(info.profiles).join(",")}` +
        `（默认 ${info.defaultProfile}：配方 ${Object.keys(defaultProfile?.styles ?? {}).join(",") || "无"}，规则 ${defaultProfile?.rules.length ?? 0} 条）`,
    );
    log(`模板信息：${infoPath}`);
    return {
      command: "template",
      templatePath,
      infoPath,
      anchors: Object.keys(info.anchors).length,
      rules: defaultProfile?.rules.length ?? 0,
    };
  }

  if (options.command === "analyze") {
    const { analysis } = await analyzeDocx(options.file, {
      partTypes: options.parts,
      includeEmptyParagraphs: options.includeEmpty,
    });

    if (options.toStdout) {
      process.stdout.write(formatSegmentsCsv(analysis.segments));
      return undefined;
    }

    const outDir = resolveOutDir(options, path.join(process.cwd(), "report-out"));
    await mkdir(outDir, { recursive: true });
    const files = {
      segments: path.join(outDir, "segments.csv"),
      styles: path.join(outDir, "styles.csv"),
      media: path.join(outDir, "media.csv"),
      stylesJson: path.join(outDir, "styles.json"),
      analysis: path.join(outDir, "analysis.json"),
    };
    await writeFile(files.segments, formatSegmentsCsv(analysis.segments), "utf-8");
    await writeFile(files.styles, formatStylesCsv(analysis.styles), "utf-8");
    await writeFile(files.media, formatMediaCsv(analysis.media), "utf-8");
    await writeFile(files.stylesJson, JSON.stringify(analysis.styles, null, 2), "utf-8");
    await writeFile(files.analysis, JSON.stringify(analysis, null, 2), "utf-8");

    log(
      `已分析 ${options.file}：${analysis.meta.segmentCount} 个 segment / ${analysis.meta.styleCount} 种样式 / ${analysis.media.length} 个媒体`,
    );
    log(`输出目录：${outDir}`);
    return {
      command: "analyze",
      segments: analysis.meta.segmentCount,
      styles: analysis.meta.styleCount,
      media: analysis.media.length,
      files,
    };
  }

  // edit
  const plan = await readPlan(options);
  const total = (plan.set?.length ?? 0) + (plan.insert?.length ?? 0) + (plan.delete?.length ?? 0);
  if (total === 0) throw new Error("没有可用的编辑，请用 --edits 或 --set 指定");
  const outFile = resolveOutFile(options, "report-edited.docx");

  const doc = await openDocx(options.file);
  const result = applyEdits(doc, plan);
  if (!options.dryRun) await doc.saveAs(outFile);

  log(`改写 ${result.applied} 处 / 插入 ${result.inserted} 处 / 删除 ${result.deleted} 处，输出：${options.dryRun ? "(dry-run 未写文件)" : outFile}`);
  for (const edit of result.edits) {
    log(`  [set] ${edit.ref} (index=${edit.index}, style=${edit.styleId}) : ${JSON.stringify(edit.before)} -> ${JSON.stringify(edit.after)}`);
  }
  for (const insert of result.inserts) {
    log(`  [insert] ${insert.as} style=${insert.styleId} ${insert.position} ${insert.anchorRef} : ${JSON.stringify(insert.text)}`);
  }
  for (const deleted of result.deletes) {
    log(`  [delete] ${deleted.as} ${deleted.ref} : ${JSON.stringify(deleted.text)}`);
  }
  return {
    command: "edit",
    output: options.dryRun ? null : outFile,
    applied: result.applied,
    inserted: result.inserted,
    deleted: result.deleted,
    edits: result.edits,
    inserts: result.inserts,
    deletes: result.deletes,
  };
}

const wantsJson = process.argv.includes("--json");
try {
  const options = parseArgs(process.argv.slice(2));
  const payload = await main(options);
  if (options.json && payload !== undefined) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...(payload as object) }, null, 2)}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  else console.error(message);
  process.exitCode = 1;
}
