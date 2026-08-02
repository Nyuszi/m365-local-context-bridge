#!/usr/bin/env node
/**
 * Generates placeholder PNG toolbar/store icons for the extension without any
 * external image dependencies. Chrome's manifest `icons`/`action.default_icon`
 * fields only accept raster formats (PNG/BMP/GIF/ICO/JPEG) - SVG is not
 * supported there - so we hand-encode minimal PNGs at build time.
 *
 * The design is a simple "bridge" glyph: two nodes connected by a bar, on a
 * rounded, solid-color square. Good enough as a placeholder brand mark.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = fileURLToPath(new URL('../public/icons', import.meta.url));
mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 128];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, getPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = getPixel(x, y);
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }
  const idat = chunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function roundedSquareAlpha(x, y, size, radius) {
  const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
  const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius ? 255 : 0;
}

function circle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const BG = [0x15, 0x4a, 0xb8]; // brand blue
const FG = [0xff, 0xff, 0xff];

function makeIcon(size) {
  const radius = Math.max(2, Math.round(size * 0.22));
  const nodeR = Math.max(1.4, size * 0.135);
  const barHalfH = Math.max(0.8, size * 0.06);
  const leftX = size * 0.3;
  const rightX = size * 0.7;
  const midY = size * 0.52;

  return encodePNG(size, size, (x, y) => {
    const bgAlpha = roundedSquareAlpha(x, y, size, radius);
    if (bgAlpha === 0) return [0, 0, 0, 0];

    const onLeftNode = circle(x, y, leftX, midY, nodeR);
    const onRightNode = circle(x, y, rightX, midY, nodeR);
    const onBar = x >= leftX && x <= rightX && Math.abs(y - midY) <= barHalfH && size >= 24;

    if (onLeftNode || onRightNode || onBar) {
      return [...FG, 255];
    }
    return [...BG, bgAlpha];
  });
}

for (const size of SIZES) {
  const buf = makeIcon(size);
  const file = path.join(outDir, `icon-${size}.png`);
  writeFileSync(file, buf);
  console.log(`generated ${file} (${buf.length} bytes)`);
}
