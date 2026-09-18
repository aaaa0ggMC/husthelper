import { getClient } from "./context.ts";
import type { Level, Privacy } from "./privacy.ts";
import { shapeResource } from "./shape.ts";

export interface ScriptRunResult {
  success: boolean;
  result?: any;
  logs: string[];
  executionTimeMs: number;
  error?: string;
}

export function compileScript(
  code: string,
  scopeKeys: string[],
): (...args: unknown[]) => Promise<unknown> {
  const trimmed = code.trim();
  try {
    return new Function(...scopeKeys, `return (async () => (${trimmed}))()`) as (
      ...args: unknown[]
    ) => Promise<unknown>;
  } catch {
    return new Function(...scopeKeys, `return (async () => { ${trimmed} })()`) as (
      ...args: unknown[]
    ) => Promise<unknown>;
  }
}

export function wrapAggregate<T extends object>(
  aggregate: T,
  privacy: Privacy,
  level: Level,
  includeSensitive: boolean,
): T {
  return new Proxy(aggregate, {
    get(target, prop) {
      const orig = Reflect.get(target, prop);
      if (typeof orig === "function") {
        return async (...args: any[]) => {
          const rawData = await orig.apply(target, args);
          const resourceName = prop === "load" ? String(args[0]) : String(prop);
          const shaped = shapeResource(resourceName, rawData, level, { includeSensitive });
          privacy.consume(level, shaped.count);
          return shaped.value;
        };
      }
      const thenable = orig as unknown as Promise<unknown> | undefined;
      if (thenable && typeof thenable.then === "function") {
        return thenable.then((rawData) => {
          const shaped = shapeResource(String(prop), rawData, level, { includeSensitive });
          privacy.consume(level, shaped.count);
          return shaped.value;
        });
      }
      return orig;
    },
  }) as T;
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
    aggregate: wrapAggregate(rawClient.aggregate, privacy, level, includeSensitive),
  };

  const scope = {
    client: wrappedClient,
    hust: wrappedClient, // alias
    level,
    console: customConsole
  };

  const scopeKeys = Object.keys(scope);
  const scopeValues = Object.values(scope);

  try {
    const compiledFn = compileScript(code, scopeKeys);
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
    { method: "client.aggregate.exams", desc: "获取考试安排（当前学期）" },
    { method: "client.aggregate.load('exams', { xqh, kslx, kcmc })", desc: "考试安排，kslx: 0补(缓)考/1普通" },
    { method: "client.aggregate.load('freeRooms', { building, date, startPeriod, endPeriod })", desc: "查询空闲教室，building 为教学楼编号如 C050" },
    { method: "client.aggregate.fitness", desc: "获取体质测试成绩" },
    { method: "client.aggregate.load('fitness', { periodId })", desc: "指定学期的体测成绩" },
    { method: "client.aggregate.credit", desc: "获取第二课堂学分汇总" },
    { method: "client.aggregate.registration", desc: "获取学期注册状态与当前学期" },
    { method: "client.aggregate.reserves", desc: "获取场馆预约记录" },
    { method: "client.aggregate.peCourses", desc: "获取已修/已选体育课" },
    { method: "client.aggregate.exercise", desc: "获取课外锻炼次数（最新学期）" },
    { method: "client.aggregate.load('exercise', { xqh })", desc: "指定学期的课外锻炼次数" },
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
