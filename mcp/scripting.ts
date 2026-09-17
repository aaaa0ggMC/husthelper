import { getClient } from "./context.ts";
import type { Privacy } from "./privacy.ts";
import { shapeResource } from "./shape.ts";

export interface ScriptRunResult {
  success: boolean;
  result?: any;
  logs: string[];
  executionTimeMs: number;
  error?: string;
}

export async function runScript(privacy: Privacy, code: string, options: { level?: string, includeSensitive?: boolean } = {}): Promise<ScriptRunResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  const customConsole = {
    log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ")),
    info: (...args: any[]) => logs.push("[INFO] " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ")),
    warn: (...args: any[]) => logs.push("[WARN] " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ")),
    error: (...args: any[]) => logs.push("[ERROR] " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ")),
  };

  const level = privacy.resolveLevel(options.level);
  const includeSensitive = options.includeSensitive === true;
  if (includeSensitive) privacy.allowSensitive(level, true);

  const rawClient = getClient();

  // Create a wrapped client that shapes the data before returning it to the script
  const wrappedClient = {
    aggregate: new Proxy(rawClient.aggregate, {
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig === 'function') {
          return async (...args: any[]) => {
            const rawData = await orig.apply(target, args);
            // Resource name is roughly the prop name, or 'unknown' for loads
            const resourceName = prop === 'load' ? String(args[0]) : String(prop);
            const shaped = shapeResource(resourceName, rawData, level, { includeSensitive });
            privacy.consume(level, shaped.count);
            return shaped.value;
          };
        }
        // If it's a promise/getter (like aggregate.me), we evaluate and shape it
        if (orig && typeof orig.then === 'function') {
          return orig.then((rawData: any) => {
            const shaped = shapeResource(String(prop), rawData, level, { includeSensitive });
            privacy.consume(level, shaped.count);
            return shaped.value;
          });
        }
        return orig;
      }
    })
  };

  const scope = {
    client: wrappedClient,
    hust: wrappedClient, // alias
    level,
    console: customConsole
  };

  const scopeKeys = Object.keys(scope);
  const scopeValues = Object.values(scope);

  const trimmedCode = code.trim();
  let fnBody: string;
  if (!trimmedCode.includes("return ") && !trimmedCode.includes("const ") && !trimmedCode.includes("let ") && !trimmedCode.includes("var ")) {
    fnBody = `return (async () => { return (${trimmedCode}); })()`;
  } else if (!trimmedCode.includes("return ")) {
    fnBody = `return (async () => { ${trimmedCode} })()`;
  } else {
    fnBody = `return (async () => { ${trimmedCode} })()`;
  }

  try {
    const compiledFn = new Function(...scopeKeys, fnBody);
    const rawResult = await compiledFn(...scopeValues);
    return {
      success: true,
      result: rawResult !== undefined ? rawResult : (logs.length > 0 ? logs.join("\n") : "Script executed successfully with no return value"),
      logs,
      executionTimeMs: Date.now() - startTime
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err),
      logs,
      executionTimeMs: Date.now() - startTime
    };
  }
}

export function scriptingMan(options: { query?: string, method?: string } = {}) {
  const docs = [
    { method: "client.aggregate.overview()", desc: "获取本人信息的综合概览" },
    { method: "client.aggregate.me", desc: "获取本人身份信息（姓名、学号等）" },
    { method: "client.aggregate.balance", desc: "获取校园卡/网费/电子账户余额" },
    { method: "client.aggregate.term", desc: "获取当前教学周与学期信息" },
    { method: "client.aggregate.today", desc: "获取今天的课表与日程" },
    { method: "client.aggregate.schedule", desc: "获取本学期完整课表" },
    { method: "client.aggregate.load('grades', { xn, xq })", desc: "获取成绩，xn: 学年(如2025)，xq: 学期(1,2)" },
    { method: "client.aggregate.courses", desc: "获取我的课程列表" },
    { method: "client.aggregate.load('notifications', { pageSize, type })", desc: "获取通知列表" },
    { method: "client.aggregate.load('documents', { pageSize })", desc: "获取校园公文/新闻" },
    { method: "client.aggregate.load('activities', { beginDate, endDate, activityType })", desc: "获取日程活动" },
    { method: "client.aggregate.devices", desc: "获取当前在线的校园网设备" },
    { method: "client.aggregate.load('transactions', { page })", desc: "获取一卡通流水（分页）" },
    { method: "client.aggregate.email", desc: "获取校园邮箱信息" },
  ];

  if (options.method) {
    return docs.filter(d => d.method.includes(options.method!));
  }
  if (options.query) {
    const q = options.query.toLowerCase();
    return docs.filter(d => d.method.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q));
  }
  return {
    title: "HustHelper Scripting API",
    tip: "Available methods on 'client.aggregate'. Privacy rules (count/redacted/raw) are automatically enforced based on the requested level.",
    docs
  };
}
