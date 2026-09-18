#!/usr/bin/env -S node --experimental-strip-types
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Session } from "hustcore";
import {
  NET_DEFAULT_PROBE_URL,
  SessionTransport,
  auth,
  decodeBody,
  parseEportalRedirect,
} from "../index.ts";

/**
 * 校园网门户「连接瞬间」抓取工具。
 *
 * 背景：NAS 只在设备**未认证**时对它做 HTTP 劫持，并把一段加密 query 下发给门户：
 *
 *   http://<nas>:8080/eportal/index.jsp?wlanuserip=<enc>&wlanacname=<enc>&nasip=<enc>&mac=<enc>&...
 *
 * 这段 query 由 NAS 签发、无法自行伪造；一旦认证成功就再也探测不到。
 * 系统在连上 wifi 后本来就会发一次 HTTP 联网检测（NetworkManager 的 connectivity
 * check，默认 `http://ping.archlinux.org/nm-check.txt`），NAS 正是劫持那个请求——
 * 本脚本做的事就是：在认证前，主动发类似的 HTTP 请求，把劫持响应里的跳转抓下来。
 *
 * 命中后：
 *   1. 解析出门户 base 与完整 queryString；
 *   2. 落地到 0600 的 JSON 文件（供 `hustnet --portal <base> --query <qs>` 复用）；
 *   3. 可选 `--login`：直接登录并打印服务端返回的权威 id（`userIndex`）；
 *   4. 可选 `--logout`：拿到 id 后立即下线。
 *
 * 关键实现点：
 *   - 只认无线网卡（`wl*`）；若还没连上 wifi 就等它拿到 IPv4，而不是乱绑 docker0。
 *   - 绑定该网卡 IPv4 作源地址，绕过本机 Clash/TUN 对出站流量的接管。
 *   - 用 fs.writeSync(1/2, …) 同步输出，`pnpm`/管道下 Ctrl-C 也不会丢日志。
 */

const EPORTAL_MARK = "/eportal/";
const PORTAL_INDEX_PATH = "/eportal/index.jsp";
const PORTAL_INTERFACE_PATH = "/eportal/InterFace.do";
const PORTAL_SUCCESS_PATH = "/eportal/success.jsp";
const DEFAULT_OUT = ".hustnet-portal.json";
const DEFAULT_CONFIG = "hustnet.json";

/** 同步写 stdout/stderr：Node 在 Linux 下管道 stdout 是异步的，日志可能来不及 flush。 */
const write = (line: string): void => {
  fs.writeSync(1, `${line}\n`);
};
const writeErr = (line: string): void => {
  fs.writeSync(2, `${line}\n`);
};

interface CliOptions {
  iface?: string;
  probeUrls: string[];
  out: string;
  intervalMs: number;
  timeoutMs: number;
  durationMs: number;
  once: boolean;
  watch: boolean;
  save: boolean;
  json: boolean;
  login: boolean;
  logout: boolean;
  username?: string;
  password?: string;
  configFile: string;
}

