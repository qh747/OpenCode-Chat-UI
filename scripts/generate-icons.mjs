#!/usr/bin/env node
/**
 * Generates icons/marketplace.png (256×256) with the official OpenCode favicon
 * geometry and colors — dark tile, white nested frame, gray center block.
 * Pure Node (zlib) PNG encoder so the artifact is reproducible anywhere.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SIZE = 256;
// Official favicon.svg colors / geometry (512-canvas ratios):
// bg #131010 full tile; white frame x 25..75%, y 18.75..81.25% (ring 12.5% of
// width); block #5A5858 x 37.5..62.5%, y 43.75..68.75%.
const BG = [0x13, 0x10, 0x10];
const RING = [0xff, 0xff, 0xff];
const BLOCK = [0x5a, 0x58, 0x58];

const px = new Uint8Array(SIZE * SIZE * 4);
const fillRect = (x0, y0, x1, y1, [r, g, b], alpha = 255) => {
  for (let y = Math.max(0, y0); y < Math.min(SIZE, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(SIZE, x1); x += 1) {
      const i = (y * SIZE + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = alpha;
    }
  }
};

fillRect(0, 0, SIZE, SIZE, BG);
const fx0 = Math.round(SIZE * 0.25);
const fy0 = Math.round(SIZE * 0.1875);
const fx1 = Math.round(SIZE * 0.75);
const fy1 = Math.round(SIZE * 0.8125);
const hx0 = Math.round(SIZE * 0.375);
const hy0 = Math.round(SIZE * 0.3125);
const hx1 = Math.round(SIZE * 0.625);
const hy1 = Math.round(SIZE * 0.6875);
const bx0 = hx0;
const by0 = Math.round(SIZE * 0.4375);
const bx1 = hx1;
const by1 = Math.round(SIZE * 0.6875);
fillRect(fx0, fy0, fx1, fy1, RING); // frame
fillRect(hx0, hy0, hx1, hy1, BG); // hole
fillRect(bx0, by0, bx1, by1, BLOCK); // center block

// --- minimal PNG encoder ----------------------------------------------------
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// raw scanlines with filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(root, "icons");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "marketplace.png");
writeFileSync(out, png);
console.log(`generated ${path.relative(root, out)} (${png.length} bytes, ${SIZE}x${SIZE})`);
