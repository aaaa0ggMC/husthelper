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
export {
  WECHAT_HOST,
  WECHAT_BASE,
  WECHAT_SERVICE,
  WECHAT_SESSION_COOKIE,
  wechatUrl,
} from "./src/wechat.ts";
export { MHUB_HOST, MHUB_BASE, MHUB_SERVICE, mhubUrl } from "./src/mhub.ts";
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
export type {
  Credentials,
  LoginOptions,
  OcrStrategy,
  AiOcr,
  ParsedOcr,
  RawOcr,
} from "./src/auth.ts";
export type {
  Transaction,
  TransactionPage,
  TransactionQuery,
} from "./src/ecard.ts";
export type { AIConfig } from "./src/openai.ts";

export function auth(options: AuthOptions = {}): HustClient {
  return new HustClient(options);
}

const hust = { auth };

export default hust;
