import readline from "node:readline/promises";
import hust from "../hustpass/index.ts";
import { loadConfig } from "./config.ts";

/**
 * 企业微信动态验证码（MFA）登录示例。
 *
 * 当密码 / 验证码登录被 CAS 风控判定「终端疑似发生变化」时，CAS 会返回一个要求
 * `phoneCode` 的挑战页，并把动态验证码发送到**企业微信**。配置 `withMfaCode(handler)`
 * 后，SDK 会回调该 handler 索取验证码并自动完成二次验证，无需再手动打开浏览器。
 *
 * 运行：
 *   node examples/login_mfa.ts
 *
 * handler 可为异步：这里用 readline 阻塞等待用户从企业微信读取验证码。
 * 若需要与扫码登录组合（MFA 失败时降级），可在 `.withMfaCode()` 之后再链式
 * `.withQrCode(showQr)`（顺序即尝试顺序）。
 */
const config = loadConfig();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const client = hust
  .auth({ user_name: config.un, password: config.pwd })
  .withStdChar()
  .withMfaCode(async (challenge) => {
    if (challenge.message) console.log(`\n[CAS] ${challenge.message}`);
    console.log(`验证码已发送到${challenge.channel ?? "企业微信"}，请查收（双因子认证）。`);
    return await rl.question("请输入验证码: ");
  })
  .persistent(".hust-session.json");

try {
  const profile = await client.ecard.getProfile();
  console.log(`登录成功：${profile.name}（${profile.id}），校园卡余额 ${profile.cardBalance}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
}
