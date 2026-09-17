#!/usr/bin/env node
// 隐私密钥管理：决定谁能看到原文（raw）。
//
//   node key.ts init    生成密钥（已存在则保留）
//   node key.ts show    查看当前密钥
//   node key.ts path    查看密钥文件路径
//   node key.ts rotate  轮换密钥（旧的 raw 权限立即失效）

import { dataDir, setActiveEnv } from "./context.ts";
import { loadConfigFile } from "./config.ts";
import { ensureKey, generateKey, keyPath, readStoredKey, storeKey } from "./privacy.ts";

const args = process.argv.slice(2);
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config" || args[i] === "-c") {
    const path = args[++i];
    if (path) setActiveEnv({ ...process.env, ...loadConfigFile(path) });
  } else {
    rest.push(args[i]);
  }
}

const command = rest[0] ?? "show";
const dir = dataDir();

switch (command) {
  case "init": {
    const { key, created } = ensureKey(dir);
    process.stdout.write(created ? `已生成密钥: ${key}\n` : `密钥已存在: ${key}\n`);
    break;
  }
  case "show": {
    const key = readStoredKey(dir);
    process.stdout.write(key ? `${key}\n` : "尚未生成密钥，先运行 `node key.ts init`\n");
    break;
  }
  case "path": {
    process.stdout.write(`${keyPath(dir)}\n`);
    break;
  }
  case "rotate": {
    const key = storeKey(dir, generateKey());
    process.stdout.write(`已轮换密钥: ${key}\n`);
    break;
  }
  default: {
    process.stderr.write(
      `未知命令: ${command}\n用法: node key.ts [init|show|path|rotate] [--config 配置文件]\n`,
    );
    process.exit(1);
  }
}
