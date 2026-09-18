import fs from "node:fs";
import { Session } from "../hustpass/index.ts";
import { fetchCaptchaGif, gifToJpeg } from "../hustpass/index.ts";
import { recognizeStdCharPipe } from "../hustpass/index.ts";
import { recognizeCaptcha } from "../hustpass/index.ts";
import { CAS_CODE, casLoginUrl } from "../hustpass/index.ts";
import { ECARD_SERVICE } from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const count = Number(process.argv[2] ?? 5);
const session = new Session();
await session.get(casLoginUrl(ECARD_SERVICE));

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
