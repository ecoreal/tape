// Frames → pixels. A terminal frame is a grid of coloured characters; a GIF
// frame is a palette-indexed raster. This module turns one into the other
// (ANSI SGR → palette indices) and builds the film of a session: a scrolling
// timeline that reveals one step at a time, with a ribbon of the whole session
// underneath so you can see its shape while it plays.
import { encodeGif } from './gif.js';
import { glyph, drawable, GLYPH_H, ADVANCE, LINE_H as FONT_LINE_H } from './font.js';
import { writeFileSync } from 'node:fs';

const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

// Index 0 is the background; 1-4 are chrome; 5.. are the 8 ANSI hues in
// base / bright / dim, so any SGR sequence maps to one of them.
export const PALETTE = [
  '#0b0e14', '#c9d1d9', '#8b949e', '#30363d', '#1b2330',
  // black
  '#3d4250', '#6e7681', '#262b36',
  // red
  '#e5534b', '#ff7b72', '#7f3a37',
  // green
  '#3fb950', '#56d364', '#2b6b36',
  // yellow
  '#d29922', '#e3b341', '#6f5518',
  // blue
  '#2f81f7', '#58a6ff', '#1e4a8a',
  // magenta
  '#bc8cff', '#d2a8ff', '#5f4a80',
  // cyan
  '#39c5cf', '#56d4dd', '#246f75',
  // white
  '#b1bac4', '#f0f6fc', '#6e7681',
].map(hex);

// Index reserved for "unchanged since the previous frame". It is a real palette
// slot (the table is padded to 32 entries), but transparent frames never paint
// it, so the viewer keeps whatever was already on screen.
export const TRANSPARENT = PALETTE.length;

export const C = {
  bg: 0, ink: 1, dim: 2, faint: 3, band: 4,
  hue: (h, mode = 0) => 5 + h * 3 + mode, // mode: 0 base · 1 bright · 2 dim
};

// The six event types, as ANSI-ish hues and single-letter gutter marks.
export const TYPE_STYLE = {
  user: { hue: 6, mark: 'U' },
  assistant: { hue: 5, mark: 'A' },
  tool_use: { hue: 3, mark: 'T' },
  tool_result: { hue: 2, mark: 'R' },
  error: { hue: 1, mark: '!' },
  system: { hue: 0, mark: 'S' },
};
export const TYPE_HUES = Object.fromEntries(Object.entries(TYPE_STYLE).map(([k, v]) => [k, v.hue]));

export function createCanvas(w, h, bg = C.bg) {
  const px = new Uint8Array(w * h).fill(bg);
  return { w, h, px };
}

export function rect(cv, x, y, w, h, idx) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(cv.w, x + w), y1 = Math.min(cv.h, y + h);
  for (let yy = y0; yy < y1; yy++) cv.px.fill(idx, yy * cv.w + x0, yy * cv.w + x1);
}

/** Draw one line of text; returns the x after the last glyph. Unknown chars are skipped. */
export function text(cv, x, y, s, idx, scale = 1) {
  const str = drawable(s);
  let cx = x;
  for (const ch of str) {
    const rows = glyph(ch);
    if (!rows) continue;
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const bits = rows[gy];
      if (!bits) continue;
      for (let gx = 0; gx < 5; gx++) {
        if (!(bits & (1 << (4 - gx)))) continue;
        rect(cv, cx + gx * scale, y + gy * scale, scale, scale, idx);
      }
    }
    cx += ADVANCE * scale;
  }
  return cx;
}

/** Width in pixels a string will occupy (no ANSI, no truncation). */
export const textWidth = (s, scale = 1) => drawable(s).length * ADVANCE * scale;

/** Fit a string into `cols` characters; '…'-free because the font has no ellipsis. */
export function fit(s, cols) {
  const d = drawable(s);
  return d.length <= cols ? d : d.slice(0, Math.max(0, cols - 1)) + '~';
}

const SGR = /\x1b\[([0-9;]*)m/g;

/**
 * Rasterize ANSI-coloured text lines (the output of renderFrame) into a canvas.
 * Understands exactly what tape/duel emit: 0/1/2 and 30-37/90-97.
 */
export function ansiLinesToCanvas(cv, lines, x0, y0, { scale = 1, lineH = FONT_LINE_H * scale, maxCols = Infinity } = {}) {
  let y = y0;
  for (const line of lines) {
    let hue = null, bright = false, dimmed = false, cx = x0;
    const parts = String(line).split(SGR);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) { // this part is an SGR parameter list
        for (const p of parts[i].split(';')) {
          const n = Number(p || 0);
          if (n === 0) { hue = null; bright = false; dimmed = false; }
          else if (n === 1) bright = true;
          else if (n === 2) dimmed = true;
          else if (n === 22) { bright = false; dimmed = false; }
          else if (n >= 30 && n <= 37) hue = n - 30;
          else if (n >= 90 && n <= 97) { hue = n - 90; bright = true; }
          else if (n === 39) hue = null;
        }
        continue;
      }
      const idx = hue == null ? (dimmed ? C.dim : C.ink) : C.hue(hue, bright ? 1 : dimmed ? 2 : 0);
      const chunk = parts[i];
      if (cx >= x0 + maxCols * ADVANCE * scale) break;
      text(cv, cx, y, chunk.slice(0, Math.max(0, maxCols - Math.round((cx - x0) / (ADVANCE * scale)))), idx, scale);
      cx += drawable(chunk).length * ADVANCE * scale;
    }
    y += lineH;
  }
  return y;
}

const basename = p => String(p || '').split(/[\\/]/).pop() || 'session';

