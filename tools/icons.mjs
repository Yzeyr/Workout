// Draws the app icons (a barbell) as PNG files, with no dependencies.
//   node tools/icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const BG = [0x12, 0x17, 0x1C], BAR = [0xEC, 0xE8, 0xE0], PLATE = [0x8C, 0xC7, 0xB4], SMALL = [0xEE, 0x84, 0x66];

// Shapes in a 0..1 square: [x0, y0, x1, y1, colour, corner radius]
function shapes(scale) {
  const s = (v) => 0.5 + (v - 0.5) * scale;
  const r = (x0, y0, x1, y1, c, rad) => [s(x0), s(y0), s(x1), s(y1), c, rad * scale];
  return [
    r(0.10, 0.475, 0.90, 0.525, BAR, 0.012),
    r(0.20, 0.27, 0.285, 0.73, PLATE, 0.02),
    r(0.715, 0.27, 0.80, 0.73, PLATE, 0.02),
    r(0.295, 0.35, 0.34, 0.65, SMALL, 0.014),
    r(0.66, 0.35, 0.705, 0.65, SMALL, 0.014),
  ];
}

function inside(x, y, [x0, y0, x1, y1, , rad]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad), cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
}

function png(size, scale) {
  const list = shapes(scale), N = 4; // 4×4 samples per pixel for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        const x = (px + (sx + 0.5) / N) / size, y = (py + (sy + 0.5) / N) / size;
        let c = BG;
        for (const sh of list) if (inside(x, y, sh)) c = sh[4];
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = acc[0] / (N * N); raw[o + 1] = acc[1] / (N * N); raw[o + 2] = acc[2] / (N * N); raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(join(root, 'icons'), { recursive: true });
writeFileSync(join(root, 'icons', 'icon-192.png'), png(192, 1));
writeFileSync(join(root, 'icons', 'icon-512.png'), png(512, 1));
writeFileSync(join(root, 'icons', 'icon-maskable-512.png'), png(512, 0.78));
writeFileSync(join(root, 'icons', 'apple-touch-icon.png'), png(180, 1));
console.log('icons written');
