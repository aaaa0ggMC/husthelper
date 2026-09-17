// 把 aggregate 各资源的输出按隐私等级裁剪成可安全进入模型上下文的形状。
//
// 设计原则跟 ledger 一致：
//   * 金额、时间、分类、课程、成绩这类「语义本身」保留 —— 遮掉它模型就没法帮忙；
//   * 姓名/学号/卡号/手机号/邮箱/商户名/IP 这类「可定位到人」的字段确定性打码；
//   * 原始对象（raw/rawHtml）与可能带 SSO token 的链接只在 raw 等级出现；
//   * count 等级只回数量与合计，不给条目。

import type { Level } from "./privacy.ts";
import { maskAccount, maskEmail, maskId, maskIp, maskPhone, maskText } from "./privacy.ts";

export interface ShapeOptions {
  includeSensitive?: boolean;
}

export interface ShapeResult {
  value: unknown;
  /** 本次逐条披露的条目数（用于会话预算） */
  count: number;
  /** 因敏感而被隐藏的条目数 */
  hiddenSensitive: number;
}

/** redacted 下整个 key 直接消失的字段：原始对象、HTML、可能带 token 的链接 */
const DROP_KEYS = new Set([
  "raw",
  "rawHtml",
  "ssoUrl",
  "url",
  "viewUrl",
  "VIEW_URL",
  "ZWURL",
  "active_URL",
  "remark",
]);

const SENSITIVE_PATTERN =
  /医院|药房|药店|诊所|卫生|医疗|体检|心理|牙科|眼科|急诊|挂号|康复|门诊|住院|保险|hospital|pharmacy|clinic|medical/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deepOmit(value: unknown, drop: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => deepOmit(item, drop));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (drop.has(key)) continue;
      out[key] = deepOmit(item, drop);
    }
    return out;
  }
  return value;
}

function maskFields(
  value: Record<string, unknown>,
  fields: Record<string, (input: unknown) => unknown>,
): Record<string, unknown> {
  for (const [key, fn] of Object.entries(fields)) {
    if (key in value && value[key] !== undefined) value[key] = fn(value[key]);
  }
  return value;
}

/* ------------------------------ 单条形状 ------------------------------ */

function redactTransaction(record: unknown): Record<string, unknown> {
  const tx = (isRecord(record) ? deepOmit(record, DROP_KEYS) : { value: record }) as Record<
    string,
    unknown
  >;
  return maskFields(tx, {
    mercname: maskText,
    mercacc: maskAccount,
    account: maskAccount,
    acctname: maskText,
    acctno: maskAccount,
    cardno: maskAccount,
  });
}

function redactTransactionRaw(record: unknown): unknown {
  return record;
}

export function isSensitiveTransaction(record: unknown): boolean {
  if (!isRecord(record)) return false;
  return SENSITIVE_PATTERN.test(
    `${record.mercname ?? ""} ${record.tranname ?? ""} ${record.remark ?? ""}`,
  );
}

function redactLesson(lesson: unknown): unknown {
  if (!isRecord(lesson)) return lesson;
  const clean = deepOmit(lesson, DROP_KEYS) as Record<string, unknown>;
  if (clean.teacherName !== undefined) clean.teacherName = maskText(clean.teacherName);
  return clean;
}

function redactEmail(value: unknown): Record<string, unknown> {
  const clean = deepOmit(value, DROP_KEYS) as Record<string, unknown>;
  return maskFields(clean, {
    address: maskEmail,
    fullName: maskText,
    alias: maskText,
    userAlia: maskText,
  });
}

function redactMe(value: unknown): Record<string, unknown> {
  const clean = deepOmit(value, DROP_KEYS) as Record<string, unknown>;
  return maskFields(clean, {
    name: maskText,
    studentId: maskId,
    cardAccount: maskAccount,
    bankCard: maskAccount,
    mobile: maskPhone,
    email: maskEmail,
    puid: maskId,
  });
}

function redactDevice(device: unknown): unknown {
  if (!isRecord(device)) return device;
  const clean = deepOmit(device, DROP_KEYS) as Record<string, unknown>;
  return maskFields(clean, { userIpv4: maskIp, userIpv6: maskIp });
}

function maskAuthor(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.author !== undefined) value.author = maskText(value.author);
  return value;
}

/* ------------------------------ 各资源形状 ------------------------------ */

function sumTransactions(records: unknown[]): number | undefined {
  let sum = 0;
  let found = false;
  for (const record of records) {
    if (!isRecord(record)) continue;
    const raw = record.sign_tranamt ?? record.tranamt;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      sum += n / 100;
      found = true;
    }
  }
  return found ? Number(sum.toFixed(2)) : undefined;
}

