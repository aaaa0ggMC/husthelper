#!/usr/bin/env -S node --experimental-strip-types
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import hustnet, { isNetError, type NetUserInfo } from "../hustnet.ts";

/**
 * 校园网认证小 CLI。
 *
 *   node examples/net_cli.ts [command] [options]
 *   pnpm net status
 *
 * 配置文件默认 `hustnet.json`（账号、密码、可选 portal/queryString/probeUrl）；
 * 不存在或缺少字段时会交互式询问。会话默认存 `.hustnet-session.json`。
 */

interface CliConfig {
  username?: string;
  password?: string;
  probeUrl?: string;
  portal?: string;
  queryString?: string;
  service?: string;
  [key: string]: unknown;
}

interface CliOptions {
  command: string;
  configFile: string;
  sessionFile: string;
  probeUrl?: string;
  portal?: string;
  queryString?: string;
  service?: string;
  save: boolean;
}

const DEFAULT_CONFIG = "hustnet.json";
const DEFAULT_SESSION = ".hustnet-session.json";
const COMMANDS = new Set(["status", "info", "login", "logout", "keepalive"]);

const HELP = `校园网认证 CLI

用法：
  net_cli <command> [options]

命令：
  status        查看在线状态
  info          获取本人校园网信息（未认证自动登录；默认命令）
  login         登录并输出本人信息
  logout        下线（best-effort，始终清理本地会话）
  keepalive     执行一次保活
  whoami        同 info
  help          显示本帮助

选项：
  -c, --config <file>   配置文件，默认 ${DEFAULT_CONFIG}
  -s, --session <file>  会话文件，默认 ${DEFAULT_SESSION}
  -p, --probe <url>     覆盖探测地址（默认 http://123.123.123.123/）
      --portal <url>    直接指定门户基址（需配合 --query）
      --query <qs>      门户加密下发的原始 query（配合 --portal）
      --service <name>  套餐 / 服务名
      --no-save         交互输入的账号密码不写入配置文件

示例：
  pnpm net status
  pnpm net login --probe http://123.123.123.123/
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "info",
    configFile: DEFAULT_CONFIG,
    sessionFile: DEFAULT_SESSION,
    save: true,
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift()!;
    const [flag, inline] = token.startsWith("--") && token.includes("=")
      ? [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)]
      : [token, undefined];
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = rest.shift();
      if (next === undefined) throw new Error(`选项 ${flag} 缺少值`);
      return next;
    };
    switch (flag) {
      case "-c":
      case "--config":
        options.configFile = value();
        break;
      case "-s":
      case "--session":
        options.sessionFile = value();
        break;
      case "-p":
      case "--probe":
        options.probeUrl = value();
        break;
      case "--portal":
        options.portal = value();
        break;
      case "--query":
        options.queryString = value();
        break;
      case "--service":
        options.service = value();
        break;
      case "--no-save":
        options.save = false;
        break;
      case "-h":
      case "--help":
        options.command = "help";
        break;
      default:
        if (flag.startsWith("-")) throw new Error(`未知选项：${flag}`);
        options.command = flag;
    }
  }
  if (options.command === "whoami") options.command = "info";
  return options;
}

function loadConfig(file: string): CliConfig {
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as CliConfig;
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    throw new Error(`配置文件 ${file} 解析失败：${error instanceof Error ? error.message : error}`);
  }
}

function saveConfig(file: string, config: CliConfig): void {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** 隐藏回显地读取密码；非 TTY 时退化为普通读取。 */
function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(question);
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode(true);
    input.resume();
    let value = "";
    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          output.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        value += char;
      }
    };
    input.on("data", onData);
  });
}

async function resolveCredentials(config: CliConfig, options: CliOptions): Promise<CliConfig> {
  const resolved: CliConfig = { ...config };

  if ((!resolved.username || !resolved.password) && !process.stdin.isTTY) {
    throw new Error(
      `缺少账号 / 密码，且当前不是交互式终端；请提供 ${options.configFile} 或使用 --config 指定`,
    );
  }

  if (options.probeUrl) resolved.probeUrl = options.probeUrl;
  if (options.portal) resolved.portal = options.portal;
  if (options.queryString) resolved.queryString = options.queryString;
  if (options.service !== undefined) resolved.service = options.service;

  const interactive = !resolved.username || !resolved.password;
  if (resolved.username) {
    console.log(`账号：${resolved.username}`);
  } else {
    resolved.username = await ask("请输入校园网账号（学号）：");
  }
  if (!resolved.password) {
    resolved.password = await askHidden("请输入校园网密码：");
  }
  if (interactive && options.save) {
    const answer = (await ask(`是否保存到 ${options.configFile}？[y/N] `)).toLowerCase();
    if (answer === "y" || answer === "yes") {
      saveConfig(options.configFile, resolved);
      console.log(`已保存到 ${options.configFile}（权限 0600，请勿提交到仓库）`);
    }
  }
  return resolved;
}

function printUserInfo(info: NetUserInfo): void {
  console.log("校园网账号信息：");
  console.log(`  姓名：${info.userName ?? "?"}`);
  console.log(`  学号：${info.userId ?? "?"}`);
  console.log(`  IP：  ${info.userIp ?? "?"}`);
  console.log(`  MAC： ${info.userMac ?? "?"}`);
  console.log(`  余额：${info.accountFee ?? "?"}`);
  console.log(`  套餐：${info.userPackage ?? "?"}`);
  console.log(`  到期：${info.maxLeavingTime ?? "?"}`);
}

function report(error: unknown): number {
  if (isNetError(error)) {
    console.error(`[校园网] ${error.phase}/${error.code}: ${error.message}`);
    if (error.httpStatus) console.error(`  HTTP: ${error.httpStatus}`);
    if (error.retryable) console.error("  该错误可重试");
    if (error.responseBody) console.error(`  原始响应: ${error.responseBody}`);
    if (error.raw) console.error(`  原始数据: ${JSON.stringify(error.raw).slice(0, 400)}`);
    return 1;
  }
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    console.log(HELP);
    return;
  }
  if (!COMMANDS.has(options.command)) {
    console.error(`未知命令：${options.command}\n`);
    console.log(HELP);
    process.exitCode = 2;
    return;
  }

  const config = await resolveCredentials(loadConfig(options.configFile), options);
  const client = hustnet
    .auth({
      username: config.username!,
      password: config.password!,
      probeUrl: config.probeUrl,
      portal: config.portal,
      queryString: config.queryString,
      service: config.service,
    })
    .persistent(options.sessionFile);

  switch (options.command) {
    case "status": {
      const status = await client.status();
      console.log(
        `状态：${status.online === undefined ? "未知" : status.online ? "在线" : "离线"}` +
          `（${status.reason ?? "-"}）`,
      );
      if (status.userInfo) printUserInfo(status.userInfo);
      if (status.portal) console.log(`  门户：${status.portal.base}`);
      break;
    }
    case "info": {
      const info = await client.getMyInfo();
      printUserInfo(info);
      if (client.portal) console.log(`  门户：${client.portal.base}`);
      if (client.userIndex) console.log(`  userIndex：${client.userIndex}`);
      break;
    }
    case "login": {
      const result = await client.login();
      console.log(`登录成功：${result.message || result.result || "ok"}`);
      // 刚登录的一瞬间门户偶尔还查不到在线信息，重试几次而不是静默吞掉
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          printUserInfo(await client.getOnlineUserInfo());
          break;
        } catch (error) {
          if (attempt === 3) console.warn(`（登录成功，但读取在线信息失败：${isNetError(error) ? `${error.code}: ${error.message}` : error}）`);
          else await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      break;
    }
    case "logout": {
      await client.logout();
      console.log("已下线（本地会话已清除）");
      break;
    }
    case "keepalive": {
      const text = await client.keepAlive();
      console.log(`保活完成（响应 ${text.length} 字节）`);
      break;
    }
    default:
      console.error(`未知命令：${options.command}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((error) => {
  process.exitCode = report(error);
});
