// 读取审计：记录「谁在什么时候、以什么等级、读了多少条、用了什么筛选」，
// 不记录内容本身（内容会进日志、进云端，那正是隐私模型要避免的）。

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface AuditRecord {
  session: string;
  tool: string;
  resource: string;
  level: string;
  count: number;
  hiddenSensitive?: number;
  args?: Record<string, unknown>;
}

export function auditPath(dir: string): string {
  return join(dir, "audit.jsonl");
}

export function appendAudit(dir: string, record: AuditRecord): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(
      auditPath(dir),
      `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* 审计失败不该影响主流程 */
  }
}