const HELP = `校园网门户抓取（连接瞬间）

用法：
  node --experimental-strip-types hustnet/bin/capture-portal.ts [options]

默认行为：
  先等无线网卡（wl*）拿到 IPv4，再轮询探测地址直到发现门户劫持跳转，
  解析并保存后退出；若此刻已认证，则持续等待（每 5 次打印一次心跳）。

选项：
  -i, --iface <name>     绑定哪张网卡（默认自动等待第一张带 IPv4 的 wl*）
  -p, --probe <url>      探测地址，可重复；默认 ${NET_DEFAULT_PROBE_URL}
  -o, --out <file>       抓取结果输出文件，默认 ${DEFAULT_OUT}
      --interval <ms>    轮询间隔，默认 1000
      --timeout <ms>     单次请求超时，默认 4000
      --duration <sec>   最长运行秒数，0 = 不限，默认 0
      --once             探测一次就退出（不等待无线网卡就绪）
      --watch            持续运行，门户变化时重新保存（Ctrl-C 退出）
      --json             以 JSON 输出到 stdout（便于管道）
      --no-save          不写文件，仅打印
  -c, --config <file>    登录用配置（读 username/password），默认 ${DEFAULT_CONFIG}
  -u, --user <name>      校园网账号（配合 --login）
  -w, --pass <pwd>       校园网密码（配合 --login）
      --login            抓到门户后执行登录，打印权威 userIndex
      --logout           配合 --login：打印 userIndex 后立即下线
  -h, --help             显示本帮助

推荐姿势：
  1) 先在终端 A 运行本脚本（它会等你连 wifi）；
  2) 再去连接 HUST_WIRELESS；
  3) 脚本会在你认证之前抓到门户。

排查用（直接看系统连接时发的 HTTP）：
  sudo tcpdump -i wlp4s0 -A -s0 'tcp port 80'
  —— 重连 wifi，观察 NetworkManager 联网检测请求被劫持后返回的 eportal 跳转。

作为 NetworkManager 事件钩子（连接瞬间自动抓）：
  sudo tee /etc/NetworkManager/dispatcher.d/90-hustnet-capture >/dev/null <<'EOF'
  #!/bin/sh
  # $1=iface $2=up|down；只在无线 up 时抓一次（最多等 30s）
  [ "$2" = "up" ] || exit 0
  case "$1" in wl*) ;; *) exit 0 ;; esac
  exec /usr/bin/node --experimental-strip-types /绝对路径/hustnet/bin/capture-portal.ts \\
    --iface "$1" --duration 30 --out /var/lib/hustnet/portal.json
  EOF
  sudo chmod +x /etc/NetworkManager/dispatcher.d/90-hustnet-capture
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    probeUrls: [],
    out: DEFAULT_OUT,
    intervalMs: 1000,
    timeoutMs: 4000,
    durationMs: 0,
    once: false,
    watch: false,
    save: true,
    json: false,
    login: false,
    logout: false,
    configFile: DEFAULT_CONFIG,
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
      case "-i":
      case "--iface":
        options.iface = value();
        break;
      case "-p":
      case "--probe":
        options.probeUrls.push(value());
        break;
      case "-o":
      case "--out":
        options.out = value();
        break;
      case "--interval":
        options.intervalMs = Math.max(50, Number(value()));
        break;
      case "--timeout":
        options.timeoutMs = Math.max(200, Number(value()));
        break;
      case "--duration":
        options.durationMs = Math.max(0, Number(value())) * 1000;
        break;
      case "--once":
        options.once = true;
        break;
      case "--watch":
        options.watch = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--no-save":
        options.save = false;
        break;
      case "-c":
      case "--config":
        options.configFile = value();
        break;
      case "-u":
      case "--user":
        options.username = value();
        break;
      case "-w":
      case "--pass":
        options.password = value();
        break;
      case "--login":
        options.login = true;
        break;
      case "--logout":
        options.logout = true;
        options.login = true;
        break;
      case "-h":
      case "--help":
        write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`未知选项：${flag}`);
    }
  }
  if (options.probeUrls.length === 0) options.probeUrls.push(NET_DEFAULT_PROBE_URL);
  return options;
}

interface InterfaceChoice {
  iface: string;
  address: string;
}

function ipv4Of(iface: string): string | undefined {
  return os
    .networkInterfaces()
    [iface]?.find((info) => info.family === "IPv4" && !info.internal)?.address;
}

/** 找第一张已经拿到 IPv4 的无线网卡；没有则返回 undefined（而不是退回 docker0）。 */
function findWireless(): InterfaceChoice | undefined {
  const wireless = Object.keys(os.networkInterfaces()).filter(
    (key) => /^wl/.test(key) && ipv4Of(key),
  );
  if (wireless.length === 0) return undefined;
  return { iface: wireless[0], address: ipv4Of(wireless[0])! };
}

function requireInterface(name: string): InterfaceChoice {
  const address = ipv4Of(name);
  if (!address) throw new Error(`网卡 ${name} 没有可用的 IPv4 地址（是否还没连上 wifi？）`);
  return { iface: name, address };
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

interface PortalContext {
  base: string;
  queryString: string;
  indexUrl: string;
  interfaceUrl: string;
  successUrl: string;
}

function buildContext(target: string, base: string): PortalContext {
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    throw new Error(`无法解析门户跳转地址：${target}`);
  }
  const cleanBase = `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  const queryString = url.search.replace(/^\?/, "");
  return {
    base: cleanBase,
    queryString,
    indexUrl: `${cleanBase}${PORTAL_INDEX_PATH}?${queryString}`,
    interfaceUrl: `${cleanBase}${PORTAL_INTERFACE_PATH}`,
    successUrl: `${cleanBase}${PORTAL_SUCCESS_PATH}`,
  };
}

