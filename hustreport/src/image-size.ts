/**
 * 轻量级、零依赖的图片尺寸探测器与 Word DrawingML 尺寸计算。
 * 支持 PNG, JPEG, GIF, WebP。
 */

export interface ImageDimensions {
  width: number;
  height: number;
  type: "png" | "jpeg" | "gif" | "webp" | "unknown";
}

export interface ImageEmuSize {
  cx: number;
  cy: number;
  widthPt: number;
  heightPt: number;
}

/** 1 pt = 12700 EMUs, 1 inch = 72 pt = 914400 EMUs */
export const EMU_PER_PT = 12700;
export const EMU_PER_PX = 9525; // 96 DPI

/** 默认版心最大可用宽度：~430 pt (约 5,461,000 EMUs，标准 A4 减去常规左右页边距 1800 dxa * 2) */
export const DEFAULT_MAX_IMAGE_WIDTH_PT = 430;
export const DEFAULT_MAX_IMAGE_WIDTH_EMU = DEFAULT_MAX_IMAGE_WIDTH_PT * EMU_PER_PT;

/** 从图片二进制 Buffer 中读取原始宽度与高度 */
export function getImageDimensions(buffer: Buffer): ImageDimensions {
  if (!buffer || buffer.length < 16) {
    return { width: 0, height: 0, type: "unknown" };
  }

  // PNG: 前 8 字节为 \x89PNG\r\n\x1a\n，宽高在 16..24 (Big Endian)
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height, type: "png" };
    }
  }

  // GIF: 前 6 字节为 GIF87a 或 GIF89a，宽高在 6..10 (Little Endian)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    if (buffer.length >= 10) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height, type: "gif" };
    }
  }

  // WebP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    // VP8
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20 && buffer.length >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height, type: "webp" };
    }
    // VP8L (lossless)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4c && buffer.length >= 25) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, type: "webp" };
    }
    // VP8X (extended)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58 && buffer.length >= 30) {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height, type: "webp" };
    }
  }

  // JPEG: 以 0xFFD8 开始，寻找 SOF 标记 (0xFFC0..0xFFC3, 0xFFC5..0xFFC7, 0xFFC9..0xFFCB, 0xFFCD..0xFFCF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      // 遇到连续 0xFF 或者 0x00 填充跳过
      if (marker === 0xff || marker === 0x00) {
        offset += 1;
        continue;
      }
      // SOS (Start of Scan) 或 EOI (End of Image) 停止扫描
      if (marker === 0xda || marker === 0xd9) break;

      const blockLength = buffer.readUInt16BE(offset + 2);
      // SOF 标记
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 2 + blockLength <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height, type: "jpeg" };
        }
      }
      offset += 2 + blockLength;
    }
  }

  return { width: 0, height: 0, type: "unknown" };
}

/** 根据原始图片尺寸与配置要求，计算适合 Word 页面排版的 EMU 尺寸 */
export function calculateImageEmuSize(
  dim: ImageDimensions,
  options: {
    maxWidthPt?: number;
    size?: string | number; // "max", "80%", 300 (pt), "400px"
    width?: string | number;
    height?: string | number;
  } = {},
): ImageEmuSize {
  const maxWidthPt = options.maxWidthPt ?? DEFAULT_MAX_IMAGE_WIDTH_PT;

  // 如果未能探测出尺寸，回退到标准 400x300pt
  if (dim.width <= 0 || dim.height <= 0) {
    return {
      widthPt: 400,
      heightPt: 300,
      cx: 400 * EMU_PER_PT,
      cy: 300 * EMU_PER_PT,
    };
  }

  const aspectRatio = dim.width / dim.height;

  // 1. 显式指定了 width
  const rawWidth = options.width ?? options.size;
  let targetWidthPt: number | undefined;

  if (typeof rawWidth === "number" && rawWidth > 0) {
    targetWidthPt = rawWidth;
  } else if (typeof rawWidth === "string") {
    const trimmed = rawWidth.trim().toLowerCase();
    if (trimmed.endsWith("%")) {
      const pct = parseFloat(trimmed) / 100;
      if (!Number.isNaN(pct) && pct > 0) {
        targetWidthPt = maxWidthPt * Math.min(pct, 1.0);
      }
    } else if (trimmed.endsWith("px")) {
      const px = parseFloat(trimmed);
      if (!Number.isNaN(px) && px > 0) {
        targetWidthPt = (px * 72) / 96;
      }
    } else if (trimmed.endsWith("pt")) {
      const pt = parseFloat(trimmed);
      if (!Number.isNaN(pt) && pt > 0) {
        targetWidthPt = pt;
      }
    } else if (trimmed === "max" || trimmed === "full") {
      targetWidthPt = maxWidthPt;
    }
  }

  // 2. 默认行为：如果图片本身原始尺寸小于版心宽度，按 96DPI 真实尺寸显示；如果大于版心，等比缩小到版心最大宽度
  const rawWidthPt = (dim.width * 72) / 96;
  if (!targetWidthPt) {
    targetWidthPt = Math.min(maxWidthPt, Math.max(rawWidthPt, maxWidthPt));
  }

  // 限制最大不能超过版心宽度
  targetWidthPt = Math.min(targetWidthPt, maxWidthPt);

  // 计算高度保持比例
  let targetHeightPt = targetWidthPt / aspectRatio;

  // 如果也指定了 height，尊重 height
  if (options.height) {
    if (typeof options.height === "number") targetHeightPt = options.height;
    else if (typeof options.height === "string") {
      const h = parseFloat(options.height);
      if (!Number.isNaN(h) && h > 0) targetHeightPt = h;
    }
  }

  const cx = Math.round(targetWidthPt * EMU_PER_PT);
  const cy = Math.round(targetHeightPt * EMU_PER_PT);

  return {
    widthPt: targetWidthPt,
    heightPt: targetHeightPt,
    cx,
    cy,
  };
}
