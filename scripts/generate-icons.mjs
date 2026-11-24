import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ICONS_DIR = path.resolve(process.cwd(), 'public/icons');
const SIZES = [16, 32, 48, 128];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

function blendPixel(buf, idx, r, g, b, a) {
  const srcA = clamp(a, 0, 1);
  if (srcA <= 0) return;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  const dstR = buf[idx];
  const dstG = buf[idx + 1];
  const dstB = buf[idx + 2];

  buf[idx] = Math.round((r * srcA + dstR * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((g * srcA + dstG * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((b * srcA + dstB * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const idx = (py * size + px) * 4;

      // Rounded gradient background (#1d4ed8 -> #0ea5e9)
      const bgDist = sdRoundedBox(u, v, 0.5, 0.5, 0.45, 0.45, 0.22);
      const bgAlpha = 1 - smoothstep(-aa, aa, bgDist);
      if (bgAlpha > 0) {
        const t = clamp((u + v) * 0.5, 0, 1);
        const r = Math.round(37 + (14 - 37) * t);
        const g = Math.round(99 + (165 - 99) * t);
        const b = Math.round(235 + (233 - 235) * t);
        blendPixel(buf, idx, r, g, b, bgAlpha);
      }

      // Floating preview card (white rounded window)
      const cardDist = sdRoundedBox(u, v, 0.5, 0.52, 0.31, 0.27, 0.08);
      const cardAlpha = 1 - smoothstep(-aa, aa, cardDist);
      if (cardAlpha > 0) {
        blendPixel(buf, idx, 255, 255, 255, cardAlpha * 0.96);
      }

      // Window header bar accent
      const headerDist = sdRoundedBox(u, v, 0.5, 0.33, 0.27, 0.045, 0.03);
      const headerAlpha = 1 - smoothstep(-aa, aa, headerDist);
      if (headerAlpha > 0 && cardAlpha > 0) {
        blendPixel(buf, idx, 219, 234, 254, headerAlpha * cardAlpha);
      }

      // Content lines inside preview window
      const line1 = sdRoundedBox(u, v, 0.46, 0.48, 0.19, 0.028, 0.02);
      const line2 = sdRoundedBox(u, v, 0.42, 0.58, 0.15, 0.026, 0.02);
      const line3 = sdRoundedBox(u, v, 0.40, 0.68, 0.13, 0.026, 0.02);
      const lineDist = Math.min(line1, line2, line3);
      const lineAlpha = 1 - smoothstep(-aa, aa, lineDist);
      if (lineAlpha > 0 && cardAlpha > 0) {
        blendPixel(buf, idx, 148, 163, 184, lineAlpha * 0.85);
      }

      // Bottom-right resize / preview badge circle
      const bx = 0.72;
      const by = 0.69;
      const badgeDist = Math.hypot(u - bx, v - by) - 0.14;
      const badgeAlpha = 1 - smoothstep(-aa, aa, badgeDist);
      if (badgeAlpha > 0) {
        blendPixel(buf, idx, 15, 23, 42, badgeAlpha);
      }

      // Inner bright dot / eye pupil inside badge
      const pupilDist = Math.hypot(u - bx, v - by) - 0.055;
      const pupilAlpha = 1 - smoothstep(-aa, aa, pupilDist);
      if (pupilAlpha > 0) {
        blendPixel(buf, idx, 56, 189, 248, pupilAlpha);
      }
    }
  }

  return encodePng(size, size, buf);
}

const SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="28" fill="url(#bg)" />
  <rect x="24" y="32" width="80" height="68" rx="10" fill="#ffffff" fill-opacity="0.96" />
  <rect x="30" y="38" width="68" height="11" rx="4" fill="#dbeafe" />
  <rect x="34" y="58" width="48" height="7" rx="3.5" fill="#94a3b8" />
  <rect x="34" y="71" width="38" height="6.5" rx="3.25" fill="#94a3b8" />
  <rect x="34" y="84" width="32" height="6.5" rx="3.25" fill="#94a3b8" />
  <circle cx="92" cy="88" r="18" fill="#0f172a" />
  <circle cx="92" cy="88" r="7" fill="#38bdf8" />
</svg>
`;

fs.mkdirSync(ICONS_DIR, { recursive: true });
fs.writeFileSync(path.join(ICONS_DIR, 'icon.svg'), SVG_SOURCE, 'utf8');

for (const size of SIZES) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(ICONS_DIR, `icon-${size}.png`), png);
}

console.log(`Generated icons (${SIZES.join(', ')}px + SVG) in ${ICONS_DIR}`);