function shapeTransactions(value: unknown, level: Level, options: ShapeOptions): ShapeResult {
  const page = isRecord(value) ? value : {};
  const all = asArray(page.records);

  let visible = all;
  let hiddenSensitive = 0;
  if (!options.includeSensitive) {
    visible = all.filter((record) => !isSensitiveTransaction(record));
    hiddenSensitive = all.length - visible.length;
  }

  if (level === "count") {
    return {
      value: {
        total: page.total ?? all.length,
        pageSize: page.pageSize ?? 0,
        count: visible.length,
        sum: sumTransactions(visible),
        sources: page.sources ?? [],
      },
      count: 0,
      hiddenSensitive,
    };
  }

  const records = level === "raw" ? visible.map(redactTransactionRaw) : visible.map(redactTransaction);
  return {
    value: {
      records,
      total: page.total ?? all.length,
      pageSize: page.pageSize ?? 0,
      nextPage: page.nextPage ?? null,
      sources: page.sources ?? [],
    },
    count: visible.length,
    hiddenSensitive,
  };
}

function shapeMe(value: unknown, level: Level): ShapeResult {
  if (!isRecord(value)) return { value, count: 0, hiddenSensitive: 0 };
  if (level === "count") {
    return {
      value: { present: true, sources: value.sources ?? [] },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  return {
    value: level === "raw" ? value : redactMe(value),
    count: 0,
    hiddenSensitive: 0,
  };
}

function shapeFlat(value: unknown, level: Level): ShapeResult {
  if (!isRecord(value)) return { value, count: 0, hiddenSensitive: 0 };
  return {
    value: level === "raw" ? value : (deepOmit(value, DROP_KEYS) as Record<string, unknown>),
    count: 0,
    hiddenSensitive: 0,
  };
}

function shapeSchedule(value: unknown, level: Level): ShapeResult {
  const schedule = isRecord(value) ? value : {};
  const lessons = asArray(schedule.lessons);
  if (level === "count") {
    return {
      value: {
        schoolYear: schedule.schoolYear,
        semester: schedule.semester,
        currentWeek: schedule.currentWeek,
        realCurrentWeek: schedule.realCurrentWeek,
        maxWeek: schedule.maxWeek,
        lessonCount: lessons.length,
        sources: schedule.sources ?? [],
      },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  const shaped = deepOmit(schedule, DROP_KEYS) as Record<string, unknown>;
  shaped.lessons = level === "raw" ? lessons : lessons.map(redactLesson);
  return { value: shaped, count: lessons.length, hiddenSensitive: 0 };
}

function shapeToday(value: unknown, level: Level): ShapeResult {
  const today = isRecord(value) ? value : {};
  const lessons = asArray(today.lessons);
  const activities = asArray(today.activities);
  if (level === "count") {
    return {
      value: {
        date: today.date,
        currentWeek: today.currentWeek,
        lessonCount: lessons.length,
        activityCount: activities.length,
        sources: today.sources ?? [],
      },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  const shaped = deepOmit(today, DROP_KEYS) as Record<string, unknown>;
  shaped.lessons = level === "raw" ? lessons : lessons.map(redactLesson);
  return { value: shaped, count: lessons.length + activities.length, hiddenSensitive: 0 };
}

function shapeCourses(value: unknown, level: Level): ShapeResult {
  const courses = isRecord(value) ? value : {};
  const all = asArray(courses.all);
  if (level === "count") {
    return {
      value: {
        enrolled: asArray(courses.enrolled).length,
        teaching: asArray(courses.teaching).length,
        online: asArray(courses.online).length,
        total: all.length,
        sources: courses.sources ?? [],
      },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  const shaped =
    level === "raw" ? courses : (deepOmit(courses, DROP_KEYS) as Record<string, unknown>);
  return { value: shaped, count: all.length, hiddenSensitive: 0 };
}

function shapeGrades(value: unknown, level: Level): ShapeResult {
  const grades = isRecord(value) ? value : {};
  const current = isRecord(grades.current) ? grades.current : undefined;
  const courseList = asArray(current?.courses);
  if (level === "count") {
    return {
      value: {
        terms: grades.terms ?? [],
        courseCount: courseList.length,
        summary: current?.summary,
        weightedScore: isRecord(current?.computed) ? current.computed.weightedScore : undefined,
        sources: grades.sources ?? [],
      },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  const shaped =
    level === "raw" ? grades : (deepOmit(grades, DROP_KEYS) as Record<string, unknown>);
  return { value: shaped, count: courseList.length, hiddenSensitive: 0 };
}

function shapeNotifications(value: unknown, level: Level): ShapeResult {
  const items = asArray(value);
  if (level === "count") {
    return { value: { count: items.length }, count: 0, hiddenSensitive: 0 };
  }
  const shaped = level === "raw" ? items : items.map((item) => maskAuthor(deepOmit(item, DROP_KEYS)));
  return { value: shaped, count: items.length, hiddenSensitive: 0 };
}

function shapeDocuments(value: unknown, level: Level): ShapeResult {
  const items = asArray(value);
  if (level === "count") {
    return { value: { count: items.length }, count: 0, hiddenSensitive: 0 };
  }
  const shaped = level === "raw" ? items : items.map((item) => deepOmit(item, DROP_KEYS));
  return { value: shaped, count: items.length, hiddenSensitive: 0 };
}

function shapeActivities(value: unknown, level: Level): ShapeResult {
  const items = asArray(value);
  if (level === "count") {
    return { value: { count: items.length }, count: 0, hiddenSensitive: 0 };
  }
  const shaped = level === "raw" ? items : items.map((item) => deepOmit(item, DROP_KEYS));
  return { value: shaped, count: items.length, hiddenSensitive: 0 };
}

function shapeDevices(value: unknown, level: Level): ShapeResult {
  // aggregate 里是 { devices, sources, raw }，而 overview 直接给 OnlineDevice[]。
  if (Array.isArray(value)) {
    const list = value;
    if (level === "count") return { value: { count: list.length }, count: 0, hiddenSensitive: 0 };
    const shaped = level === "raw" ? list : list.map(redactDevice);
    return { value: shaped, count: list.length, hiddenSensitive: 0 };
  }

  const devices = isRecord(value) ? value : {};
  const list = asArray(devices.devices);
  if (level === "count") {
    return {
      value: { count: list.length, sources: devices.sources ?? [] },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  const shaped = deepOmit(devices, DROP_KEYS) as Record<string, unknown>;
  shaped.devices = level === "raw" ? list : list.map(redactDevice);
  return { value: shaped, count: list.length, hiddenSensitive: 0 };
}

function shapeEmail(value: unknown, level: Level): ShapeResult {
  if (!isRecord(value)) return { value, count: 0, hiddenSensitive: 0 };
  if (level === "count") {
    return {
      value: { unread: value.unread, hasAddress: Boolean(value.address), sources: value.sources ?? [] },
      count: 0,
      hiddenSensitive: 0,
    };
  }
  return {
    value: level === "raw" ? value : redactEmail(value),
    count: 0,
    hiddenSensitive: 0,
  };
}

const OVERVIEW_FIELDS = ["me", "balance", "term", "today", "email"] as const;
const OVERVIEW_LISTS = ["notifications", "devices"] as const;

function shapeOverview(value: unknown, level: Level, options: ShapeOptions): ShapeResult {
  const overview = isRecord(value) ? value : {};
  const out: Record<string, unknown> = {};
  let count = 0;
  let hiddenSensitive = 0;

  for (const field of OVERVIEW_FIELDS) {
    if (overview[field] === undefined) continue;
    const shaped = shapeResource(field, overview[field], level, options);
    out[field] = shaped.value;
    count += shaped.count;
    hiddenSensitive += shaped.hiddenSensitive;
  }
  for (const field of OVERVIEW_LISTS) {
    if (overview[field] === undefined) continue;
    const shaped = shapeResource(field, overview[field], level, options);
    out[field] = shaped.value;
    count += shaped.count;
    hiddenSensitive += shaped.hiddenSensitive;
  }
  if (overview.sources) out.sources = overview.sources;
  if (overview.errors) out.errors = overview.errors;
  return { value: out, count, hiddenSensitive };
}

/* -------------------------------- 入口 -------------------------------- */

export type AggregateToolResource =
  | "overview"
  | "me"
  | "balance"
  | "term"
  | "today"
  | "schedule"
  | "grades"
  | "courses"
  | "notifications"
  | "documents"
  | "activities"
  | "devices"
  | "email"
  | "transactions";

export function shapeResource(
  resource: string,
  value: unknown,
  level: Level,
  options: ShapeOptions = {},
): ShapeResult {
  switch (resource) {
    case "transactions":
      return shapeTransactions(value, level, options);
    case "me":
      return shapeMe(value, level);
    case "schedule":
      return shapeSchedule(value, level);
    case "today":
      return shapeToday(value, level);
    case "courses":
      return shapeCourses(value, level);
    case "grades":
      return shapeGrades(value, level);
    case "notifications":
      return shapeNotifications(value, level);
    case "documents":
      return shapeDocuments(value, level);
    case "activities":
      return shapeActivities(value, level);
    case "devices":
      return shapeDevices(value, level);
    case "email":
      return shapeEmail(value, level);
    case "overview":
      return shapeOverview(value, level, options);
    case "balance":
    case "term":
    default:
      return shapeFlat(value, level);
  }
}
