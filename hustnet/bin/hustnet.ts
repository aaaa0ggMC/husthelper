#!/usr/bin/env -S node --experimental-strip-types
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import hustnet, { isNetError, type NetUserInfo } from "../index.ts";

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
  dumpFile?: string;
  save: boolean;
  outputFile?: string;
  templateFile?: string;
  modulus?: string;
  exponent?: string;
  stdout?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG = "hustnet.json";
const DEFAULT_SESSION = ".hustnet-session.json";
const DEFAULT_C_TEMPLATE = path.resolve(__dirname, "../c-template/hustnet_minimal.h");
const DEFAULT_C_OUTPUT = "hustnet_minimal.h";
const COMMANDS = new Set(["status", "info", "login", "logout", "keepalive", "generate_c"]);

const HELP = `校园网认证 CLI

用法：
  net_cli <command> [options]

命令：
  status        查看在线状态
  info          获取本人校园网信息（未认证自动登录；默认命令）
  login         登录并输出本人信息
  logout        下线（best-effort，始终清理本地会话）
  keepalive     执行一次保活
  generate_c    生成嵌入式最小 C 语言 SDK 头文件（hustnet minimal c）
  whoami        同 info
  help          显示本帮助

通用选项：
  -c, --config <file>   配置文件，默认 ${DEFAULT_CONFIG}
  -s, --session <file>  会话文件，默认 ${DEFAULT_SESSION}
  -p, --probe <url>     覆盖探测地址（默认 http://123.123.123.123/）
      --portal <url>    直接指定门户基址（需配合 --query）
      --query <qs>      门户加密下发的原始 query（配合 --portal）
      --service <name>  套餐 / 服务名
      --dump <file>     将 keepalive 的原始响应写入文件（排查用）
      --no-save         交互输入的账号密码不写入配置文件

generate_c 专属选项：
  -o, --output <file>   输出 C 头文件路径，默认 ${DEFAULT_C_OUTPUT}
      --template <file> 模板文件路径，默认内置模板
  -m, --modulus <hex>   手动指定公钥模数（离线生成，跳过联机请求）
  -e, --exponent <hex>  手动指定公钥指数，默认 10001
      --stdout          直接输出生成的 C 代码到控制台

示例：
  pnpm net status
  pnpm net login --probe http://123.123.123.123/
  pnpm net generate_c -o esp32/hustnet_minimal.h
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
      case "--dump":
        options.dumpFile = value();
        break;
      case "-o":
      case "--output":
        options.outputFile = value();
        break;
      case "--template":
        options.templateFile = value();
        break;
      case "-m":
      case "--modulus":
        options.modulus = value();
        break;
      case "-e":
      case "--exponent":
        options.exponent = value();
        break;
      case "--stdout":
        options.stdout = true;
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
  if (options.command === "generate-c" || options.command === "genc") options.command = "generate_c";
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

/** 姓名一律打码，避免截图/录屏泄露 */
const MASK = "***";

/** 把 JSON 文本里 `userName` 之类的字段值替换成 `***` */
function redactText(text: string): string {
  return text.replace(/("user_?name"\s*:\s*")[^"]*(")/gi, `$1${MASK}$2`);
}

function printUserInfo(info: NetUserInfo): void {
  console.log("校园网账号信息：");
  console.log(`  姓名：${info.userName ? MASK : "?"}`);
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
    if (error.responseBody) console.error(`  原始响应: ${redactText(error.responseBody)}`);
    if (error.raw) {
      console.error(`  原始数据: ${redactText(JSON.stringify(error.raw)).slice(0, 400)}`);
    }
    return 1;
  }
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
}

async function handleGenerateC(options: CliOptions, rawConfig: CliConfig): Promise<void> {
  const templatePath = options.templateFile ? path.resolve(options.templateFile) : DEFAULT_C_TEMPLATE;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`找不到 C 语言模板文件：${templatePath}`);
  }

  let modulus = options.modulus?.trim();
  let exponent = options.exponent?.trim() || "10001";
  let source = "命令行参数";

  if (!modulus) {
    console.log("正在从校园网门户获取 RSA 公钥 (exponential / modulo)...");
    const portal = options.portal || rawConfig.portal;
    const queryString = options.queryString || rawConfig.queryString;
    const probeUrl = options.probeUrl || rawConfig.probeUrl;

    // 1. 尝试直接获取
    try {
      const client = hustnet.auth({
        username: rawConfig.username || "anonymous",
        password: rawConfig.password || "anonymous",
        probeUrl,
        portal,
        queryString,
      });
      const pageInfo = await client.fetchPageInfo();
      if (pageInfo.publicKeyModulus) {
        modulus = pageInfo.publicKeyModulus;
        if (pageInfo.publicKeyExponent) exponent = pageInfo.publicKeyExponent;
        source = client.portal?.base ?? "在线门户";
      }
    } catch {
      // 忽略直接拉取失败
    }

    // 2. 尝试从已有 session 文件中读取 portal
    if (!modulus && fs.existsSync(options.sessionFile)) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(options.sessionFile, "utf-8"));
        if (sessionData?.portal?.base) {
          const client = hustnet.auth({
            username: rawConfig.username || "anonymous",
            password: rawConfig.password || "anonymous",
            portal: sessionData.portal.base,
            queryString: sessionData.portal.queryString || "",
          });
          const pageInfo = await client.fetchPageInfo();
          if (pageInfo.publicKeyModulus) {
            modulus = pageInfo.publicKeyModulus;
            if (pageInfo.publicKeyExponent) exponent = pageInfo.publicKeyExponent;
            source = `${sessionData.portal.base} (会话文件 ${options.sessionFile})`;
          }
        }
      } catch {
        // 忽略 session 读取失败
      }
    }

    if (!modulus) {
      throw new Error(
        "未能自动从校园网门户获取 RSA 公钥（当前网络可能未连接校园网、或设备已在线导致未被门户劫持）。\n" +
          "解决方法：\n" +
          "  1. 连入未认证的校园网后重试；\n" +
          "  2. 使用 --portal <url> --query <qs> 指定门户；\n" +
          "  3. 直接使用 -m, --modulus <hex> [-e <hex>] 离线指定公钥模数生成。"
      );
    }
  }

  const templateContent = fs.readFileSync(templatePath, "utf-8");
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const yearStr = String(now.getFullYear());
  const generatedCode = templateContent
    .replace(/\{\{HUSTNET_MODULUS\}\}/g, modulus)
    .replace(/\{\{HUSTNET_EXPONENT\}\}/g, exponent)
    .replace(/\{\{HUSTNET_GENERATED_DATE\}\}/g, dateStr)
    .replace(/\{\{HUSTNET_GENERATED_YEAR\}\}/g, yearStr)
    .replace(/\{\{HUSTNET_GENERATED_AT\}\}/g, now.toISOString());

  if (options.stdout) {
    process.stdout.write(generatedCode);
    return;
  }

  const outPath = path.resolve(options.outputFile || DEFAULT_C_OUTPUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, generatedCode, "utf-8");

  console.log("hustnet minimal C 语言 SDK 生成成功！");
  console.log(`  输出文件：${outPath}`);
  console.log(`  公钥来源：${source}`);
  console.log(`  模数长度：${modulus.length * 4}-bit (${modulus.length} 十六进制字符)`);
  console.log(`  模数前缀：${modulus.slice(0, 32)}…`);
  console.log(`  公钥指数：0x${exponent}`);
  console.log("\n嵌入式（ESP32 / STM32 / Pico 等）使用方式：");
  console.log("  在任意一个 .c / .cpp 文件中编写：");
  console.log("  -------------------------------------------------------------");
  console.log("  #define HUSTNET_MINIMAL_C_IMPLEMENTATION");
  console.log(`  #include "${path.basename(outPath)}"`);
  console.log("");
  console.log("  void login_demo() {");
  console.log("      char enc_pwd[257];");
  console.log('      hustnet_encrypt_password("your_password", enc_pwd, sizeof(enc_pwd));');
  console.log("");
  console.log("      char body[1024];");
  console.log('      hustnet_build_login_payload("U2025xxxxx", enc_pwd, query_string, NULL, body, sizeof(body));');
  console.log("      // 使用任意 HTTP 客户端库向 /eportal/InterFace.do?method=login POST body 即可");
  console.log("  }");
  console.log("  -------------------------------------------------------------");
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

  const rawConfig = loadConfig(options.configFile);
  if (options.command === "generate_c") {
    await handleGenerateC(options, rawConfig);
    return;
  }

  const config = await resolveCredentials(rawConfig, options);
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
      const interval = /keepaliveInterval["'\s:=]+(\d+)/i.exec(text)?.[1];
      console.log(
        `保活完成（响应 ${text.length} 字节${interval ? `，页面内 keepaliveInterval=${interval}` : ""}）`,
      );
      if (options.dumpFile) {
        fs.writeFileSync(options.dumpFile, text);
        console.log(`原始响应已写入 ${options.dumpFile}`);
      }
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
