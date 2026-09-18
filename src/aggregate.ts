import { formatBeijingDate, type OneHustApi, type NoticeQuery, type DocumentQuery, type ActivityQuery, type CampusNotice, type CampusDocument, type Activity, type Balance, type MyInfo, type EmailInfo, type LearnWeek } from "./one.ts";
import {
  NOTICE_TYPE,
  noticeItems,
  type SmartCourseApi,
  type LoginUser,
  type Lesson,
  type MyLessons,
  type Curriculum,
  type StudyCourse,
  type SmartCourseItem,
  type Notice as SmartCourseNotice,
  type CourseListResult,
} from "./smartcourse.ts";
import type { EcardApi, Transaction, TransactionPage, TransactionQuery } from "./ecard.ts";
import type {
  MhubApi,
  ExamSchedule,
  ExamPage,
  FreeRoom,
  FreeRoomResult,
} from "./mhub.ts";
import type { HkwxyApi, OnlineDevice } from "./hkwxy.ts";
import type { WechatApi } from "./wechat.ts";
import type { Profile } from "./profile.ts";
import type { Grades, GradeTerm } from "./grades.ts";
import type { PejxglApi, ExerciseEngagement, TakenCourse } from "./pejxgl.ts";
import type { PecgApi, VenueReserve } from "./pecg.ts";
import type { PetyxyApi, FitnessResult, FitnessItem } from "./petyxy.ts";
import type { RegisterApi, RegistrationSemester } from "./register.ts";
import type { IhusterApi, CreditSummaryRecord } from "./ihuster.ts";

/**
 * 聚合层 `client.aggregate`。
 *
 * 它**不持有任何 session/cookie/凭据**，只引用各命名空间 API：读取某个属性时，
 * 按 `AGGREGATE_SCHEMA` 并发调用多个来源，合并出最全面的结果。
 * 同一信息多来源时优先高优先级来源；全部来源失败才抛 `AggregateError`。
 */

/* ------------------------------ 依赖的根对象 ------------------------------ */

export interface AggregateRoot {
  readonly one: OneHustApi;
  readonly smartcourse: SmartCourseApi;
  readonly ecard: EcardApi;
  readonly mhub: MhubApi;
  readonly hkwxy: HkwxyApi;
  readonly wechat: WechatApi;
  readonly pejxgl: PejxglApi;
  readonly pecg: PecgApi;
  readonly petyxy: PetyxyApi;
  readonly register: RegisterApi;
  readonly ihuster: IhusterApi;
}

/* ------------------------------- 聚合输出类型 ------------------------------ */