function extractTokens(queryString: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryString)) tokens[key] = value;
  return tokens;
}

interface ProbeOutcome {
  kind: "portal" | "none" | "error";
  target?: string;
  detectedBy?: "location" | "script";
  status?: number;
  location?: string;
  error?: string;
}

/** 探测一次：既看 3xx 的 Location，也看 200 页面里插的 JS 跳转。 */
async function probeOnce(
  transport: SessionTransport,
  probeUrl: string,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  let response: Awaited<ReturnType<SessionTransport["request"]>>;
  try {
    response = await transport.request<ArrayBuffer>({
      url: probeUrl,
      method: "GET",
      responseType: "buffer",
      omitCookies: true,
      timeout: timeoutMs,
    });
  } catch (error) {
    return { kind: "error", error: error instanceof Error ? error.message : String(error) };
  }

  const location = firstHeader(response.headers, "location");
  if (location && location.toLowerCase().includes(EPORTAL_MARK)) {
    return { kind: "portal", target: location, detectedBy: "location", status: response.status };
  }

  const text = decodeBody(response.data, firstHeader(response.headers, "content-type"));
  const scriptTarget = parseEportalRedirect(text, probeUrl);
  if (scriptTarget) {
    return { kind: "portal", target: scriptTarget, detectedBy: "script", status: response.status };
  }
  return { kind: "none", status: response.status, location };
}

interface CaptureRecord {
  version: number;
  capturedAt: string;
  interface: string;
  localAddress?: string;
  probeUrl: string;
  detectedBy: "location" | "script";
  redirect: string;
  portal: PortalContext;
  tokens: Record<string, string>;
}

function writeCapture(file: string, record: CaptureRecord): void {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
}

function loadCredentials(options: CliOptions): { username?: string; password?: string } {
  let username = options.username;
  let password = options.password;
  if ((!username || !password) && fs.existsSync(options.configFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(options.configFile, "utf-8")) as {
        username?: string;
        password?: string;
      };
      username ??= data.username;
      password ??= data.password;
    } catch {
      /* 配置损坏时交给下面的报错处理 */
    }
  }
  return { username, password };
}

