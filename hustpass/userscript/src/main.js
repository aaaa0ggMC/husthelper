// SPDX-License-Identifier: LGPL-3.0-or-later
//
// HUST 统一身份认证（pass.hust.edu.cn/cas/login）验证码自动识别。
// 只处理**你自己的**登录页：拉取验证码 GIF → 本地离线识别（不上传任何数据）→ 填入验证码框，
// 账号密码已被浏览器/密码管理器填好且把握足够时可自动点击登录。
import { recognizeGif } from './recognizer.js'

/** 单位数字把握度（次优距离 − 最优距离，比特）低于此值视为拿不准：换一张重新识别。 */
const MIN_MARGIN = 40
/** 拿不准时最多换几张验证码（拉验证码不算登录尝试，不会累计失败次数）。 */
const MAX_TRIES = 4
/** 自动提交的最小间隔：登录失败后页面会重载，间隔内不再自动提交，避免错密码反复触发账号锁定。 */
const AUTO_SUBMIT_COOLDOWN_MS = 120_000
/** 等待浏览器/密码管理器填充账号密码的最长时间。 */
const AUTOFILL_WAIT_MS = 1200

const KEY_AUTO = 'autoSubmit'
const KEY_LAST_SUBMIT = 'lastAutoSubmitAt'

const store = {
  get(key, fallback) {
    try {
      return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value)
    } catch {
      /* 存储不可用时忽略 */
    }
  }
}

const $ = (id) => document.getElementById(id)

/* ------------------------------- 状态提示 ------------------------------- */

let badge
function say(text, kind = 'info') {
  if (!badge) {
    badge = document.createElement('div')
    Object.assign(badge.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 2147483647,
      padding: '8px 14px',
      borderRadius: '8px',
      font: '13px/1.4 system-ui, sans-serif',
      color: '#fff',
      boxShadow: '0 2px 10px rgba(0,0,0,.25)',
      transition: 'opacity .3s'
    })
    document.body.appendChild(badge)
  }
  badge.textContent = text
  badge.style.background = kind === 'ok' ? '#2e7d32' : kind === 'warn' ? '#ef6c00' : '#37474f'
  badge.style.opacity = '1'
  clearTimeout(say.timer)
  say.timer = setTimeout(() => (badge.style.opacity = '0'), kind === 'info' ? 8000 : 3500)
}

/* ------------------------------- 识别流程 ------------------------------- */

let busy = false

/** 拉一张新验证码（服务器只认最近一次请求，所以显示与识别必须用同一份字节）。 */
async function fetchCaptcha() {
  const res = await fetch(`/cas/code?${Math.random()}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error(`验证码请求失败：HTTP ${res.status}`)
  return res.arrayBuffer()
}

function setImage(img, bytes) {
  if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }))
  img.dataset.blobUrl = url
  img.src = url
}

function fillCode(code) {
  const input = $('code')
  input.value = code
  // 让页面脚本/框架察觉到值变化
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 识别并填充；返回最后一次的把握度是否达标。 */
async function solve() {
  if (busy) return { ok: false }
  busy = true
  const img = $('codeImage')
  const t0 = performance.now()
  try {
    let last
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const bytes = await fetchCaptcha()
      last = recognizeGif(bytes)
      setImage(img, bytes)
      const minMargin = Math.min(...last.margins)
      if (minMargin >= MIN_MARGIN) {
        fillCode(last.code)
        say(`验证码 ${last.code}（${Math.round(performance.now() - t0)}ms）`, 'ok')
        return { ok: true, confident: true }
      }
      say(`验证码把握不足（${minMargin}），换一张…（${attempt}/${MAX_TRIES}）`, 'warn')
    }
    // 多次仍拿不准：填上最后一次的结果，但不自动提交，交给你确认
    fillCode(last.code)
    say(`验证码 ${last.code}（把握较低，请确认后再登录）`, 'warn')
    return { ok: true, confident: false }
  } catch (error) {
    say(`验证码识别失败：${error instanceof Error ? error.message : error}`, 'warn')
    return { ok: false }
  } finally {
    busy = false
  }
}

/* ------------------------------- 自动提交 ------------------------------- */

function hasVisibleError() {
  const box = $('errormsg')
  if (!box) return false
  const shown = getComputedStyle(box).display !== 'none'
  return shown && box.textContent.trim().length > 0
}

async function waitForAutofill() {
  const deadline = Date.now() + AUTOFILL_WAIT_MS
  while (Date.now() < deadline) {
    if ($('un')?.value && $('pd')?.value) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return Boolean($('un')?.value && $('pd')?.value)
}

async function maybeSubmit(confident) {
  if (!store.get(KEY_AUTO, true)) return
  if (!confident) return
  if (hasVisibleError()) return say('页面提示了错误，未自动登录', 'warn')
  if (Date.now() - Number(store.get(KEY_LAST_SUBMIT, 0)) < AUTO_SUBMIT_COOLDOWN_MS) {
    return say('刚自动登录过，本次请手动点击登录（防止连续失败锁定账号）', 'info')
  }
  if (!(await waitForAutofill())) return
  store.set(KEY_LAST_SUBMIT, Date.now())
  say('自动登录中…', 'info')
  $('index_login_btn')?.click()
}

/* --------------------------------- 入口 --------------------------------- */

function registerMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return
  const on = store.get(KEY_AUTO, true)
  GM_registerMenuCommand(`自动登录：${on ? '开（点击关闭）' : '关（点击开启）'}`, () => {
    store.set(KEY_AUTO, !on)
    location.reload()
  })
}

async function main() {
  if (!$('codeImage') || !$('code')) return
  registerMenu()

  // 点击验证码图片：用我们自己的拉取流程代替页面原有的刷新（否则显示的图与识别的图不是同一张）
  window.addEventListener(
    'click',
    (event) => {
      if (event.target?.id !== 'codeImage') return
      event.stopImmediatePropagation()
      event.preventDefault()
      void solve()
    },
    true
  )

  const result = await solve()
  if (result.ok) await maybeSubmit(result.confident)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void main())
else void main()
