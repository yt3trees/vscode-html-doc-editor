// Generates icon.png (128x128) using only Node.js built-ins.
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 128, H = 128;
const buf = new Uint8Array(W * H * 4); // RGBA

// ---- pixel primitives ----

function blend(dst, i, r, g, b, a) {
  const sa = a / 255, da = buf[i+3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 1e-6) return;
  buf[i]   = ((r * sa + buf[i]   * da * (1 - sa)) / oa) | 0;
  buf[i+1] = ((g * sa + buf[i+1] * da * (1 - sa)) / oa) | 0;
  buf[i+2] = ((b * sa + buf[i+2] * da * (1 - sa)) / oa) | 0;
  buf[i+3] = (oa * 255) | 0;
}

function px(x, y, r, g, b, a = 255) {
  x = x | 0; y = y | 0;
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  blend(buf, (y * W + x) * 4, r, g, b, a);
}

// Filled circle (for rounded-rect corners)
function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx*dx + dy*dy;
      if (d2 <= r2) {
        px(cx+dx, cy+dy, r, g, b, a);
      } else if (d2 <= (radius+1)*(radius+1)) {
        // anti-alias edge
        const alpha = Math.max(0, radius + 1 - Math.sqrt(d2));
        px(cx+dx, cy+dy, r, g, b, (a * alpha) | 0);
      }
    }
  }
}

// Filled axis-aligned rectangle
function fillRect(x, y, w, h, r, g, b, a = 255) {
  for (let py = y; py < y + h; py++)
    for (let px2 = x; px2 < x + w; px2++)
      px(px2, py, r, g, b, a);
}

// Rounded rectangle (filled)
function roundedRect(x, y, w, h, rad, r, g, b, a = 255) {
  fillRect(x + rad, y,       w - 2*rad, h,       r, g, b, a);
  fillRect(x,       y + rad, rad,       h-2*rad, r, g, b, a);
  fillRect(x+w-rad, y + rad, rad,       h-2*rad, r, g, b, a);
  fillCircle(x+rad,   y+rad,   rad, r, g, b, a);
  fillCircle(x+w-rad, y+rad,   rad, r, g, b, a);
  fillCircle(x+rad,   y+h-rad, rad, r, g, b, a);
  fillCircle(x+w-rad, y+h-rad, rad, r, g, b, a);
}

// Thick line via scanline-filled rotated rectangle
function thickLine(x1, y1, x2, y2, thick, r, g, b, a = 255) {
  const dx = x2-x1, dy = y2-y1;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 1e-6) return;
  const ux = dx/len, uy = dy/len;
  const nx = -uy * thick/2, ny = ux * thick/2;
  const corners = [
    [x1+nx, y1+ny], [x2+nx, y2+ny],
    [x2-nx, y2-ny], [x1-nx, y1-ny],
  ];
  const minY = Math.floor(Math.min(...corners.map(c=>c[1])));
  const maxY = Math.ceil( Math.max(...corners.map(c=>c[1])));
  for (let py2 = minY; py2 <= maxY; py2++) {
    const xs = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i+1)%4];
      if ((ay <= py2 && by > py2) || (by <= py2 && ay > py2)) {
        xs.push(ax + (py2-ay)/(by-ay) * (bx-ax));
      }
    }
    if (xs.length >= 2) {
      xs.sort((a2,b2) => a2-b2);
      for (let px2 = Math.floor(xs[0]); px2 <= Math.ceil(xs[xs.length-1]); px2++) {
        px(px2, py2, r, g, b, a);
      }
    }
  }
  // Round caps
  fillCircle(x1, y1, thick/2, r, g, b, a);
  fillCircle(x2, y2, thick/2, r, g, b, a);
}

// ---- icon design ----

// Background: deep navy #1a1e30
roundedRect(0, 0, 128, 128, 18, 0x1a, 0x1e, 0x30);

// Subtle inner glow (lighter center gradient strip) — horizontal fade
for (let y = 20; y < 108; y++) {
  for (let x = 20; x < 108; x++) {
    const cx = x - 64, cy = y - 64;
    const d = Math.sqrt(cx*cx + cy*cy);
    const a = Math.max(0, (60 - d) / 60 * 18) | 0;
    px(x, y, 0x4a, 0x60, 0xa0, a);
  }
}

// Blue: #4a90d9
const [R, G, B] = [0x4a, 0x90, 0xd9];
const T = 11; // line thickness

// Vertical span of symbols
const TOP = 27, MID = 64, BOT = 101;

// < bracket  (left: x=13, right: x=44)
thickLine(43, TOP, 13, MID, T, R, G, B);
thickLine(13, MID, 43, BOT, T, R, G, B);

// / slash  (from x=75/bot to x=55/top)
thickLine(72, BOT, 56, TOP, T, R, G, B);

// > bracket  (left: x=84, right: x=115)
thickLine(85, TOP, 115, MID, T, R, G, B);
thickLine(115, MID, 85, BOT, T, R, G, B);


// ---- PNG encoding ----

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const ci = Buffer.concat([tb, data]);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(ci));
  return Buffer.concat([len, tb, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8]=8; ihdr[9]=6; // RGBA

const raw = Buffer.alloc(H * (1 + W*4));
for (let y = 0; y < H; y++) {
  raw[y*(1+W*4)] = 0; // filter None
  for (let x = 0; x < W; x++) {
    const s = (y*W+x)*4, d = y*(1+W*4)+1+x*4;
    raw[d]=buf[s]; raw[d+1]=buf[s+1]; raw[d+2]=buf[s+2]; raw[d+3]=buf[s+3];
  }
}

const idat = zlib.deflateSync(raw, { level: 9 });

const out = Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const dest = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(dest, out);
console.log(`icon.png written (${out.length} bytes)`);
