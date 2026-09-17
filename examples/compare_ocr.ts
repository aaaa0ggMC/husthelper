import fs from "node:fs";
import { Session } from "../src/http.ts";
import { fetchCaptchaGif, gifToJpeg } from "../src/captcha.ts";
import { recognizeStdCharPipe } from "../src/stdchar-pipe.ts";
import { recognizeCaptcha } from "../src/openai.ts";
import { CAS_CODE, LOGIN_URL } from "../src/auth.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const count = Number(process.argv[2] ?? 5);
const session = new Session();
await session.get(LOGIN_URL);

for (let i = 0; i < count; i++) {
  const gif = await fetchCaptchaGif(session, CAS_CODE);
  const jpg = gifToJpeg(gif, { scale: 4, quality: 92 });
  const file = `/tmp/opencode/cmp_${i}.jpg`;
  fs.writeFileSync(file, jpg);

  const stdchar = await recognizeStdCharPipe(gif);
  let ai = "";
  try {
    ai = await recognizeCaptcha(jpg, config.openai);
  } catch (error) {
    ai = `ERR:${error instanceof Error ? error.message.slice(0, 40) : String(error)}`;
  }

  console.log(`#${i} stdchar=${stdchar} ai=${ai} file=${file}`);
}
