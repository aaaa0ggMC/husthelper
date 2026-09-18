import {
  HustClient,
  type AuthOptions,
  type QrCodeHandler,
  type QrCodeOptions,
} from "./src/client.ts";

export { HustClient } from "./src/client.ts";
export { Session } from "hustcore";
export type { Cookie, CookieInput, CookieStore, CookieStoreInput } from "hustcore";
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
  CAS_QR_LOGIN,
  CAS_QR_CHECK,
  CASTGC_COOKIE,
  casLoginUrl,
  serviceUrl,
  isCasLoginResponse,
  requestCasTicket,
  exchangeTicket,
  fullLogin,
  acquireServiceSession,
  qrScanUrl,
  qrCheckUrl,
  qrLogin,
} from "./src/cas.ts";
export type {
  CasService,
  CasResponse,
  Credentials,
  LoginOptions,
  LoginContext,
  LoginContextProvider,
  CasLoginProvider,
  AcquireOptions,
  OcrStrategy,
  AiOcr,
  ParsedOcr,
  RawOcr,
  QrLoginOptions,
  QrLoginResult,
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
  EXAM_TYPE,
  MhubApi,
  mhubService,
  mhubUrl,
} from "./src/mhub.ts";
export type {
  ExamUser,
  CurrentSemester,
  ExamSemester,
  ExamSchedule,
  ExamQuery,
  ExamPage,
  TeachingBuilding,
  CurrentWeek,
  WeekDay,
  FreeRoom,
  FreeRoomResult,
  FreeRoomQuery,
} from "./src/mhub.ts";
export {
  HKWXY_HOST,
  HKWXY_BASE,
  HKWXY_SERVICE,
  HKWXY_SESSION_COOKIE,
  HKWXY_WP_BASE,
  HKWXY_WP_SERVICE,
  HKWXY_SERVICE_CENTER_ID,
  HkwxyApi,
  hkwxyService,
  hkwxyUrl,
  hkwxyWpService,
  hkwxyWpUrl,
  isHkwxyWpLoginRedirect,
  parseOnlineDevices,
  parseServiceCenter,
} from "./src/hkwxy.ts";
export type { ServiceItem, ServiceGroup, ServiceSection } from "./src/hkwxy.ts";

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

/* --------------------------------- pejxgl --------------------------------- */
export {
  PEJXGL_HOST,
  PEJXGL_BASE,
  PEJXGL_SERVICE,
  PEJXGL_SESSION_COOKIE,
  pejxglService,
  pejxglUrl,
  isPejxglLoginRedirect,
  PejxglApi,
} from "./src/pejxgl.ts";
export type { PeSemester, ExerciseEngagement, TakenCourse } from "./src/pejxgl.ts";

/* ---------------------------------- pecg ---------------------------------- */
export {
  PECG_HOST,
  PECG_BASE,
  PECG_SESSION_COOKIE,
  PECG_LOGINTO,
  pecgUrl,
  isPecgLoginResponse,
  acquirePecgSession,
  parseReserveList,
  PecgApi,
} from "./src/pecg.ts";
export type { VenueReserve } from "./src/pecg.ts";

/* --------------------------------- petyxy --------------------------------- */
export {
  PETYXY_HOST,
  PETYXY_BASE,
  PETYXY_LOGIN,
  PETYXY_DOLOGIN,
  PETYXY_PFT_INDEX,
  PETYXY_SESSION_COOKIE,
  petyxyCasService,
  petyxyUrl,
  isPetyxyLoginResponse,
  acquirePetyxySession,
  parseFitnessResult,
  PetyxyApi,
} from "./src/petyxy.ts";
export type { FitnessPeriod, FitnessItem, FitnessResult } from "./src/petyxy.ts";

/* -------------------------------- register -------------------------------- */
export {
  REGISTER_HOST,
  REGISTER_BASE,
  REGISTER_SERVICE,
  REGISTER_SESSION_COOKIE,
  registerService,
  registerUrl,
  isRegisterLoginRedirect,
  RegisterApi,
} from "./src/register.ts";
export type {
  RegistrationSemester,
  RegistrationStatus,
  RegistrationNotice,
  RegistrationNoticePage,
  RegistrationNoticeQuery,
} from "./src/register.ts";

/* --------------------------------- ihuster -------------------------------- */
export {
  IHUSTER_HOST,
  IHUSTER_PORTAL,
  IHUSTER_WEB,
  IHUSTER_TARGET_URL,
  IHUSTER_SERVICE,
  IHUSTER_TOKEN_COOKIE,
  ihusterUrl,
  decodeIhusterToken,
  extractIhusterToken,
  acquireIhusterToken,
  IhusterApi,
} from "./src/ihuster.ts";
export type { IhusterTokenPayload, CreditSummary, CreditSummaryRecord, IhusterUserInfo } from "./src/ihuster.ts";

/* ------------------------------- electricity ------------------------------ */
export {
  ELECTRICITY_HOST,
  ELECTRICITY_BASE,
  ELECTRICITY_SERVICE,
  ELECTRICITY_SESSION_COOKIE,
  ELECTRICITY_REFERER,
  electricityService,
  electricityAuthHeaders,
  ElectricityApi,
} from "./src/electricity.ts";
export type {
  ElectricityArea,
  ElectricityBuilding,
  ElectricityRoom,
  ElectricityMeter,
  ElectricityBalance,
  ElectricityRoomBalance,
} from "./src/electricity.ts";

/* ------------------------------- selfservice ------------------------------ */
export {
  SELFSERVICE_HOST,
  SELFSERVICE_BASE,
  SELFSERVICE_SERVICE,
  SELFSERVICE_SESSION_COOKIE,
  selfserviceService,
  selfserviceUrl,
  isSelfserviceLoginRedirect,
  decodeEntities,
  parseSelfserviceOverview,
  parseSelfserviceOnlineDevices,
  parseSelfserviceProfile,
  SelfserviceApi,
} from "./src/selfservice.ts";
export type {
  SelfserviceOverview,
  SelfserviceOnlineDevice,
  SelfservicePasswordlessDevice,
  SelfserviceOnlineDeviceResult,
  SelfserviceProfile,
  SelfserviceActionResult,
} from "./src/selfservice.ts";

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
  AggregateExams,
  AggregateFreeRooms,
  AggregateFitness,
  AggregateCredit,
  AggregateRegistration,
  AggregateReserves,
  AggregatePeCourses,
  AggregateExercise,
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
export { defaultLogger, resolveLogger } from "hustcore";
export type { Logger, LoggerInput } from "hustcore";
export type {
  AuthOptions,
  AiOcrOptions,
  PersistOptions,
  QrCodeHandler,
  QrCodeOptions,
  QrCodeLoginOptions,
} from "./src/client.ts";
export type { AIConfig } from "./src/openai.ts";

export function auth(options: AuthOptions = {}): HustClient {
  return new HustClient(options);
}

/** 以企业微信扫码登录为首要 / 唯一登录方式创建客户端；之后仍可链式 `.auth({...})` 追加密码登录 */
export function withQrCode(handler: QrCodeHandler, options: QrCodeOptions = {}): HustClient {
  return new HustClient().withQrCode(handler, options);
}

const hust = { auth, withQrCode };

export default hust;
