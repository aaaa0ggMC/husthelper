import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface StdCharOptions {
  /** 显式指定运行器命令（如 "tsx"）；不传则自动探测 */
  command?: string;
  cliPath?: string;
  timeout?: number;
}

const DEFAULT_CLI = fileURLToPath(new URL("../stdchar/cli.ts", import.meta.url));

/** Windows 上 .bin / 全局安装里的可执行文件带扩展名（existsSync 不做 PATHEXT 补全） */
const WIN_EXEC_EXTS = [".exe", ".cmd", ".bat"];
/** .cmd/.bat 不能直接 spawn（Node 自 CVE-2024-27980 起拒绝），需经 cmd.exe 启动 */
const SHELL_EXEC_EXTS = [".cmd", ".bat"];

/**
 * 继承后会改变子进程生命周期 / 行为的 execArgv 前缀：
 * - `--watch` 让子进程永不退出，只能等超时；
 * - `--inspect` / `--inspect-brk` 让子进程挂起等待调试器 attach；
 * - `--cpu-prof` / `--heap-prof` 会在 cwd 乱写 profile 文件。
 */
const EXEC_ARGV_BLOCKED_PREFIXES = ["--watch", "--inspect", "--cpu-prof", "--heap-prof"];
/** 这些 execArgv 的取值是独立 token，跳过时需要连带跳过下一个 */
const EXEC_ARGV_WITH_VALUE = new Set([
  "--watch-path",
  "--inspect-port",
  "--cpu-prof-dir",
  "--cpu-prof-interval",
  "--heap-prof-dir",
]);

interface Launcher {
  command: string;
  args: string[];
  /** Windows 下经 cmd.exe 启动 .cmd/.bat 时需要原样传参 */
  windowsVerbatimArguments?: boolean;
}

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

/** CLI 是否位于 node_modules 下（Node 拒绝为其中文件剥离类型） */
function isUnderNodeModules(target: string): boolean {
  return path.resolve(target).split(path.sep).includes("node_modules");
}

/**
 * 继承父进程的 execArgv，但剔除两类参数：
 * 1. `--eval`/`-e`/`--print`/`-p` 及其取值——Node 会把它们（连同代码本体）放进 execArgv，
 *    直接继承会让子进程变成「拿父进程的代码再跑一遍 CLI」，必须连带取值一起丢弃；
 * 2. `--watch`/`--inspect`/`--*-prof` 系列——会挂起子进程、让其永不退出或在 cwd 写文件。
 */