export interface AggregateMe {
  name?: string;
  nickname?: string;
  studentId?: string;
  idType?: string;
  sex?: string;
  department?: string;
  identity?: string;
  workingPlace?: string;
  email?: string;
  mobile?: string;
  avatar?: string;
  isActive?: string;
  cardAccount?: string;
  bankCard?: string;
  puid?: number;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateBalance {
  schoolCard?: string;
  internetFees?: string;
  eWallet?: string;
  eWalletType?: string;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateNotification {
  id?: string;
  title?: string;
  content?: string;
  time?: string;
  isRead?: boolean;
  isTop?: boolean;
  category?: string;
  author?: string;
  source: string;
  raw: unknown;
}

export interface AggregateDocument {
  id?: string;
  title?: string;
  unit?: string;
  docNumber?: string;
  publishedAt?: string;
  uploadedAt?: string;
  url?: string;
  category?: string;
  isNew?: boolean;
  source: string;
  raw: unknown;
}

export type AggregateCourseRole = "study" | "teach" | "online";

export interface AggregateCourse {
  id?: string;
  name?: string;
  cover?: string;
  url?: string;
  credits?: string;
  hours?: string;
  role: AggregateCourseRole;
  source: string;
  raw: unknown;
}

export interface AggregateCourses {
  enrolled: AggregateCourse[];
  teaching: AggregateCourse[];
  online: AggregateCourse[];
  all: AggregateCourse[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateSchedule {
  schoolYear?: string;
  semester?: string;
  currentWeek?: number;
  realCurrentWeek?: number;
  maxWeek?: number;
  curriculum?: Curriculum;
  lessons: Lesson[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateActivity {
  id?: string;
  title?: string;
  begin?: number;
  end?: number;
  beginText?: string;
  endText?: string;
  allDay?: boolean;
  url?: string;
  source: string;
  raw: unknown;
}

export interface AggregateToday {
  /** `yyyy-MM-dd`（北京时间） */
  date: string;
  currentWeek?: number;
  lessons: Lesson[];
  activities: AggregateActivity[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateEmail {
  address?: string;
  ssoUrl?: string;
  alias?: string;
  fullName?: string;
  unread?: number;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateTerm {
  week?: number;
  /** 学期号，如 "20261" */
  semesterCode?: string;
  schoolYear?: string;
  semester?: string;
  maxWeek?: number;
  termName?: string;
  xn?: string;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateGrades {
  terms: GradeTerm[];
  current?: Grades;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateDevices {
  devices: OnlineDevice[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateTransactions {
  records: Transaction[];
  total: number;
  pageSize: number;
  nextPage: number | null;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateExams {
  /** 学期号，如 "20261" */
  semester?: string;
  exams: ExamSchedule[];
  total: number;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateFreeRooms {
  date?: string;
  /** 教学楼编号 */
  building?: string;
  rooms: FreeRoom[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateFitness {
  periodName?: string;
  status?: string;
  totalScore?: number;
  totalGrade?: string;
  items: FitnessItem[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateCredit {
  /** 总学分 */
  sumCredit?: string;
  /** 总次数 */
  sumCount?: string;
  records: CreditSummaryRecord[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateRegistration {
  registered?: boolean;
  status?: string;
  semester?: RegistrationSemester;
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateReserves {
  reserves: VenueReserve[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregatePeCourses {
  courses: TakenCourse[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateExercise {
  /** 学期号 */
  semester?: string;
  engagements: ExerciseEngagement[];
  sources: string[];
  raw: Record<string, unknown>;
}

export interface AggregateOverview {
  me?: AggregateMe;
  balance?: AggregateBalance;
  term?: AggregateTerm;
  today?: AggregateToday;
  email?: AggregateEmail;
  notifications: AggregateNotification[];
  devices: OnlineDevice[];
  sources: string[];
  errors: { resource: string; message: string }[];
}

/* -------------------------------- schema 类型 ------------------------------- */

export interface AggregatePart {
  readonly source: string;
  readonly value: unknown;
}

export interface AggregateLoadContext {
  readonly root: AggregateRoot;
  readonly now: Date;
  readonly args: Record<string, unknown>;
}

export interface AggregateMergeContext {
  readonly now: Date;
  readonly args: Record<string, unknown>;
}

export interface AggregateSource {
  /** 全局唯一标签，如 "one.myInfo" */
  readonly name: string;
  readonly load: (ctx: AggregateLoadContext) => Promise<unknown>;
  /** 可选：判断「有值但为空」 */
  readonly isEmpty?: (value: unknown) => boolean;
}

export interface AggregateResource<TOut> {
  readonly sources: readonly AggregateSource[];
  /** 需要参数的来源的默认参数，可被 `load(name, args)` 覆盖 */
  readonly defaultArgs?: (now: Date) => Record<string, unknown>;
  readonly merge: (parts: readonly AggregatePart[], ctx: AggregateMergeContext) => TOut;
}

export const AGGREGATE_LIMITS = {
  notifications: 20,
  documents: 20,
} as const;

/* -------------------------------- 工具函数 -------------------------------- */

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).toLowerCase();
  if (text === "0" || text === "false" || text === "no") return false;
  return true;
}

function fill<T extends object>(target: T, key: keyof T, value: unknown): void {
  if (present(value) && !present(target[key])) {
    (target as Record<string, unknown>)[key as string] = value;
  }
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "");
}

/** 北京时间的「当天 00:00」对应的真实时间戳 */
function beijingDayStartMs(now: Date): number {
  const fake = new Date(now.getTime() + 8 * 3600 * 1000);
  fake.setUTCHours(0, 0, 0, 0);
  return fake.getTime() - 8 * 3600 * 1000;
}

export function dayRange(now: Date): { beginDate: string; endDate: string } {
  const beginMs = beijingDayStartMs(now);
  return {
    beginDate: formatBeijingDate(beginMs),
    endDate: formatBeijingDate(beginMs + 86_400_000 - 1000),
  };
}

export function weekRange(now: Date): { beginDate: string; endDate: string } {
  const fake = new Date(now.getTime() + 8 * 3600 * 1000);
  fake.setUTCHours(0, 0, 0, 0);
  fake.setUTCDate(fake.getUTCDate() - ((fake.getUTCDay() + 6) % 7));
  const beginMs = fake.getTime() - 8 * 3600 * 1000;
  return {
    beginDate: formatBeijingDate(beginMs),
    endDate: formatBeijingDate(beginMs + 7 * 86_400_000 - 1000),
  };
}

/* ------------------------------- 归一化函数 ------------------------------- */

function toNotification(source: string, item: unknown): AggregateNotification {
  if (source === "one.notifications") {
    const n = item as CampusNotice;
    return {
      id: n.PIM_ID,
      title: n.PIM_TITLE,
      content: n.PIM_CONTENT,
      time: n.CREATE_TIME ?? n.TIME ?? n.DATE_TIME,
      isRead: toBool(n.IS_READ),
      isTop: toBool(n.IS_TOP),
      category: n.TYPE_NAME,
      author: n.BELONG_UNIT_NAME,
      source,
      raw: item,
    };
  }
  const n = item as SmartCourseNotice;
  const time =
    typeof n.insertTime === "number"
      ? new Date(n.insertTime).toISOString()
      : (n.insertTime ?? n.sendTime);
  return {
    id: n.idCode,
    title: n.title,
    content: n.content,
    time,
    isRead: toBool(n.isread),
    isTop: toBool(n.top),
    category: present(n.source) ? String(n.source) : undefined,
    author: n.createrName,
    source,
    raw: item,
  };
}

function toDocument(item: CampusDocument): AggregateDocument {
  return {
    id: item.FID,
    title: item.BT,
    unit: item.BMMC,
    docNumber: item.WH,
    publishedAt: item.FBSJ,
    uploadedAt: item.SCRQ,
    url: item.VIEW_URL ?? item.ZWURL,
    category: item.LX,
    isNew: toBool(item.IS_NEW),
    source: "one.documents",
    raw: item,
  };
}

function toActivity(source: string, item: Activity): AggregateActivity {
  return {
    id: item.cal_ID,
    title: item.tittle,
    begin: item.BEGINING_TIME,
    end: item.ENDING_TIME,
    beginText: item.begining_TIME,
    endText: item.ending_TIME,
    allDay: toBool(item.isAllDay),
    url: item.active_URL,
    source,
    raw: item,
  };
}

function courseKey(course: AggregateCourse): string {
  if (present(course.id)) return String(course.id);
  return course.name ? normalizeKey(course.name) : "";
}

/* -------------------------------- merge 逻辑 ------------------------------- */

function mergeMe(parts: readonly AggregatePart[]): AggregateMe {
  const out: AggregateMe = { sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as Record<string, unknown>;
    if (part.source === "one.myInfo") {
      fill(out, "name", value.USER_NAME);
      fill(out, "nickname", value.NICKNAME);
      fill(out, "studentId", value.ID_NUMBER);
      fill(out, "idType", value.ID_TYPE_NAME);
      fill(out, "sex", value.USER_SEX);
      fill(out, "department", value.UNIT_NAME);
      fill(out, "identity", value.ACTIVE_NAME);
      fill(out, "workingPlace", value.WORKING_PLACE);
      fill(out, "email", value.EMAIL);
      fill(out, "mobile", value.MOBILE);
      fill(out, "isActive", value.IS_ACTIVE);
    } else if (part.source === "ecard.profile") {
      const profile = part.value as Profile;
      fill(out, "name", profile.name);
      fill(out, "studentId", profile.id);
      fill(out, "department", profile.department);
      fill(out, "identity", profile.identity);
      fill(out, "isActive", profile.status);
      fill(out, "cardAccount", profile.cardAccount);
      fill(out, "bankCard", profile.bankCard);
    } else if (part.source === "smartcourse.loginUser") {
      const user = part.value as LoginUser;
      fill(out, "name", user.name);
      fill(out, "avatar", user.pic);
      if (present(user.puid) && !present(out.puid)) out.puid = user.puid;
    }
  }
  return out;
}

function mergeBalance(parts: readonly AggregatePart[]): AggregateBalance {
  const out: AggregateBalance = { sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "one.balance") {
      const balance = part.value as Balance;
      fill(out, "schoolCard", balance.SCHOOL_CARD);
      fill(out, "internetFees", balance.INTERNET_FEES);
    } else if (part.source === "ecard.profile") {
      const profile = part.value as Profile;
      fill(out, "schoolCard", profile.cardBalance);
      fill(out, "eWallet", profile.eWalletBalance);
      fill(out, "eWalletType", profile.eWalletType);
    }
  }
  return out;
}

function mergeNotifications(parts: readonly AggregatePart[]): AggregateNotification[] {
  const out: AggregateNotification[] = [];
  const index = new Map<string, AggregateNotification>();
  for (const part of parts) {
    const items = Array.isArray(part.value) ? (part.value as unknown[]) : [];
    for (const item of items) {
      const notification = toNotification(part.source, item);
      const key = notification.title ? normalizeKey(notification.title) : (notification.id ?? "");
      const existing = index.get(key);
      if (existing) {
        fill(existing, "content", notification.content);
        fill(existing, "time", notification.time);
        fill(existing, "category", notification.category);
        fill(existing, "author", notification.author);
        continue;
      }
      index.set(key, notification);
      out.push(notification);
    }
  }
  return out;
}

function mergeDocuments(parts: readonly AggregatePart[]): AggregateDocument[] {
  const out: AggregateDocument[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const items = Array.isArray(part.value) ? (part.value as CampusDocument[]) : [];
    for (const item of items) {
      const document = toDocument(item);
      const key = document.id ?? (document.title ? normalizeKey(document.title) : "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(document);
    }
  }
  return out;
}

function toCourse(role: AggregateCourseRole, item: SmartCourseItem, source: string): AggregateCourse {
  return {
    id: item.courseId,
    name: item.name,
    cover: item.imageUrl,
    url: item.url,
    role,
    source,
    raw: item,
  };
}

function toStudyCourse(item: StudyCourse, source: string): AggregateCourse {
  return {
    id: item.courseId,
    name: item.name,
    cover: item.cover,
    url: item.url,
    credits: item.credits,
    hours: item.hours,
    role: "online",
    source,
    raw: item,
  };
}

function dedupeCourses(items: AggregateCourse[]): AggregateCourse[] {
  const seen = new Set<string>();
  const out: AggregateCourse[] = [];
  for (const course of items) {
    const key = courseKey(course);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(course);
  }
  return out;
}

function mergeCourses(parts: readonly AggregatePart[]): AggregateCourses {
  const out: AggregateCourses = {
    enrolled: [],
    teaching: [],
    online: [],
    all: [],
    sources: [],
    raw: {},
  };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "smartcourse.courseList") {
      const result = part.value as CourseListResult;
      for (const item of result.study ?? []) out.enrolled.push(toCourse("study", item, part.source));
      for (const item of result.teach ?? []) out.teaching.push(toCourse("teach", item, part.source));
    } else if (part.source === "smartcourse.studyCourses") {
      for (const item of part.value as StudyCourse[]) out.online.push(toStudyCourse(item, part.source));
    }
  }
  out.enrolled = dedupeCourses(out.enrolled);
  out.teaching = dedupeCourses(out.teaching);
  out.online = dedupeCourses(out.online);

  const seen = new Set<string>();
  for (const course of [...out.enrolled, ...out.teaching, ...out.online]) {
    const key = courseKey(course);
    if (seen.has(key)) continue;
    seen.add(key);
    out.all.push(course);
  }
  return out;
}

function mergeSchedule(parts: readonly AggregatePart[]): AggregateSchedule {
  const out: AggregateSchedule = { lessons: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "smartcourse.myLessons") {
      const value = part.value as MyLessons;
      const curriculum = value.curriculum;
      out.curriculum = curriculum;
      if (curriculum) {
        fill(out, "schoolYear", curriculum.schoolYear);
        fill(out, "semester", curriculum.semester as string | undefined);
        fill(out, "currentWeek", curriculum.currentWeek);
        fill(out, "realCurrentWeek", curriculum.realCurrentWeek);
        fill(out, "maxWeek", curriculum.maxWeek);
      }
      out.lessons = value.lessonArray ?? [];
    }
  }
  return out;
}

function mergeActivities(parts: readonly AggregatePart[]): AggregateActivity[] {
  const out: AggregateActivity[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const items = Array.isArray(part.value) ? (part.value as Activity[]) : [];
    for (const item of items) {
      const activity = toActivity(part.source, item);
      const key = activity.id ?? `${normalizeKey(activity.title ?? "")}|${activity.begin ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(activity);
    }
  }
  return out;
}

function mergeToday(parts: readonly AggregatePart[], ctx: AggregateMergeContext): AggregateToday {
  const out: AggregateToday = {
    date: formatBeijingDate(ctx.now).slice(0, 10),
    lessons: [],
    activities: [],
    sources: [],
    raw: {},
  };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "smartcourse.oneDayLessons") {
      const value = part.value as { currentWeek?: number; lessonArray?: Lesson[]; lessons?: Lesson[] };
      fill(out, "currentWeek", value.currentWeek);
      out.lessons = value.lessonArray ?? value.lessons ?? [];
    } else if (part.source === "one.weekActivities") {
      out.activities = mergeActivities([part]);
    }
  }
  return out;
}

function mergeEmail(parts: readonly AggregatePart[]): AggregateEmail {
  const out: AggregateEmail = { sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "one.emailInfo") {
      const info = part.value as EmailInfo;
      fill(out, "address", info.FULL_EMAIL_NAME);
      fill(out, "ssoUrl", info.SSO_URL);
      fill(out, "alias", info.userAlia);
      fill(out, "fullName", info.FULL_EMAIL_NAME);
      if (present(info.UNREAD_EMAIL_NUM) && !present(out.unread)) out.unread = info.UNREAD_EMAIL_NUM;
    } else if (part.source === "one.myInfo") {
      const info = part.value as MyInfo;
      fill(out, "address", info.EMAIL);
      fill(out, "fullName", info.USER_NAME);
    }
  }
  return out;
}

function mergeTerm(parts: readonly AggregatePart[]): AggregateTerm {
  const out: AggregateTerm = { sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (part.source === "one.learnWeek") {
      const value = part.value as LearnWeek;
      if (present(value.ZC)) fill(out, "week", Number(value.ZC));
      fill(out, "semesterCode", value.XQH);
    } else if (part.source === "smartcourse.curriculum") {
      const value = part.value as Curriculum;
      if (present(value.currentWeek) && !present(out.week)) out.week = value.currentWeek;
      fill(out, "schoolYear", value.schoolYear);
      fill(out, "semester", value.semester as string | undefined);
      fill(out, "maxWeek", value.maxWeek);
    } else if (part.source === "mhub.terms") {
      const terms = part.value as GradeTerm[];
      fill(out, "termName", terms[0]?.XNMC);
      fill(out, "xn", terms[0]?.XN);
    }
  }
  return out;
}

function mergeGrades(parts: readonly AggregatePart[]): AggregateGrades {
  const out: AggregateGrades = { terms: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as { terms?: GradeTerm[]; current?: Grades };
    if (value.terms) out.terms = value.terms;
    if (value.current) out.current = value.current;
  }
  return out;
}

function mergeDevices(parts: readonly AggregatePart[]): AggregateDevices {
  const out: AggregateDevices = { devices: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (Array.isArray(part.value)) out.devices = part.value as OnlineDevice[];
  }
  return out;
}

function mergeTransactions(parts: readonly AggregatePart[]): AggregateTransactions {
  const out: AggregateTransactions = {
    records: [],
    total: 0,
    pageSize: 0,
    nextPage: null,
    sources: [],
    raw: {},
  };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (out.records.length === 0) {
      const page = part.value as TransactionPage;
      out.records = page.records ?? [];
      out.total = page.total ?? 0;
      out.pageSize = page.pageSize ?? 0;
      out.nextPage = page.nextPage ?? null;
    }
  }
  return out;
}

function mergeExams(parts: readonly AggregatePart[]): AggregateExams {
  const out: AggregateExams = { exams: [], total: 0, sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as { semester?: string; page?: ExamPage };
    fill(out, "semester", value.semester);
    out.exams = value.page?.list ?? [];
    out.total = value.page?.total ?? out.exams.length;
  }
  return out;
}

function mergeFreeRooms(parts: readonly AggregatePart[]): AggregateFreeRooms {
  const out: AggregateFreeRooms = { rooms: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as FreeRoomResult;
    fill(out, "date", value.borrowDate);
    fill(out, "building", value.jxlbh ?? value.building);
    out.rooms = value.dataList ?? [];
  }
  return out;
}

function mergeFitness(parts: readonly AggregatePart[]): AggregateFitness {
  const out: AggregateFitness = { items: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as FitnessResult;
    fill(out, "periodName", value.periodName);
    fill(out, "status", value.status);
    if (present(value.totalScore) && !present(out.totalScore)) out.totalScore = value.totalScore;
    fill(out, "totalGrade", value.totalGrade);
    out.items = value.items ?? [];
  }
  return out;
}

function mergeCredit(parts: readonly AggregatePart[]): AggregateCredit {
  const out: AggregateCredit = { records: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as { sumCredit?: string; sumCount?: string; record?: CreditSummaryRecord[] };
    fill(out, "sumCredit", value.sumCredit);
    fill(out, "sumCount", value.sumCount);
    out.records = value.record ?? [];
  }
  return out;
}

function mergeRegistration(parts: readonly AggregatePart[]): AggregateRegistration {
  const out: AggregateRegistration = { sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as {
      registered?: boolean;
      status?: string;
      semester?: RegistrationSemester;
    };
    if (value.registered !== undefined && out.registered === undefined) out.registered = value.registered;
    fill(out, "status", value.status);
    if (value.semester) out.semester = value.semester;
  }
  return out;
}

function mergeReserves(parts: readonly AggregatePart[]): AggregateReserves {
  const out: AggregateReserves = { reserves: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (Array.isArray(part.value)) out.reserves = part.value as VenueReserve[];
  }
  return out;
}

function mergePeCourses(parts: readonly AggregatePart[]): AggregatePeCourses {
  const out: AggregatePeCourses = { courses: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    if (Array.isArray(part.value)) out.courses = part.value as TakenCourse[];
  }
  return out;
}

function mergeExercise(parts: readonly AggregatePart[]): AggregateExercise {
  const out: AggregateExercise = { engagements: [], sources: [], raw: {} };
  for (const part of parts) {
    out.sources.push(part.source);
    out.raw[part.source] = part.value;
    const value = part.value as { semester?: string; list?: ExerciseEngagement[] };
    fill(out, "semester", value.semester);
    out.engagements = value.list ?? [];
  }
  return out;
}

/* -------------------------------- schema 表 ------------------------------- */

export const AGGREGATE_SCHEMA = {
  me: {
    sources: [
      { name: "one.myInfo", load: ({ root }) => root.one.getMyInfo() },
      { name: "ecard.profile", load: ({ root }) => root.ecard.getProfile() },
      { name: "smartcourse.loginUser", load: ({ root }) => root.smartcourse.getLoginUser() },
    ],
    merge: mergeMe,
  },
  balance: {
    sources: [
      { name: "one.balance", load: ({ root }) => root.one.getBalance() },
      { name: "ecard.profile", load: ({ root }) => root.ecard.getProfile() },
    ],
    merge: mergeBalance,
  },
  notifications: {
    sources: [
      {
        name: "one.notifications",
        load: async ({ root, args }) =>
          (await root.one.getNotifications({
            pageSize: Number(args.pageSize ?? AGGREGATE_LIMITS.notifications),
          })).list,
      },
      {
        name: "smartcourse.notices",
        load: async ({ root, args }) =>
          noticeItems(await root.smartcourse.getNoticeList((args.type as number) ?? NOTICE_TYPE.RECEIVED)),
      },
    ],
    merge: mergeNotifications,
  },
  documents: {
    sources: [
      {
        name: "one.documents",
        load: async ({ root, args }) =>
          (await root.one.getDocuments({
            pageSize: Number(args.pageSize ?? AGGREGATE_LIMITS.documents),
          })).list,
      },
    ],
    merge: mergeDocuments,
  },
  courses: {
    sources: [
      { name: "smartcourse.courseList", load: ({ root }) => root.smartcourse.getCourseList() },
      { name: "smartcourse.studyCourses", load: ({ root }) => root.smartcourse.getStudyCourses() },
    ],
    merge: mergeCourses,
  },
  schedule: {
    sources: [
      { name: "smartcourse.myLessons", load: ({ root }) => root.smartcourse.getMyLessons() },
    ],
    merge: mergeSchedule,
  },
  today: {
    sources: [
      { name: "smartcourse.oneDayLessons", load: ({ root }) => root.smartcourse.getOneDayLessons() },
      {
        name: "one.weekActivities",
        load: ({ root, now }) => root.one.getWeekActivities(dayRange(now) as ActivityQuery),
      },
    ],
    merge: mergeToday,
  },
  activities: {
    defaultArgs: (now) => ({ ...weekRange(now) }),
    sources: [
      {
        name: "one.weekActivities",
        load: ({ root, args }) => root.one.getWeekActivities(args as unknown as ActivityQuery),
      },
    ],
    merge: mergeActivities,
  },
  email: {
    sources: [
      { name: "one.emailInfo", load: ({ root }) => root.one.getEmailInfo() },
      { name: "one.myInfo", load: ({ root }) => root.one.getMyInfo() },
    ],
    merge: mergeEmail,
  },
  term: {
    sources: [
      { name: "one.learnWeek", load: ({ root }) => root.one.getLearnWeek() },
      {
        name: "smartcourse.curriculum",
        load: async ({ root }) => (await root.smartcourse.getMyLessons()).curriculum,
      },
      { name: "mhub.terms", load: ({ root }) => root.mhub.getTerms() },
    ],
    merge: mergeTerm,
  },
  grades: {
    sources: [
      {
        name: "mhub.grades",
        load: async ({ root, args }) => {
          const terms = await root.mhub.getTerms();
          const xn = (args.xn as string | undefined) ?? terms[0]?.XN;
          if (!xn) return { terms };
          const current = await root.mhub.getGrades({ xn, xq: Number(args.xq ?? 0) });
          return { terms, current };
        },
      },
    ],
    merge: mergeGrades,
  },
  devices: {
    sources: [{ name: "hkwxy.onlineDevices", load: ({ root }) => root.hkwxy.getOnlineDevices() }],
    merge: mergeDevices,
  },
  transactions: {
    defaultArgs: () => ({ page: 1 }),
    sources: [
      {
        name: "ecard.transactions",
        load: ({ root, args }) =>
          root.ecard.getTransactions({ page: Number(args.page ?? 1) } as Partial<TransactionQuery>),
      },
    ],
    merge: mergeTransactions,
  },
  exams: {
    sources: [
      {
        name: "mhub.exams",
        load: async ({ root, args }) => {
          const semester = (args.xqh as string | undefined) ?? (await root.mhub.getExamCurrentSemester()).XQH;
          if (!semester) return undefined;
          const page = await root.mhub.getStudentExams({
            xqh: semester,
            kslx: args.kslx as number | string | undefined,
            kcmc: args.kcmc as string | undefined,
            pageSize: Number(args.pageSize ?? 100),
          });
          return { semester, page };
        },
      },
    ],
    merge: mergeExams,
  },
  freeRooms: {
    defaultArgs: (now) => ({ date: formatBeijingDate(now).slice(0, 10), startPeriod: 1, endPeriod: 2 }),
    sources: [
      {
        name: "mhub.freeRooms",
        load: async ({ root, args }) => {
          if (!args.building) return undefined;
          return root.mhub.getFreeClassrooms({
            date: String(args.date),
            building: String(args.building),
            startPeriod: Number(args.startPeriod ?? 1),
            endPeriod: Number(args.endPeriod ?? 2),
          });
        },
      },
    ],
    merge: mergeFreeRooms,
  },
  fitness: {
    sources: [
      {
        name: "petyxy.fitness",
        load: ({ root, args }) => root.petyxy.getFitnessResult(args.periodId as string | undefined),
      },
    ],
    merge: mergeFitness,
  },
  credit: {
    sources: [{ name: "ihuster.credit", load: ({ root }) => root.ihuster.getCreditSummary() }],
    merge: mergeCredit,
  },
  registration: {
    sources: [
      {
        name: "register.registration",
        load: async ({ root }) => {
          const [status, semester] = await Promise.all([
            root.register.getStatus(),
            root.register.getSemester(),
          ]);
          return { registered: status.registered, status: status.status, semester };
        },
      },
    ],
    merge: mergeRegistration,
  },
  reserves: {
    sources: [{ name: "pecg.reserves", load: ({ root }) => root.pecg.getMyReserveList() }],
    merge: mergeReserves,
  },
  peCourses: {
    sources: [{ name: "pejxgl.coursesTaken", load: ({ root }) => root.pejxgl.getCoursesTaken() }],
    merge: mergePeCourses,
  },
  exercise: {
    sources: [
      {
        name: "pejxgl.exercise",
        load: async ({ root, args }) => {
          const semester =
            (args.xqh as string | undefined) ?? (await root.pejxgl.getSemesters())[0]?.xqh;
          if (!semester) return undefined;
          return { semester, list: await root.pejxgl.getNumberOfEngagements(semester) };
        },
      },
    ],
    merge: mergeExercise,
  },
} satisfies Record<string, AggregateResource<unknown>>;

export type AggregateResourceName = keyof typeof AGGREGATE_SCHEMA;

export interface AggregateResources {
  me: AggregateMe;
  balance: AggregateBalance;
  notifications: AggregateNotification[];
  documents: AggregateDocument[];
  courses: AggregateCourses;
  schedule: AggregateSchedule;
  today: AggregateToday;
  activities: AggregateActivity[];
  email: AggregateEmail;
  term: AggregateTerm;
  grades: AggregateGrades;
  devices: AggregateDevices;
  transactions: AggregateTransactions;
  exams: AggregateExams;
  freeRooms: AggregateFreeRooms;
  fitness: AggregateFitness;
  credit: AggregateCredit;
  registration: AggregateRegistration;
  reserves: AggregateReserves;
  peCourses: AggregatePeCourses;
  exercise: AggregateExercise;
}

/* -------------------------------- 执行器 -------------------------------- */

async function runResource<TOut>(
  root: AggregateRoot,
  name: string,
  resource: AggregateResource<TOut>,
  overrides: Record<string, unknown>,
): Promise<TOut> {
  const now = new Date();
  const args = { ...(resource.defaultArgs?.(now) ?? {}), ...overrides };
  const settled = await Promise.allSettled(
    resource.sources.map((source) => source.load({ root, now, args })),
  );

  const parts: AggregatePart[] = [];
  const errors: unknown[] = [];
  settled.forEach((result, index) => {
    const source = resource.sources[index];
    if (result.status === "rejected") {
      errors.push(result.reason);
      return;
    }
    const value = result.value;
    if (value === undefined || value === null) return;
    if (source.isEmpty?.(value)) return;
    parts.push({ source: source.name, value });
  });

  if (parts.length === 0) {
    throw new AggregateError(
      errors,
      `aggregate.${name}: 所有来源均失败或无数据`,
    );
  }
  return resource.merge(parts, { now, args });
}

/**
 * 聚合 API：`client.aggregate`。只引用命名空间，不持有 session。
 */
export class AggregateApi {
  private readonly root: AggregateRoot;

  constructor(root: AggregateRoot) {
    this.root = root;
  }

  /** 通用加载：按资源名执行 schema（可传覆盖参数） */
  load<K extends AggregateResourceName>(
    name: K,
    args: Record<string, unknown> = {},
  ): Promise<AggregateResources[K]> {
    const resource = AGGREGATE_SCHEMA[name] as unknown as AggregateResource<
      AggregateResources[K]
    >;
    return runResource(this.root, name, resource, args);
  }

  get me(): Promise<AggregateMe> {
    return this.load("me");
  }

  get balance(): Promise<AggregateBalance> {
    return this.load("balance");
  }

  get notifications(): Promise<AggregateNotification[]> {
    return this.load("notifications");
  }

  /** `notifications` 的别名 */
  get notifies(): Promise<AggregateNotification[]> {
    return this.load("notifications");
  }

  get documents(): Promise<AggregateDocument[]> {
    return this.load("documents");
  }

  /** `documents` 的别名 */
  get news(): Promise<AggregateDocument[]> {
    return this.load("documents");
  }

  get courses(): Promise<AggregateCourses> {
    return this.load("courses");
  }

  get schedule(): Promise<AggregateSchedule> {
    return this.load("schedule");
  }

  get today(): Promise<AggregateToday> {
    return this.load("today");
  }

  get activities(): Promise<AggregateActivity[]> {
    return this.load("activities");
  }

  get email(): Promise<AggregateEmail> {
    return this.load("email");
  }

  get term(): Promise<AggregateTerm> {
    return this.load("term");
  }

  get grades(): Promise<AggregateGrades> {
    return this.load("grades");
  }

  get devices(): Promise<AggregateDevices> {
    return this.load("devices");
  }

  get transactions(): Promise<AggregateTransactions> {
    return this.load("transactions");
  }

  get exams(): Promise<AggregateExams> {
    return this.load("exams");
  }

  get fitness(): Promise<AggregateFitness> {
    return this.load("fitness");
  }

  get credit(): Promise<AggregateCredit> {
    return this.load("credit");
  }

  get registration(): Promise<AggregateRegistration> {
    return this.load("registration");
  }

  get reserves(): Promise<AggregateReserves> {
    return this.load("reserves");
  }

  get peCourses(): Promise<AggregatePeCourses> {
    return this.load("peCourses");
  }

  get exercise(): Promise<AggregateExercise> {
    return this.load("exercise");
  }

  /* ---------------------------- 带参数的便捷方法 ---------------------------- */

  activitiesIn(query: ActivityQuery): Promise<AggregateActivity[]> {
    return this.load("activities", query as unknown as Record<string, unknown>);
  }

  notificationsIn(query: NoticeQuery): Promise<AggregateNotification[]> {
    return this.load("notifications", query as unknown as Record<string, unknown>);
  }

  documentsIn(query: DocumentQuery): Promise<AggregateDocument[]> {
    return this.load("documents", query as unknown as Record<string, unknown>);
  }

  transactionsIn(query: Partial<TransactionQuery>): Promise<AggregateTransactions> {
    return this.load("transactions", query as unknown as Record<string, unknown>);
  }

  gradesOf(options: { xn?: string; xq?: number }): Promise<AggregateGrades> {
    return this.load("grades", options as unknown as Record<string, unknown>);
  }

  /** 指定学期 / 类型的考试安排 */
  examsOf(options: { xqh?: string; kslx?: number | string; kcmc?: string } = {}): Promise<AggregateExams> {
    return this.load("exams", options as unknown as Record<string, unknown>);
  }

  /** 指定日期 / 教学楼 / 节次的空闲教室 */
  freeRoomsOf(options: {
    building: string;
    date?: string;
    startPeriod?: number;
    endPeriod?: number;
  }): Promise<AggregateFreeRooms> {
    return this.load("freeRooms", options as unknown as Record<string, unknown>);
  }

  /** 指定学期的体测成绩（不传取当前学期） */
  fitnessOf(periodId?: string | number): Promise<AggregateFitness> {
    return this.load("fitness", periodId !== undefined ? { periodId } : {});
  }

  /** 指定学期的课外锻炼次数（不传取最新学期） */
  exerciseOf(options: { xqh?: string } = {}): Promise<AggregateExercise> {
    return this.load("exercise", options as unknown as Record<string, unknown>);
  }

  /** 遍历全部通知（仅 one.hust 门户，按 limit 截断） */
  async notificationsAll(options: { limit?: number } = {}): Promise<AggregateNotification[]> {
    const limit = options.limit ?? 100;
    const out: AggregateNotification[] = [];
    for await (const item of this.root.one.iterateNotifications()) {
      out.push(toNotification("one.notifications", item));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** 遍历全部公文 / 新闻（按 limit 截断） */
  async documentsAll(options: { limit?: number } = {}): Promise<AggregateDocument[]> {
    const limit = options.limit ?? 100;
    const out: AggregateDocument[] = [];
    for await (const item of this.root.one.iterateDocuments()) {
      out.push(toDocument(item));
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * 综合概览：并发取各资源，**永不 reject**，失败记入 `errors`。
   */
  async overview(): Promise<AggregateOverview> {
    const entries = [
      ["me", () => this.load("me")],
      ["balance", () => this.load("balance")],
      ["term", () => this.load("term")],
      ["today", () => this.load("today")],
      ["email", () => this.load("email")],
      ["notifications", () => this.load("notifications")],
      ["devices", () => this.load("devices")],
    ] as const;

    const settled = await Promise.allSettled(entries.map(([, load]) => load()));
    const out: AggregateOverview = { notifications: [], devices: [], sources: [], errors: [] };
    settled.forEach((result, index) => {
      const name = entries[index][0];
      if (result.status === "rejected") {
        const reason = result.reason as { message?: string } | undefined;
        out.errors.push({ resource: name, message: String(reason?.message ?? result.reason) });
        return;
      }
      (out as unknown as Record<string, unknown>)[name] = result.value;
      out.sources.push(name);
    });
    return out;
  }
}
