import hust from "../index.ts";
import { displayQrCode, resolveQrDisplayMode } from "./qr_terminal.ts";

/**
 * 企业微信扫码登录示例：无需密码 / 验证码 / OCR。
 *
 * 登录方式按配置顺序尝试，且持久化会话（`.persistent()`）始终最优先复用：
 *   - 若 .hust-session.json 里的 CASTGC 仍有效 → 直接复用，不会弹二维码；
 *   - 否则按 withQrCode（以及可选的 auth）顺序登录。
 *
 * 运行：
 *   node examples/login_qrcode.ts            # 终端支持图片协议则内联显示，否则存 PNG
 *   node examples/login_qrcode.ts --file     # 强制写入 .hust-cas-qrcode.png
 *   node examples/login_qrcode.ts --image    # 强制尝试内联显示（不支持时仍回退文件）
 *   node examples/login_qrcode.ts --refresh  # 先清除持久化的 CASTGC，强制重新扫码
 *
 * 对比尝试顺序：
 *   hust.auth({...}).withQrCode(fn)   // 先密码登录，失败再扫码
 *   hust.withQrCode(fn).auth({...})   // 先扫码，失败再密码登录
 */
const SESSION_FILE = ".hust-session.json";
const mode = resolveQrDisplayMode();

const client = hust
  .auth({})
  .withQrCode(async (scanUrl) => {
    const file = await displayQrCode(scanUrl, { mode });
    if (file) {
      console.log(`请使用企业微信扫描二维码图片: ${file}`);
      console.log("（终端不支持图片协议，已改存文件；可用 --image 强制内联显示）");
    } else {
      console.log("请使用企业微信扫描上方二维码完成登录...");
    }
    console.log(`二维码链接（企业微信中打开亦可）: ${scanUrl}`);
  })
  .persistent(SESSION_FILE);

if (process.argv.includes("--refresh")) {
  client.httpSession?.deleteCookie("CASTGC", "pass.hust.edu.cn");
  console.log("已清除持久化的 CASTGC，将强制重新扫码");
}

try {
  // 首次业务请求触发登录：优先复用持久化会话，失效才走扫码
  const page = await client.ecard.getTransactions({ page: 1 });
  console.log(`会话可用，一卡通流水: ${page.total} 条，第一页 ${page.records.length} 条`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
