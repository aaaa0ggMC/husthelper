import fs from "node:fs";
import path from "node:path";
import type { AIConfig } from "../hustpass/index.ts";

export interface ExampleConfig {
  un: string;
  pwd: string;
  account?: string;
  openai: AIConfig;
  saveDebugImage?: boolean;
}

export function loadConfig(file: string = path.resolve(process.cwd(), "config.json")): ExampleConfig {
  if (!fs.existsSync(file)) {
    throw new Error(`找不到配置文件 ${file}，请先复制 config.example.json 为 config.json 并填写`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as ExampleConfig;
}
