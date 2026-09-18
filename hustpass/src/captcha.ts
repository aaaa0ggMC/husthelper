import { parseGIF, decompressFrames } from "gifuct-js";
import jpeg from "jpeg-js";
import type { Session } from "hustcore";

interface GifFrame {
  dims: { top: number; left: number; width: number; height: number };
  patch: Uint8ClampedArray;
  disposalType: number;
}

export interface GifToJpegOptions {
  scale?: number;
  quality?: number;
  threshold?: number;
}

export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function drawPatch(canvas: Uint8ClampedArray, canvasWidth: number, frame: GifFrame): void {
  const { top, left, width, height } = frame.dims;
  const patch = frame.patch;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const alpha = patch[source + 3] / 255;
      if (alpha === 0) continue;

      const target = ((top + y) * canvasWidth + (left + x)) * 4;
      const destAlpha = canvas[target + 3] / 255;
      const outAlpha = alpha + destAlpha * (1 - alpha);

      for (let c = 0; c < 3; c++) {
        const src = patch[source + c] * alpha;
        const dst = canvas[target + c] * destAlpha * (1 - alpha);
        canvas[target + c] = outAlpha === 0 ? 0 : (src + dst) / outAlpha;
      }
      canvas[target + 3] = outAlpha * 255;
    }
  }
}

function clearRect(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  frame: GifFrame,
): void {
  const { top, left, width, height } = frame.dims;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = ((top + y) * canvasWidth + (left + x)) * 4;
      canvas[target] = 0;
      canvas[target + 1] = 0;
      canvas[target + 2] = 0;
      canvas[target + 3] = 0;
    }
  }
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function upscaleNearest(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): { data: Uint8Array; width: number; height: number } {
  if (scale <= 1) return { data: new Uint8Array(rgba.buffer.slice(0)), width, height };

  const outWidth = width * scale;
  const outHeight = height * scale;
  const out = new Uint8Array(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    const sourceY = (y / scale) | 0;
    for (let x = 0; x < outWidth; x++) {
      const sourceX = (x / scale) | 0;
      const src = (sourceY * width + sourceX) * 4;
      const dst = (y * outWidth + x) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

export function decodeGifFrames(gif: Buffer): RgbaFrame[] {
  const parsed = parseGIF(gif as unknown as ArrayBuffer);
  const frames = decompressFrames(parsed, true) as unknown as GifFrame[];
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  if (frames.length === 0) throw new Error("GIF 不包含任何帧");

  const rendered: RgbaFrame[] = [];
  let canvas = new Uint8ClampedArray(width * height * 4);

  for (const frame of frames) {
    const before = canvas.slice();
    drawPatch(canvas, width, frame);
    rendered.push({ width, height, data: canvas.slice() });

    if (frame.disposalType === 2) clearRect(canvas, width, frame);
    else if (frame.disposalType === 3) canvas = before;
  }

  return rendered;
}

export function gifToJpeg(gif: Buffer, options: GifToJpegOptions = {}): Buffer {
  const scale = options.scale ?? 4;
  const quality = options.quality ?? 90;
  const threshold = options.threshold;

  const rendered = decodeGifFrames(gif);
  const width = rendered[0].width;
  const height = rendered[0].height;

  const merged = new Uint8ClampedArray(width * height * 4);
  const sample: number[] = [];

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      sample.length = 0;
      for (const frame of rendered) {
        const alpha = frame.data[idx + 3] / 255;
        sample.push(frame.data[idx + c] * alpha + 255 * (1 - alpha));
      }
      merged[idx + c] = median(sample);
    }

    if (threshold !== undefined) {
      const luma = 0.299 * merged[idx] + 0.587 * merged[idx + 1] + 0.114 * merged[idx + 2];
      const value = luma < threshold ? 0 : 255;
      merged[idx] = merged[idx + 1] = merged[idx + 2] = value;
    }
    merged[idx + 3] = 255;
  }

  const { data, width: outWidth, height: outHeight } = upscaleNearest(
    merged,
    width,
    height,
    scale,
  );
  return jpeg.encode({ data, width: outWidth, height: outHeight }, quality).data as Buffer;
}

export async function fetchCaptchaGif(session: Session, url: string): Promise<Buffer> {
  const response = await session.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}
