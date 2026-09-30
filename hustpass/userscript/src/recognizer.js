// SPDX-License-Identifier: LGPL-3.0-or-later
//
// 验证码识别核心（纯函数，无 DOM 依赖，可在 Node 与浏览器中运行）。
// 算法移植自 hustpass/stdchar（其本身移植自 xuxinhang/HUST-CAS-login-emulator，LGPL-3.0）：
// GIF 逐帧合成 → 每帧每通道 Otsu 二值化 → 平均 → 再二值化 → 切 4 段 → 与数字模板做汉明距离比对。
import { parseGIF, decompressFrames } from 'gifuct-js'
import { TEMPLATES_B64, TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from './templates.js'

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let templates
function getTemplates() {
  templates ??= TEMPLATES_B64.map((b64, digit) => ({ char: String(digit), data: b64ToBytes(b64) }))
  return templates
}

/** 与 hustpass/src/captcha.ts 的 decodeGifFrames 等价：把 GIF 的每一帧合成为完整 RGBA 画面。 */
export function decodeGifFrames(buffer) {
  const parsed = parseGIF(buffer)
  const frames = decompressFrames(parsed, true)
  const width = parsed.lsd.width
  const height = parsed.lsd.height
  if (frames.length === 0) throw new Error('GIF 不包含任何帧')

  const rendered = []
  let canvas = new Uint8ClampedArray(width * height * 4)
  for (const frame of frames) {
    const before = canvas.slice()
    const { top, left, width: fw, height: fh } = frame.dims
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = (y * fw + x) * 4
        const alpha = frame.patch[s + 3] / 255
        if (alpha === 0) continue
        const t = ((top + y) * width + (left + x)) * 4
        const destAlpha = canvas[t + 3] / 255
        const outAlpha = alpha + destAlpha * (1 - alpha)
        for (let c = 0; c < 3; c++) {
          const src = frame.patch[s + c] * alpha
          const dst = canvas[t + c] * destAlpha * (1 - alpha)
          canvas[t + c] = outAlpha === 0 ? 0 : (src + dst) / outAlpha
        }
        canvas[t + 3] = outAlpha * 255
      }
    }
    rendered.push({ width, height, data: canvas.slice() })
    if (frame.disposalType === 2) {
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const t = ((top + y) * width + (left + x)) * 4
          canvas[t] = canvas[t + 1] = canvas[t + 2] = canvas[t + 3] = 0
        }
      }
    } else if (frame.disposalType === 3) canvas = before
  }
  return rendered
}

function otsu(values) {
  const histogram = new Array(256).fill(0)
  for (let i = 0; i < values.length; i++) histogram[values[i]]++
  const total = values.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * histogram[t]
  let sumLow = 0
  let countLow = 0
  let best = 0
  let bestVariance = -1
  for (let t = 0; t < 256; t++) {
    countLow += histogram[t]
    if (countLow === 0) continue
    const countHigh = total - countLow
    if (countHigh === 0) break
    sumLow += t * histogram[t]
    const meanLow = sumLow / countLow
    const meanHigh = (sum - sumLow) / countHigh
    const variance = countLow * countHigh * (meanHigh - meanLow) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = t
    }
  }
  return best
}

function binarize(values, threshold, maxValue) {
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = values[i] > threshold ? maxValue : 0
  return out
}

function sampleStrip(image, imageWidth, imageHeight, startX, stripWidth, tw, th) {
  const out = new Uint8Array(tw * th)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(imageHeight - 1, Math.floor((y / th) * imageHeight))
    for (let x = 0; x < tw; x++) {
      const ox = Math.min(stripWidth - 1, Math.floor((x / tw) * stripWidth))
      out[y * tw + x] = image[sy * imageWidth + startX + ox]
    }
  }
  return out
}

/**
 * 识别一组已合成的 RGBA 帧。
 * @returns {{ code: string, margins: number[] }} margins[i] = 第 i 位「次优距离 − 最优距离」（比特数），越大越可信
 */
export function recognizeFrames(frames) {
  if (frames.length === 0) throw new Error('没有可用于识别的帧')
  const tpls = getTemplates()
  const { width, height } = frames[0]
  const planes = []
  for (const frame of frames) {
    for (let channel = 0; channel < 3; channel++) {
      const plane = new Uint8Array(width * height)
      for (let i = 0; i < width * height; i++) plane[i] = frame.data[i * 4 + channel]
      planes.push(binarize(plane, otsu(plane), 255))
    }
  }
  const averaged = new Float64Array(width * height)
  for (const plane of planes) for (let i = 0; i < averaged.length; i++) averaged[i] += plane[i]
  for (let i = 0; i < averaged.length; i++) averaged[i] /= planes.length
  const rounded = Uint8Array.from(averaged, (v) => Math.round(v))
  const bitmap = binarize(rounded, otsu(rounded), 1)

  const stripWidth = Math.floor(width / 4)
  let code = ''
  const margins = []
  for (let s = 0; s < 4; s++) {
    const strip = sampleStrip(bitmap, width, height, s * stripWidth, stripWidth, TEMPLATE_WIDTH, TEMPLATE_HEIGHT)
    let bestChar = '?'
    let best = Infinity
    let second = Infinity
    for (const t of tpls) {
      let d = 0
      for (let i = 0; i < strip.length; i++) d += strip[i] ^ t.data[i]
      if (d < best) {
        second = best
        best = d
        bestChar = t.char
      } else if (d < second) second = d
    }
    code += bestChar
    margins.push(second - best)
  }
  return { code, margins }
}

/** GIF 字节 → 识别结果。 */
export function recognizeGif(buffer) {
  return recognizeFrames(decodeGifFrames(buffer))
}