function inheritedLoaderArgs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === "--eval" || arg === "-e" || arg === "--print" || arg === "-p") {
      i += 1;
      continue;
    }
    if (EXEC_ARGV_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (EXEC_ARGV_BLOCKED_PREFIXES.some((prefix) => arg === prefix || arg.startsWith(`${prefix}=`))) {
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** 父进程是否已经在用 TS 运行器（tsx / ts-node / 原生类型剥离 / 自定义 loader） */
function isTypeScriptRunner(args: string[]): boolean {
  // NODE_OPTIONS 里的 loader 不会出现在 execArgv 中，但 spawn 默认继承 env，子进程同样能跑
  const tokens = [...args, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean)];
  return tokens.some(
    (arg) =>
      arg.includes("tsx") ||
      arg.includes("ts-node") ||
      arg.startsWith("--experimental-strip-types") ||
      arg.startsWith("--experimental-transform-types") ||
      arg.startsWith("--import") ||
      arg.startsWith("--loader"),
  );
}

/** 从 start 与 cwd 分别上溯，产出所有祖先目录 */
function* ancestorDirs(start?: string): Generator<string> {
  for (const base of [start, process.cwd()]) {
    if (!base) continue;
    let dir = path.resolve(base);
    for (;;) {
      yield dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

/** 可执行文件名候选：Windows 上必须显式带扩展名，否则 existsSync 找不到 tsx.cmd */
function executableNames(name: string): string[] {
  if (process.platform !== "win32") return [name];
  return WIN_EXEC_EXTS.map((ext) => `${name}${ext}`);
}

/** 依次在 CLI 所在目录与 cwd 上溯 node_modules/.bin，最后查 PATH */
function findExecutable(name: string, from?: string): string | undefined {
  const names = executableNames(name);
  for (const dir of ancestorDirs(from)) {
    for (const candidate of names.map((entry) => path.join(dir, "node_modules", ".bin", entry))) {
      if (exists(candidate)) return candidate;
    }
  }
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    for (const candidate of names.map((ext) => path.join(entry, ext))) {
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** 读取包 package.json 的 bin 入口（bin 字段是该包的稳定契约，比硬编码 dist 路径可靠） */
function runnerEntry(pkgDir: string, name: string): string | undefined {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!exists(pkgJsonPath)) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[name];
    if (typeof bin !== "string" || !bin) return undefined;
    const entry = path.join(pkgDir, bin);
    return exists(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 在 node_modules 链里定位 TS 运行器包，并用当前 node 直接跑「bin 入口 + 目标参数」
 * （等同于 .bin shim 内部做的事，但跨平台、无需 shell、参数由 spawn 正确转义）。
 */
function findRunnerPackage(name: string, args: string[], from?: string): Launcher | undefined {
  for (const dir of ancestorDirs(from)) {
    const entry = runnerEntry(path.join(dir, "node_modules", name), name);
    if (entry) return { command: process.execPath, args: [entry, ...args] };
  }
  return undefined;
}

/** Windows 上 .cmd/.bat 只能经 cmd.exe 启动；且 shell:true 不转义参数，必须自行加引号 */
function cmdLauncher(command: string, args: string[]): Launcher {
  // Windows 文件名不允许出现 "，故逐参数包引号即安全；/s 让 cmd 剥掉最外层引号
  const line = [`"${command}"`, ...args.map((arg) => `"${arg}"`)].join(" ");
  return {
    command: process.env.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

/** 已知命令路径时构造启动器（Windows .cmd 经 cmd.exe） */
function toLauncher(command: string, args: string[]): Launcher {
  const needsCmd =
    process.platform === "win32" && SHELL_EXEC_EXTS.some((ext) => command.toLowerCase().endsWith(ext));
  return needsCmd ? cmdLauncher(command, args) : { command, args };
}

/** .bin / PATH 里确实找到 shim 时才构造启动器 */
function shimLauncher(shim: string | undefined, args: string[]): Launcher | undefined {
  return shim ? toLauncher(shim, args) : undefined;
}

/** 显式 command 在 Windows 上同样补全扩展名（`tsx` → `tsx.CMD`） */
function resolveCommand(command: string): string {
  if (process.platform !== "win32" || /[\\/]/.test(command)) return command;
  return findExecutable(command) ?? command;
}

/**
 * 计算运行 stdchar CLI 的命令：
 * 1. 若父进程已带 TS 加载参数（如 `tsx examples/x.ts`、`NODE_OPTIONS=--import tsx`），直接复用；
 * 2. 否则若 CLI 位于 `node_modules` 下（包被安装为依赖），改用 tsx / ts-node；
 * 3. 否则用当前 node 直接运行（单仓内 CLI 在仓库里，原生类型剥离可用）。
 */
function resolveLauncher(cliPath: string): Launcher | { error: string } {
  const inherited = inheritedLoaderArgs();
  if (isTypeScriptRunner(inherited)) {
    return { command: process.execPath, args: [...inherited, cliPath] };
  }
  if (isUnderNodeModules(cliPath)) {
    const from = path.dirname(cliPath);
    const tsx =
      findRunnerPackage("tsx", [cliPath], from) ?? shimLauncher(findExecutable("tsx", from), [cliPath]);
    if (tsx) return tsx;
    const tsNode =
      findRunnerPackage("ts-node", ["--esm", cliPath], from) ??
      shimLauncher(findExecutable("ts-node", from), ["--esm", cliPath]);
    if (tsNode) return tsNode;
    return {
      error:
        `stdchar CLI 位于 node_modules 下（${cliPath}），Node 拒绝对其中文件剥离类型，且未找到 tsx / ts-node。\n` +
        `请安装 tsx（如 pnpm add -D tsx），或显式指定运行器：withStdChar({ command: "tsx" })`,
    };
  }
  return { command: process.execPath, args: [cliPath] };
}

export function recognizeStdCharPipe(gif: Buffer, options: StdCharOptions = {}): Promise<string> {
  const cliPath = options.cliPath ?? DEFAULT_CLI;
  const launcher = options.command
    ? toLauncher(resolveCommand(options.command), [cliPath])
    : resolveLauncher(cliPath);
  if ("error" in launcher) return Promise.reject(new Error(launcher.error));
  const timeout = options.timeout ?? 15000;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(launcher.command, launcher.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(launcher.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });

    let stdout = "";
    let stderr = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill();
      // SIGTERM 被忽略时兜底强杀，避免子进程残留
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      reject(new Error(`stdchar 进程超时 (${timeout}ms)`));
    }, timeout);
    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) => {
      clearTimers();
      reject(error);
    });

    child.on("close", (code) => {
      clearTimers();
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`stdchar 进程退出码 ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(gif);
  });
}
