// 把 src/ 打包成单文件油猴脚本：node hustpass/userscript/build.mjs
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(dir, '..', 'package.json'), 'utf8'))
const header = `// ==UserScript==
// @name         HUST CAS 验证码自动识别
// @namespace    husthelper
// @version      ${pkg.version}
// @description  在 pass.hust.edu.cn 登录页离线识别验证码并填入；账号密码已填好且把握足够时可自动登录。数据不出浏览器。
// @match        https://pass.hust.edu.cn/cas/login*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      LGPL-3.0-or-later
// ==/UserScript==
/*
 * 识别算法与数字模板移植自 xuxinhang/HUST-CAS-login-emulator（LGPL-3.0），经 husthelper/hustpass/stdchar。
 * 本文件由 hustpass/userscript/build.mjs 生成，请改 src/ 后重新构建。
 */
`
const result = await build({
  entryPoints: [path.join(dir, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: false,
  write: false,
  logLevel: 'warning'
})
writeFileSync(path.join(dir, 'hust-cas-captcha.user.js'), header + result.outputFiles[0].text)
console.log('built hust-cas-captcha.user.js', result.outputFiles[0].text.length, 'bytes (body)')
