import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateImageEmuSize, getImageDimensions, EMU_PER_PT } from "../src/image-size.ts";

function pngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gifBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(16);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function jpegBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(11, 4); // 段长度
  buf[6] = 8; // 精度
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function webpVp8xBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  // VP8X 中宽高按规范存为「实际值 - 1」
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

test("getImageDimensions：PNG / GIF / JPEG / WebP(VP8X)", () => {
  assert.deepEqual(getImageDimensions(pngBuffer(640, 480)), { width: 640, height: 480, type: "png" });
  assert.deepEqual(getImageDimensions(gifBuffer(320, 200)), { width: 320, height: 200, type: "gif" });
  assert.deepEqual(getImageDimensions(jpegBuffer(800, 600)), { width: 800, height: 600, type: "jpeg" });
  assert.deepEqual(getImageDimensions(webpVp8xBuffer(100, 50)), { width: 100, height: 50, type: "webp" });
});

test("getImageDimensions：空/未知数据返回 unknown", () => {
  assert.deepEqual(getImageDimensions(Buffer.alloc(0)), { width: 0, height: 0, type: "unknown" });
  assert.deepEqual(getImageDimensions(Buffer.from("not an image at all")), { width: 0, height: 0, type: "unknown" });
});

test("calculateImageEmuSize：显式宽度 / 百分比 / 未知尺寸回退", () => {
  const dim = { width: 1600, height: 900, type: "png" as const };

  const fixed = calculateImageEmuSize(dim, { width: 300 });
  assert.equal(fixed.widthPt, 300);
  assert.equal(Math.round(fixed.cx), Math.round(300 * EMU_PER_PT));
  // 保持宽高比 16:9
  assert.ok(Math.abs(fixed.heightPt - 300 / (1600 / 900)) < 0.01);

  const half = calculateImageEmuSize(dim, { size: "50%", maxWidthPt: 400 });
  assert.equal(half.widthPt, 200);

  const px = calculateImageEmuSize(dim, { width: "192px" });
  assert.equal(px.widthPt, (192 * 72) / 96);

  const unknown = calculateImageEmuSize({ width: 0, height: 0, type: "unknown" });
  assert.equal(unknown.widthPt, 400);
  assert.equal(unknown.heightPt, 300);
});

test("calculateImageEmuSize：超过版心宽度时等比缩到版心内", () => {
  const dim = { width: 3000, height: 1000, type: "png" as const };
  const sized = calculateImageEmuSize(dim, { width: 9999, maxWidthPt: 430 });
  assert.equal(sized.widthPt, 430);
});