/**
 * Build the film: palette-indexed frames for an animated session timeline.
 * Deterministic — same events + same options ⇒ byte-identical GIF.
 */
/**
 * Turn full frames into delta frames: anything identical to the previous frame
 * becomes TRANSPARENT. The first frame must stay complete (there is nothing to
 * keep on screen yet). Text films change a few rows per step, so this is where
 * the bytes go — unchanged chrome costs nothing.
 */
export function deltaFrames(frames, transparentIndex = TRANSPARENT) {
  let prev = null;
  return frames.map(f => {
    if (!prev) { prev = f.pixels.slice(); return { ...f, changed: f.pixels.length }; }
    const out = new Uint8Array(f.pixels.length);
    let changed = 0;
    for (let i = 0; i < f.pixels.length; i++) {
      if (f.pixels[i] === prev[i]) out[i] = transparentIndex;
      else { out[i] = f.pixels[i]; changed++; }
    }
    prev = f.pixels.slice();
    return { ...f, pixels: out, changed };
  });
}

export function buildFilm({
  file = 'session', events = [], skipped = 0, meta = 0,
  width = 800, rows = 12, frames: maxFrames = 48, delayCs = 8, scale = 2,
  diff = true,
} = {}) {
  if (!events.length) throw new Error('no events to film');
  const charW = ADVANCE * scale;
  const lineH = FONT_LINE_H * scale;
  const pad = 12;
  const headerH = 2 * lineH;
  const ribbonH = 6 * scale;
  const legendH = FONT_LINE_H;
  const height = pad * 2 + headerH + rows * lineH + 8 + ribbonH + 8 + legendH;
  const cols = Math.floor((width - pad * 2) / charW);
  const gutterCols = 2; // one mark column + one gap
  const titleCols = cols - gutterCols - 1; // keep a column of air on the right

  const total = events.length;
  const steps = Math.min(maxFrames, total);
  const stride = Math.max(1, Math.ceil(total / steps));
  const stops = [];
  for (let k = 0; k < steps; k++) stops.push(Math.min(total - 1, k * stride));
  if (stops[stops.length - 1] !== total - 1) stops.push(total - 1);

  const ribbonY = height - pad - legendH - 8 - ribbonH;
  const out = [];

  for (const stop of stops) {
    const cv = createCanvas(width, height);
    const style = e => TYPE_STYLE[e.type] || TYPE_STYLE.system;

    // header: what this is, and how far we are
    let x = text(cv, pad, pad, 'TAPE FILM', C.ink, scale);
    x = text(cv, x + charW, pad, '*', C.dim, scale);
    text(cv, x + charW, pad, fit(basename(file), 30), C.dim, scale);
    const counter = `STEP ${stop + 1}/${total}`;
    text(cv, width - pad - textWidth(counter, scale), pad, counter, C.hue(6, 1), scale);
    const notes = [];
    const errs = events.filter(e => e.type === 'error').length;
    if (errs) notes.push(`${errs} ERROR${errs === 1 ? '' : 'S'}`);
    if (skipped) notes.push(`${skipped} SKIPPED`);
    if (meta) notes.push(`${meta} META`);
    if (notes.length) text(cv, pad, pad + lineH, notes.join(' * '), C.dim, scale);
    rect(cv, pad, pad + headerH - 6, width - pad * 2, 1, C.faint);

    // the steps, windowed so the current one stays on screen
    const start = Math.max(0, Math.min(stop - rows + 1, total - rows));
    for (let r = 0; r < rows; r++) {
      const i = start + r;
      if (i >= total) break;
      const e = events[i];
      const st = style(e);
      const y = pad + headerH + r * lineH;
      const current = i === stop;
      if (current) rect(cv, pad - 4, y - 3, width - pad * 2 + 8, lineH - 1, C.band);
      const dimMode = i > stop ? 2 : 0;
      text(cv, pad, y, st.mark, C.hue(st.hue, current ? 1 : dimMode), scale);
      const body = fit(e.title ?? e.text ?? `(${e.type})`, titleCols);
      text(cv, pad + gutterCols * charW, y, body, current ? C.ink : i > stop ? C.faint : C.dim, scale);
    }

    // ribbon: the whole session in one strip, bright at the cursor
    const ribbonW = width - pad * 2;
    const segW = Math.max(1, Math.floor(ribbonW / total));
    for (let i = 0; i < total; i++) {
      const st = style(events[i]);
      const idx = i > stop ? C.faint : C.hue(st.hue, i === stop ? 1 : 0);
      rect(cv, pad + i * segW, ribbonY, Math.max(1, segW - (segW > 2 ? 1 : 0)), i === stop ? ribbonH : ribbonH - 2, idx);
    }

    // legend at a small scale: one swatch + mark per event type
    let lx = pad;
    const ly = height - pad - legendH + 1;
    for (const [, st] of Object.entries(TYPE_STYLE)) {
      rect(cv, lx, ly + 1, 5, 5, C.hue(st.hue, 0));
      lx = text(cv, lx + 8, ly, st.mark, C.dim, 1) + 8;
    }
    const tail = `${total} STEPS`;
    text(cv, width - pad - textWidth(tail, 1), ly, tail, C.faint, 1);

    out.push({ pixels: cv.px, delayCs });
  }

  return {
    width,
    height,
    palette: PALETTE,
    frames: diff ? deltaFrames(out) : out,
    transparent: diff ? TRANSPARENT : null,
  };
}

/** Write the film to disk as an animated GIF. */
export function writeFilm(out, film) {
  const buf = encodeGif(film);
  writeFileSync(out, buf);
  return { path: out, bytes: buf.length, frames: film.frames.length, width: film.width, height: film.height };
}