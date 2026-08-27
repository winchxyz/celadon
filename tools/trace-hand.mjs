// ============================================================
//  Turn a picture of a hand into a distance field the shader can use.
//
//  Every hand I drew came out a mitten, and every set of capsule
//  parameters I tuned by eye came out my idea of a hand rather than the
//  one in the reference. This stops the guessing: it reads the picture,
//  measures the distance from every point to the silhouette, and bakes
//  that into a small texture the pot shader samples.
//
//  A distance FIELD rather than a traced polygon, on purpose. An outline
//  comes out at fifty or sixty edges, and a polygon SDF walks all of
//  them for every fragment of the pot; a 128x128 field is one texture
//  read whatever the shape.
//
//    node tools/trace-hand.mjs ref-hand.png
//
//  Writes src/render/handField.js.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/trace-hand.mjs <picture.png>');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`no such file: ${src}`);
  process.exit(1);
}

/* ---- read the PNG, without pulling in a dependency ----------------- */
function readPNG(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let i = 8, w = 0, h = 0, bitDepth = 0, colour = 0;
  const idat = [];
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('ascii', i + 4, i + 8);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colour = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`only 8-bit PNGs; this one is ${bitDepth}-bit`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!ch) throw new Error(`unsupported colour type ${colour}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * ch);
  let pos = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const up = prev[x];
      const ul = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - ul;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : ul);
      }
      cur[x] = v & 255;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out };
}

const img = readPNG(src);
const { w, h, ch, data } = img;

/* ---- ink or paper -------------------------------------------------- */
const ink = new Uint8Array(w * h);
for (let i = 0, p = 0; i < w * h; i++, p += ch) {
  const alpha = ch === 4 ? data[p + 3] : ch === 2 ? data[p + 1] : 255;
  const lum = ch >= 3
    ? data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722
    : data[p];
  ink[i] = (alpha > 128 && lum < 128) ? 1 : 0;
}

/* ---- keep only the largest blob.
       A waving hand is usually drawn with little motion arcs beside it,
       and those are separate shapes; without this they end up welded to
       the fingers. ---------------------------------------------------- */
const lab = new Int32Array(w * h).fill(-1);
let bestId = -1, bestN = 0, next = 0;
const stack = [];
for (let s = 0; s < w * h; s++) {
  if (!ink[s] || lab[s] >= 0) continue;
  const id = next;
  next += 1;
  let n = 0;
  stack.push(s);
  lab[s] = id;
  while (stack.length) {
    const c = stack.pop();
    n += 1;
    const cx = c % w, cy = (c / w) | 0;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of nb) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (ink[k] && lab[k] < 0) { lab[k] = id; stack.push(k); }
    }
  }
  if (n > bestN) { bestN = n; bestId = id; }
}
const mask = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) mask[i] = lab[i] === bestId ? 1 : 0;
console.log(`  largest shape: ${bestN}px of ${w}x${h} — ${next} shapes found, the rest dropped`);

/* ---- box it, square, with a margin -------------------------------- */
let x0 = w, y0 = h, x1 = 0, y1 = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
}
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const side = Math.max(bw, bh);
const box = side + Math.round(side * 0.10) * 2;
const ox = x0 - ((box - bw) >> 1);
const oy = y0 - ((box - bh) >> 1);
console.log(`  hand is ${bw}x${bh}, boxed at ${box}`);

/* ---- the field ----------------------------------------------------- */
const N = 128;
const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];
const edge = [];
for (let y = y0 - 1; y <= y1 + 1; y++) {
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (!at(x, y)) continue;
    if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) edge.push(x, y);
  }
}
console.log(`  ${edge.length / 2} boundary pixels`);

const RANGE = box * 0.32;               // what the 0..255 ramp spans, in source px
const field = new Uint8Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const sx = ox + (i + 0.5) * box / N;
    const sy = oy + (j + 0.5) * box / N;
    let d2 = Infinity;
    for (let e = 0; e < edge.length; e += 2) {
      const dx = edge[e] - sx, dy = edge[e + 1] - sy;
      const q = dx * dx + dy * dy;
      if (q < d2) d2 = q;
    }
    const inside = at(Math.round(sx), Math.round(sy));
    const d = (inside ? -1 : 1) * Math.sqrt(d2);
    field[j * N + i] = Math.max(0, Math.min(255, Math.round(128 + d / RANGE * 127)));
  }
  if (j % 16 === 0) process.stdout.write(`  measuring ${Math.round(j / N * 100)}%\r`);
}

/* ---- write a greyscale PNG ----------------------------------------- */
let TBL = null;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      TBL[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return b;
}
const rawRows = Buffer.alloc((N + 1) * N);
for (let y = 0; y < N; y++) {
  rawRows[y * (N + 1)] = 0;
  for (let x = 0; x < N; x++) rawRows[y * (N + 1) + 1 + x] = field[y * N + x];
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(rawRows)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = `// GENERATED by tools/trace-hand.mjs from ${path.basename(src)} — do not edit by hand.
//
// A signed distance field of the silhouette in that picture, baked to
// ${N}x${N}. 128 is the outline itself; below it is inside the hand and
// above it is outside, and the ramp spans ${RANGE.toFixed(1)} source pixels
// either way.
export const HAND_FIELD = '${'data:image/png;base64,' + png.toString('base64')}';
// how much of the field's half-width one 0..1 unit of distance covers
export const HAND_RANGE = ${(RANGE / (box * 0.5)).toFixed(5)};
`;
fs.mkdirSync('src/render', { recursive: true });
fs.writeFileSync('src/render/handField.js', out, 'utf8');
console.log(`\n  wrote src/render/handField.js  (${Math.round(png.length / 1024)} KB)`);
