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

/** 继承父进程的加载参数，去掉 `--eval`/`-e`/`--print`/`-p` 及其参数 */
function inheritedLoaderArgs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === "--eval" || arg === "-e" || arg === "--print" || arg === "-p") {
      i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** 父进程是否已经在用 TS 运行器（tsx / ts-node / 原生类型剥离 / 自定义 loader） */
function isTypeScriptRunner(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg.includes("tsx") ||
      arg.includes("ts-node") ||
      arg.startsWith("--experimental-strip-types") ||
      arg.startsWith("--experimental-transform-types") ||
      arg.startsWith("--import") ||
      arg.startsWith("--loader"),
  );
}

/** 在 cwd 上溯的 node_modules/.bin 以及 PATH 中查找可执行文件 */
function findExecutable(name: string): string | undefined {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", name);
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, name);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 计算运行 stdchar CLI 的命令：
 * 1. 若父进程已带 TS 加载参数（如 `tsx examples/x.ts`），直接复用；
 * 2. 否则若 CLI 位于 `node_modules` 下（包被安装为依赖），改用 tsx / ts-node；
 * 3. 否则用当前 node 直接运行（单仓内 CLI 在仓库里，原生类型剥离可用）。
 */
function resolveLauncher(cliPath: string): { command: string; args: string[] } {
  const inherited = inheritedLoaderArgs();
  if (isTypeScriptRunner(inherited)) {
    return { command: process.execPath, args: [...inherited, cliPath] };
  }
  if (isUnderNodeModules(cliPath)) {
    const tsx = findExecutable("tsx");
    if (tsx) return { command: tsx, args: [cliPath] };
    const tsNode = findExecutable("ts-node");
    if (tsNode) return { command: tsNode, args: ["--esm", cliPath] };
  }
  return { command: process.execPath, args: [cliPath] };
}

export function recognizeStdCharPipe(gif: Buffer, options: StdCharOptions = {}): Promise<string> {
  const cliPath = options.cliPath ?? DEFAULT_CLI;
  const launcher = options.command
    ? { command: options.command, args: [cliPath] }
    : resolveLauncher(cliPath);
  const timeout = options.timeout ?? 15000;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(launcher.command, launcher.args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stdchar 进程超时 (${timeout}ms)`));
    }, timeout);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`stdchar 进程退出码 ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(gif);
  });
}
