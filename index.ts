import { HustClient, type AuthOptions } from "./src/client.ts";

export { HustClient } from "./src/client.ts";
export { Session } from "./src/http.ts";
export type { Cookie, CookieInput, CookieStore, CookieStoreInput } from "./src/http.ts";
export { gifToJpeg, fetchCaptchaGif, decodeGifFrames } from "./src/captcha.ts";
export { recognizeCaptcha } from "./src/openai.ts";
export { recognizeStdCharPipe } from "./src/stdchar-pipe.ts";
export type { StdCharOptions } from "./src/stdchar-pipe.ts";
export { parseProfile } from "./src/profile.ts";
export type { Profile, ProfileSection, ProfileField } from "./src/profile.ts";

/* ---------------------------------- CAS ---------------------------------- */
export {
  CAS_HOST,
  CAS_ORIGIN,
  CAS_LOGIN,
  CAS_RSA,
  CAS_CODE,
  CASTGC_COOKIE,
  casLoginUrl,
  serviceUrl,
  isCasLoginResponse,
  requestCasTicket,
  exchangeTicket,
  fullLogin,
  acquireServiceSession,
} from "./src/cas.ts";
export type {
  CasService,
  CasResponse,
  Credentials,
  LoginOptions,
  LoginContext,
  LoginContextProvider,
  AcquireOptions,
  OcrStrategy,
  AiOcr,
  ParsedOcr,
  RawOcr,
} from "./src/cas.ts";

/* ----------------------------- CAS 应用声明 ------------------------------ */
export {
  ECARD_HOST,
  ECARD_BASE,
  ECARD_SERVICE,
  ECARD_SESSION_COOKIE,
  EcardApi,
  ecardService,
} from "./src/ecard.ts";
export type {
  Transaction,
  TransactionPage,
  TransactionQuery,
} from "./src/ecard.ts";
export {
  WECHAT_HOST,
  WECHAT_BASE,
  WECHAT_SERVICE,
  WECHAT_SESSION_COOKIE,
  WechatApi,
  wechatService,
  wechatUrl,
} from "./src/wechat.ts";
export {
  MHUB_HOST,
  MHUB_BASE,
  MHUB_SERVICE,
  MHUB_SESSION_COOKIE,
  MhubApi,
  mhubService,
  mhubUrl,
} from "./src/mhub.ts";
export {
  HKWXY_HOST,
  HKWXY_BASE,
  HKWXY_SERVICE,
  HKWXY_SESSION_COOKIE,
  HkwxyApi,
  hkwxyService,
  hkwxyUrl,
  parseOnlineDevices,
} from "./src/hkwxy.ts";

/* -------------------------------- one.hust ------------------------------- */
export {
  ONE_HOST,
  ONE_BASE,
  ONE_CLIENT_ID,
  ONE_ACCESS_TOKEN_COOKIE,
  ONE_AUTHORIZE,
  ONE_CALLBACK_AUTHORIZE,
  ONE_PORTAL_BASE,
  ONE_ENDPOINTS,
  formatBeijingDate,
  OneHustApi,
  OnePortal,
  oneServiceUrl,
  oneRedirectUri,
  oneAuthorizeUrl,
  acquireOneToken,
  decodeJwtPayload,
  jwtExpiresAt,
  isOneTokenUsable,
} from "./src/one.ts";
export type {
  OneHustOptions,
  OneToken,
  OneTokenResponse,
  OneResponse,
  OnePage,
  PageQuery,
  PortalEndpoint,
  PortalEnvelope,
  OneEndpointName,
  NoticeQuery,
  CampusNotice,
  NoticePage,
  LearnWeek,
  EmailInfo,
  Balance,
  DocumentQuery,
  CampusDocument,
  DocumentPage,
  ActivityQuery,
  Activity,
  MyInfo,
} from "./src/one.ts";
export type { ClientRuntime } from "./src/runtime.ts";

/* -------------------------------- aggregate ------------------------------- */
export {
  AggregateApi,
  AGGREGATE_SCHEMA,
  AGGREGATE_LIMITS,
  dayRange,
  weekRange,
} from "./src/aggregate.ts";
export type {
  AggregateRoot,
  AggregateMe,
  AggregateBalance,
  AggregateNotification,
  AggregateDocument,
  AggregateCourse,
  AggregateCourseRole,
  AggregateCourses,
  AggregateSchedule,
  AggregateActivity,
  AggregateToday,
  AggregateEmail,
  AggregateTerm,
  AggregateGrades,
  AggregateDevices,
  AggregateTransactions,
  AggregateOverview,
  AggregateResource,
  AggregateResourceName,
  AggregateResources,
  AggregateSource,
  AggregatePart,
  AggregateLoadContext,
  AggregateMergeContext,
} from "./src/aggregate.ts";

/* ------------------------------ smartcourse ------------------------------ */
export {
  SMARTCOURSE_HOST,
  SMARTCOURSE_BASE,
  SMARTCOURSE_CLIENT_ID,
  SMARTCOURSE_WEB_ID,
  SMARTCOURSE_SESSION_COOKIE,
  SMARTCOURSE_REDIRECT_URI,
  SMARTCOURSE_SERVICE,
  SMARTCOURSE_LESSONS_PATH,
  SMARTCOURSE_LOGIN_USER_PATH,
  SMARTCOURSE_NOTICE_LIST_PATH,
  SMARTCOURSE_ONE_DAY_LESSONS_PATH,
  SMARTCOURSE_COURSE_LIST_PATH,
  SMARTCOURSE_STUDY_COURSE_PATH,
  SMARTCOURSE_ENC_SALT,
  NOTICE_TYPE,
  smartcourseEnc,
  smartcourseService,
  smartcourseUrl,
  SmartCourseApi,
  noticeItems,
  parseStudyCourses,
} from "./src/smartcourse.ts";
export type {
  LessonQuery,
  Curriculum,
  Lesson,
  MyLessons,
  OneDayLessons,
  SmartCourseItem,
  CourseListResult,
  StudyCourse,
  StudyCourseQuery,
  LoginUser,
  Notice,
  NoticeListResult,
} from "./src/smartcourse.ts";
export type { OnlineDevice } from "./src/hkwxy.ts";
export { parseGrades, parseGradeTerms, computeWeighted } from "./src/grades.ts";
export type {
  Grades,
  Course,
  GradeSummary,
  WeightedResult,
  WeightedOptions,
  GradeTerm,
} from "./src/grades.ts";
export type { RgbaFrame } from "./src/captcha.ts";
export { defaultLogger, resolveLogger } from "./src/logger.ts";
export type { Logger, LoggerInput } from "./src/logger.ts";
export type { AuthOptions, AiOcrOptions, PersistOptions } from "./src/client.ts";
export type { AIConfig } from "./src/openai.ts";

export function auth(options: AuthOptions = {}): HustClient {
  return new HustClient(options);
}

const hust = { auth };

export default hust;
