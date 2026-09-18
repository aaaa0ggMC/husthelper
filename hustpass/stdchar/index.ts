/**
 * husthelper / stdchar
 *
 * SPDX-License-Identifier: LGPL-3.0-or-later
 *
 * This module is a JavaScript port of the CAPTCHA template-matching approach from
 *   https://github.com/xuxinhang/HUST-CAS-login-emulator  (LGPL-3.0)
 * including the bundled `char_*.npy` templates. See NOTICE and LICENSE in this
 * directory. It is intentionally isolated from the MIT-licensed core and is
 * invoked out-of-process (see src/stdchar-pipe.ts).
 */

import fs from "node:fs";
import path from "node:path";
import type { RgbaFrame } from "../src/captcha.ts";

export interface Template {
  char: string;
  width: number;
  height: number;
  data: Uint8Array;
}

function parseNpy(buffer: Buffer): { shape: number[]; data: Uint8Array } {
  const magic = buffer.toString("latin1", 0, 6);
  if (magic !== "\x93NUMPY") throw new Error("不是合法的 .npy 文件");

  const major = buffer[6];
  const headerLength = major === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const headerStart = major === 1 ? 10 : 12;
  const header = buffer.toString("latin1", headerStart, headerStart + headerLength);

  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/);
  const shape = (shapeMatch?.[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);

  const dataStart = headerStart + headerLength;
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset + dataStart);
  return { shape, data };
}

let templatesPromise: Promise<Template[]> | undefined;

function loadTemplates(): Promise<Template[]> {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      const directory = import.meta.dirname;
      const templates: Template[] = [];
      for (let digit = 0; digit < 10; digit++) {
        const file = await fs.promises.readFile(path.join(directory, `char_${digit}.npy`));
        const { shape, data } = parseNpy(file);
        templates.push({
          char: String(digit),
          height: shape[0],
          width: shape[1],
          data,
        });
      }
      return templates;
    })();
  }
  return templatesPromise;
}

function otsu(values: ArrayLike<number>): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < values.length; i++) histogram[values[i]]++;

  const total = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumLow = 0;
  let countLow = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    countLow += histogram[t];
    if (countLow === 0) continue;
    const countHigh = total - countLow;
    if (countHigh === 0) break;

    sumLow += t * histogram[t];
    const meanLow = sumLow / countLow;
    const meanHigh = (sum - sumLow) / countHigh;
    const variance = countLow * countHigh * (meanHigh - meanLow) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

function binarize(values: ArrayLike<number>, threshold: number, maxValue: number): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] > threshold ? maxValue : 0;
  return out;
}

function sampleStrip(
  image: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  startX: number,
  stripWidth: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(imageHeight - 1, Math.floor((y / targetHeight) * imageHeight));
    for (let x = 0; x < targetWidth; x++) {
      const offsetX = Math.min(stripWidth - 1, Math.floor((x / targetWidth) * stripWidth));
      out[y * targetWidth + x] = image[sourceY * imageWidth + startX + offsetX];
    }
  }
  return out;
}

export function recognizeStdCharFromFrames(frames: RgbaFrame[], templates: Template[]): string {
  if (frames.length === 0) throw new Error("没有可用于识别的帧");

  const { width, height } = frames[0];
  const planes: Uint8Array[] = [];

  for (const frame of frames) {
    for (let channel = 0; channel < 3; channel++) {
      const plane = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) plane[i] = frame.data[i * 4 + channel];
      planes.push(binarize(plane, otsu(plane), 255));
    }
  }

  const averaged = new Float64Array(width * height);
  for (const plane of planes) {
    for (let i = 0; i < averaged.length; i++) averaged[i] += plane[i];
  }
  for (let i = 0; i < averaged.length; i++) averaged[i] /= planes.length;

  const rounded = Uint8Array.from(averaged, (value) => Math.round(value));
  const bitmap = binarize(rounded, otsu(rounded), 1);

  const stripWidth = Math.floor(width / 4);
  const templateWidth = templates[0].width;
  const templateHeight = templates[0].height;

  let result = "";
  for (let s = 0; s < 4; s++) {
    const strip = sampleStrip(
      bitmap,
      width,
      height,
      s * stripWidth,
      stripWidth,
      templateWidth,
      templateHeight,
    );

    let bestChar = "?";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const template of templates) {
      let distance = 0;
      for (let i = 0; i < strip.length; i++) distance += strip[i] ^ template.data[i];
      if (distance < bestDistance) {
        bestDistance = distance;
        bestChar = template.char;
      }
    }
    result += bestChar;
  }
  return result;
}

export async function recognizeStdChar(frames: RgbaFrame[]): Promise<string> {
  return recognizeStdCharFromFrames(frames, await loadTemplates());
}
