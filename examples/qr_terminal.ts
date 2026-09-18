import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

/** 二维码展示方式：auto=支持图片协议的终端内联显示，否则存文件；image/file 为显式强制 */
export type QrDisplayMode = "auto" | "image" | "file";

/**
 * 解析展示方式，优先级：命令行 > 环境变量 HUST_QR_MODE > auto。
 * 传入 `--file` 强制写文件，`--image` 强制尝试内联图片。
 */
export function resolveQrDisplayMode(argv: string[] = process.argv.slice(2)): QrDisplayMode {
  if (argv.includes("--file")) return "file";
  if (argv.includes("--image")) return "image";
  const env = (process.env.HUST_QR_MODE ?? "").trim().toLowerCase();
  if (env === "file" || env === "image") return env;
  return "auto";
}

type ImageProtocol = "iterm2" | "kitty";

/** 依据环境变量判断终端支持的图片协议（不识别 Sixel，统一回退到文件） */
function detectImageProtocol(): ImageProtocol | null {
  const env = process.env;
  const term = (env.TERM ?? "").toLowerCase();
  const program = (env.TERM_PROGRAM ?? "").toLowerCase();

  if (env.KITTY_WINDOW_ID || term.includes("kitty") || program === "ghostty") return "kitty";
  // Konsole ≥ 22.08 支持 Kitty 图形协议，通过 KONSOLE_VERSION(如 220800 / 260800) 识别
  if (env.KONSOLE_VERSION) {
    const version = Number(env.KONSOLE_VERSION);
    if (!Number.isFinite(version) || version >= 220800) return "kitty";
  }
  if (env.ITERM_SESSION_ID || program === "iterm.app" || program === "wezterm") return "iterm2";
  return null;
}

/** iTerm2 / WezTerm 的 OSC 1337 内联图片协议 */
function printIterm2(png: Buffer, name: string): void {
  const encoded = png.toString("base64");
  const encodedName = Buffer.from(name, "utf-8").toString("base64");
  process.stdout.write(
    `\x1b]1337;File=name=${encodedName};size=${png.length};inline=1;width=40;preserveAspectRatio=1:${encoded}\x07\n`,
  );
}

/** Kitty / Ghostty 的图形协议（分块传输并直接显示） */
function printKitty(png: Buffer): void {
  const encoded = png.toString("base64");
  const chunkSize = 4096;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    const more = offset + chunkSize < encoded.length ? 1 : 0;
    const control = offset === 0 ? `a=T,f=100,c=40,r=20,q=2,m=${more}` : `m=${more}`;
    process.stdout.write(`\x1b_G${control};${chunk}\x1b\\`);
  }
  process.stdout.write("\n");
}

export interface QrDisplayOptions {
  mode?: QrDisplayMode;
  /** 回退到文件时的输出路径，默认当前目录 .hust-cas-qrcode.png */
  file?: string;
  /** PNG 尺寸（像素），默认 512 */
  width?: number;
}

/**
 * 展示二维码：终端支持图片协议（iTerm2/WezTerm、Kitty/Ghostty、Konsole）时直接内联显示；
 * 否则写入 PNG 文件。返回写入的文件路径（内联显示时返回 undefined）。
 */
export async function displayQrCode(
  content: string,
  options: QrDisplayOptions = {},
): Promise<string | undefined> {
  const mode = options.mode ?? "auto";
  const png = await QRCode.toBuffer(content, {
    type: "png",
    width: options.width ?? 512,
    margin: 2,
  });

  const protocol = detectImageProtocol();
  const canInline = process.stdout.isTTY === true && protocol !== null;
  const useImage = mode === "image" || (mode === "auto" && canInline);

  if (useImage && canInline && protocol === "iterm2") {
    printIterm2(png, "hust-cas-qrcode.png");
    return undefined;
  }
  if (useImage && canInline && protocol === "kitty") {
    printKitty(png);
    return undefined;
  }

  const file = path.resolve(options.file ?? ".hust-cas-qrcode.png");
  fs.writeFileSync(file, png);
  return file;
}
