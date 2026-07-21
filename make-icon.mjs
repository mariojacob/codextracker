/**
 * Generate app icon: 256x256 PNG (green dot on dark), 32x32 ICO for tray.
 * Run once: `node make-icon.mjs`
 *
 * Uses Node's built-in zlib + manual PNG/ICO encoding — no external deps.
 * Output: assets/icon.png + assets/icon.ico
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib';

const SIZE = 256;
const CENTER = SIZE / 2;
const RADIUS_OUTER = 110; // outer green ring
const RADIUS_INNER = 88;  // inner dark hole

/** Build a 32-bit RGBA buffer for the icon (premultiplied alpha). */
function buildIcon() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = (y * SIZE + x) * 4;
      let r8, g8, b8, a8;
      if (r <= RADIUS_INNER) {
        // Inner: dark grey background of the donut
        r8 = 24; g8 = 24; b8 = 27; a8 = 255;
      } else if (r <= RADIUS_OUTER) {
        // Ring: accent green
        r8 = 16; g8 = 163; b8 = 127; a8 = 255;
      } else {
        // Outside: transparent
        r8 = 0; g8 = 0; b8 = 0; a8 = 0;
      }
      buf[i] = r8;
      buf[i + 1] = g8;
      buf[i + 2] = b8;
      buf[i + 3] = a8;
    }
  }
  return buf;
}

// ---- PNG encoder ----
function be32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const len = be32(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = be32(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, width, height) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter byte 0 per scanline, then RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO encoder (single 32x32 PNG-in-ICO entry) ----
function encodeIco(png, size) {
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + PNG data
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);    // reserved
  dir.writeUInt16LE(1, 2);    // type: icon
  dir.writeUInt16LE(1, 4);    // count

  const entry = Buffer.alloc(16);
  entry[0] = size;             // width (0 = 256)
  entry[1] = size;             // height
  entry[2] = 0;                // colors
  entry[3] = 0;                // reserved
  entry.writeUInt16LE(1, 4);   // planes
  entry.writeUInt16LE(32, 6);  // bit count
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset = 6 + 16

  return Buffer.concat([dir, entry, png]);
}

mkdirSync('assets', { recursive: true });

const rgba = buildIcon();
const png256 = encodePng(rgba, SIZE, SIZE);
writeFileSync('assets/icon.png', png256);
console.log('Wrote assets/icon.png (' + png256.length + ' bytes, 256x256)');

// ---- ICO encoder (multi-size PNG-in-ICO: 32x32 for tray, 256x256 for app) ----
function encodeIcoMulti(entries) {
  // entries: [{ png: Buffer, size: number }]
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);    // reserved
  dir.writeUInt16LE(1, 2);    // type: icon
  dir.writeUInt16LE(entries.length, 4);

  const entryHeaders = [];
  let dataOffset = 6 + 16 * entries.length;
  for (const { png, size } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;                      // colors
    e[3] = 0;                      // reserved
    e.writeUInt16LE(1, 4);         // planes
    e.writeUInt16LE(32, 6);        // bit count
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(dataOffset, 12);
    entryHeaders.push(e);
    dataOffset += png.length;
  }

  return Buffer.concat([dir, ...entryHeaders, ...entries.map(e => e.png)]);
}

// Downscale to 32x32 for the ICO (and tray)
const rgba32 = Buffer.alloc(32 * 32 * 4);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const sx = Math.floor((x * SIZE) / 32);
    const sy = Math.floor((y * SIZE) / 32);
    rgba.copy(rgba32, (y * 32 + x) * 4, (sy * SIZE + sx) * 4, (sy * SIZE + sx) * 4 + 4);
  }
}
const png32 = encodePng(rgba32, 32, 32);
const ico = encodeIcoMulti([
  { png: png32, size: 32 },
  { png: png256, size: 256 },
]);
writeFileSync('assets/icon.ico', ico);
console.log('Wrote assets/icon.ico (' + ico.length + ' bytes, 32x32 + 256x256)');
