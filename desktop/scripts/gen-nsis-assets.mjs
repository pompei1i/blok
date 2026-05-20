/**
 * Generates NSIS installer header.bmp (150×57) and sidebar.bmp (164×314)
 * in the $blok dark terminal style. No external dependencies — raw BMP bytes.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../src-tauri/nsis-res");
mkdirSync(outDir, { recursive: true });

// ── Palette (all BGR — BMP stores Blue, Green, Red) ──────────────────────────
const BG     = [0x17, 0x11, 0x0D]; // #0D1117
const FG     = [0xD9, 0xD1, 0xC9]; // #C9D1D9 — light text
const RED    = [0x2A, 0x14, 0xC8]; // #C8142A — blok accent
const DARK2  = [0x1F, 0x19, 0x15]; // slightly lighter bg for scanlines

// ── Pixel font (5 × 6, 1 = lit) ──────────────────────────────────────────────
const FONT = {
  "$": ["01110","10100","01110","00101","01110","00100"],
  "b": ["10000","10000","11110","10001","10001","11110"],
  "l": ["11000","01000","01000","01000","01000","01110"],
  "o": ["00000","01110","10001","10001","10001","01110"],
  "k": ["10000","10010","10100","11000","10100","10011"],
  " ": ["00000","00000","00000","00000","00000","00000"],
  "v": ["00000","10001","10001","01010","01010","00100"],
  "0": ["01110","10011","10101","11001","01110","00000"],
  ".": ["00000","00000","00000","00000","01100","01100"],
  "1": ["00100","01100","00100","00100","00100","01110"],
  "2": ["01110","10001","00010","00100","01000","11111"],
};

// ── BMP builder ───────────────────────────────────────────────────────────────

function createBmp(width, height, paint) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixSize   = rowStride * height;
  const buf       = Buffer.alloc(54 + pixSize, 0);

  // File header
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(54 + pixSize, 2);
  buf.writeUInt32LE(54, 10);

  // DIB header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40,     14);
  buf.writeInt32LE(width,   18);
  buf.writeInt32LE(height,  22); // positive → bottom-up storage
  buf.writeUInt16LE(1,      26);
  buf.writeUInt16LE(24,     28);
  buf.writeInt32LE(2835,    38); // 72 DPI
  buf.writeInt32LE(2835,    42);

  // Pixel data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [b, g, r] = paint(x, y);
      const off = 54 + (height - 1 - y) * rowStride + x * 3;
      buf[off] = b; buf[off + 1] = g; buf[off + 2] = r;
    }
  }
  return buf;
}

// ── Text renderer ─────────────────────────────────────────────────────────────

function renderText(pixels, text, startX, startY, scale, color) {
  const glyphW = 5, glyphH = 6, gap = scale;
  let cx = startX;
  for (const ch of text.toLowerCase()) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let gy = 0; gy < glyphH; gy++) {
      for (let gx = 0; gx < glyphW; gx++) {
        if (glyph[gy][gx] === "1") {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + gx * scale + sx;
              const py = startY + gy * scale + sy;
              const key = `${px},${py}`;
              pixels.set(key, color);
            }
          }
        }
      }
    }
    cx += glyphW * scale + gap;
  }
}

// ── Header (150 × 57) — dark bar with "$blok" centered ───────────────────────

const headerPixels = new Map();

const H_TEXT   = "$blok";
const H_SCALE  = 2;
const GLYPH_W  = 5, GLYPH_H = 6;
const H_TW     = (GLYPH_W * H_SCALE + H_SCALE) * H_TEXT.length - H_SCALE;
const H_TH     = GLYPH_H * H_SCALE;
const H_TX     = Math.round((150 - H_TW) / 2);
const H_TY     = Math.round((57 - H_TH) / 2);
renderText(headerPixels, H_TEXT, H_TX, H_TY, H_SCALE, FG);

const headerBmp = createBmp(150, 57, (x, y) => {
  const key = `${x},${y}`;
  if (headerPixels.has(key)) return headerPixels.get(key);
  if (y === 0 || y === 1 || y === 55 || y === 56) return RED;
  if (y % 4 === 0) return DARK2;
  return BG;
});

// ── Sidebar (164 × 314) — dark panel with large "$blok" ──────────────────────

const sidePixels = new Map();

// Large "$blok" label — 4× scale
const S_SCALE = 4;
const S_TW    = (GLYPH_W * S_SCALE + S_SCALE) * 5 - S_SCALE; // "$blok" = 5 chars
const S_TH    = GLYPH_H * S_SCALE;
const S_TX    = Math.round((164 - S_TW) / 2);
const S_TY    = Math.round((314 / 2) - S_TH / 2) - 20;
renderText(sidePixels, "$blok", S_TX, S_TY, S_SCALE, FG);

// Small version subtitle "terminal chat" — 1× scale
const SUB_TW = (GLYPH_W + 1) * "terminal chat".length - 1;
const SUB_TX = Math.round((164 - SUB_TW) / 2);
const SUB_TY = S_TY + S_TH + 10;
renderText(sidePixels, "terminal chat", SUB_TX, SUB_TY, 1, RED);

const sidebarBmp = createBmp(164, 314, (x, y) => {
  const key = `${x},${y}`;
  if (sidePixels.has(key)) return sidePixels.get(key);
  if (x === 163 || x === 162) return RED;
  if (y === 0 || y === 1) return RED;
  if (y % 4 === 0) return DARK2;
  return BG;
});

// ── Write files ───────────────────────────────────────────────────────────────

writeFileSync(join(outDir, "header.bmp"),  headerBmp);
writeFileSync(join(outDir, "sidebar.bmp"), sidebarBmp);

console.log(`✓ header.bmp  150×57`);
console.log(`✓ sidebar.bmp 164×314`);
console.log(`  → ${outDir}`);
