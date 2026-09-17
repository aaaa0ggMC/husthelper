import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface StdCharOptions {
  command?: string;
  cliPath?: string;
  timeout?: number;
}

const DEFAULT_CLI = fileURLToPath(new URL("../stdchar/cli.ts", import.meta.url));

export function recognizeStdCharPipe(gif: Buffer, options: StdCharOptions = {}): Promise<string> {
  const command = options.command ?? process.execPath;
  const cliPath = options.cliPath ?? DEFAULT_CLI;
  const timeout = options.timeout ?? 15000;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [cliPath], { stdio: ["pipe", "pipe", "pipe"] });

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