function summarize(record: CaptureRecord): string {
  return [
    "✅ 抓到校园网门户：",
    `   门户：    ${record.portal.base}`,
    `   探测方式：${record.detectedBy === "location" ? "Location 3xx 跳转" : "页面 JS 跳转"}`,
    `   本机网卡：${record.interface} (${record.localAddress})`,
    `   query：   ${record.portal.queryString}`,
    `   tokens：  ${Object.keys(record.tokens).join(", ")}`,
  ].join("\n");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const timedOut = (): boolean =>
    options.durationMs > 0 && Date.now() - startedAt >= options.durationMs;

  write("校园网门户抓取启动。");
  write("提示：请保持本脚本运行，然后再连接 HUST_WIRELESS（务必在浏览器认证之前）。");

  // 1) 先确定网卡：默认等一张已经拿到 IPv4 的无线网卡，绝不回退到 docker0/FlClash。
  let choice: InterfaceChoice | undefined;
  if (options.iface) {
    choice = requireInterface(options.iface);
  } else {
    let waited = 0;
    while (!choice) {
      choice = findWireless();
      if (choice) break;
      if (waited % 5 === 0) {
        write("· 尚无带 IPv4 的无线网卡，等待连接 HUST_WIRELESS…");
      }
      if (options.once) {
        write("--once：当前没有可用无线网卡，退出。");
        process.exit(2);
      }
      if (timedOut()) {
        write(`已达到 --duration 上限（${options.durationMs / 1000}s），未连上无线。`);
        process.exit(2);
      }
      waited += 1;
      await sleep(options.intervalMs);
    }
  }

  write(`使用网卡：${choice.iface} (${choice.address})，探测：${options.probeUrls.join(" , ")}`);

  const session = new Session();
  const transport = new SessionTransport(session, { localAddress: choice.address });

  let lastSignature: string | undefined;
  let captured = false;
  let saved = 0;
  let poll = 0;

  const stop = (): void => {
    write("\n已停止。");
    process.exit(captured ? 0 : 130);
  };
  process.on("SIGINT", stop);

  // 2) 轮询探测地址，抓 NAS 的劫持跳转。
  while (true) {
    poll += 1;
    const heartbeat = poll === 1 || poll % 5 === 0;
    let found = false;

    for (const probeUrl of options.probeUrls) {
      const outcome = await probeOnce(transport, probeUrl, options.timeoutMs);

      if (outcome.kind === "portal" && outcome.target) {
        found = true;
        const portal = buildContext(outcome.target, probeUrl);
        const record: CaptureRecord = {
          version: 1,
          capturedAt: new Date().toISOString(),
          interface: choice.iface,
          localAddress: choice.address,
          probeUrl,
          detectedBy: outcome.detectedBy ?? "script",
          redirect: outcome.target,
          portal,
          tokens: extractTokens(portal.queryString),
        };

        const signature = `${portal.base}?${portal.queryString}`;
        const changed = signature !== lastSignature;
        lastSignature = signature;
        captured = true;

        if (changed) {
          if (!options.json) {
            if (saved > 0) write("—— 门户发生变化 ——");
            write(summarize(record));
          }
          if (options.save) {
            writeCapture(options.out, record);
            if (!options.json) write(`   已写入：  ${path.resolve(options.out)}`);
          }
          if (options.json) write(JSON.stringify(record, null, 2));
          saved += 1;
        }

        if (options.login) {
          const { username, password } = loadCredentials(options);
          if (!username || !password) {
            writeErr(`✗ --login 需要账号密码：请提供 --user/--pass 或 ${options.configFile}`);
            process.exit(1);
          }
          write("正在登录以获取权威 userIndex …");
          const client = auth({
            username,
            password,
            portal: portal.base,
            queryString: portal.queryString,
            localAddress: choice.address,
            timeoutMs: options.timeoutMs,
          });
          const result = await client.login();
          write(`   学号：     ${username}`);
          write(`   userIndex：${result.userIndex ?? "(门户未返回)"}`);
          if (options.logout) {
            await client.logout();
            write("   已下线（若服务端拒绝，本地会话也已清除）。");
          }
        }

        if (!options.watch) return;
        break;
      }

      if (!options.json && heartbeat) {
        if (outcome.kind === "error") {
          write(`· ${probeUrl} 探测失败：${outcome.error}`);
        } else {
          write(
            `· 未发现劫持（HTTP ${outcome.status ?? "?"}）——可能已认证，继续等待…` +
              (outcome.location ? ` Location=${outcome.location}` : ""),
          );
        }
      }
    }

    if (options.once) {
      if (!found) write("本次未抓到门户（此刻大概率已认证）。");
      return;
    }

    if (timedOut()) {
      write(`已达到 --duration 上限（${options.durationMs / 1000}s），未抓到门户。`);
      process.exit(captured ? 0 : 2);
    }

    await sleep(options.intervalMs);
  }
}

main().catch((error) => {
  writeErr(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
