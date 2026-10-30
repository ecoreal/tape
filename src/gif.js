// A GIF89a encoder in ~90 lines: global palette, LZW, animation loop.
// No dependencies, no native code — the film of a session is just bytes.
//
// Reference for the LZW code-size rule: GIFCOMPR (free_ent > MAXCODE(n_bits)),
// which is also what every decoder expects. Frames are palette indices.

// GIF packs codes LSB-first into a byte stream; sub-blocks carry ≤255 bytes.
function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = [];
  let acc = 0, bits = 0, codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map();
  const emit = code => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(acc & 0xff); acc >>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    // GIFCOMPR bumps the code width *before* adding the entry (its check runs
    // inside output(), i.e. against the count from the previous misses) — do
    // the same or the decoder desyncs by one entry.
    if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    if (next < 4096) {
      dict.set(key, next++);
    } else { // table full: clear and start over, exactly like the reference
      emit(clear);
      dict = new Map(); codeSize = minCodeSize + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits) out.push(acc & 0xff);
  return out;
}

const u16 = n => [n & 0xff, (n >> 8) & 0xff];

// push(...) would blow the argument limit on big frames — append in chunks
function pushAll(dst, src) {
  for (let i = 0; i < src.length; i += 4096) dst.push.apply(dst, src.slice(i, i + 4096));
}

// Split a byte stream into GIF sub-blocks (length byte + ≤255 payload bytes).
function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0); // block terminator
  return out;
}

/**
 * encodeGif({ width, height, palette, frames, delayCs, loop })
 *  palette: [[r,g,b], ...] (≤256); index 0 is the background
 *  frames:  [{ pixels: Uint8Array|number[] (width*height indices), delayCs? }]
 * Returns a Buffer.
 */
export function encodeGif({ width, height, palette, frames, delayCs = 12, loop = 0, transparent = null }) {
  const pal = palette.slice(0, 256);
  // the global color table must be a power of two, at least 2 entries
  let bits = 1;
  while ((1 << bits) < pal.length) bits++;
  const tableSize = 1 << bits;
  const bytes = [];

  // header + logical screen descriptor
  pushAll(bytes, Buffer.from('GIF89a', 'ascii'));
  pushAll(bytes, [...u16(width), ...u16(height)]);
  bytes.push(0x80 | (bits - 1), 0, 0); // global table, 8-bit color resolution, size
  for (let i = 0; i < tableSize; i++) {
    const c = pal[i] || [0, 0, 0];
    bytes.push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff);
  }
  // NETSCAPE2.0 — loop forever (or loop times)
  pushAll(bytes, [0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii')]);
  pushAll(bytes, [0x03, 0x01, ...u16(loop), 0x00]);

  const minCodeSize = Math.max(2, bits);
  for (const f of frames) {
    const delay = f.delayCs ?? delayCs;
    const tint = f.transparent ?? transparent;
    // graphic control extension: transparency lets a frame carry only what
    // changed; disposal 1 ("do not dispose") leaves the rest of the canvas.
    const packed = tint == null ? 0x04 : 0x05; // 0x04 = disposal 1 · 0x05 = + transparent flag
    pushAll(bytes, [0x21, 0xf9, 0x04, packed, ...u16(Math.max(0, delay)), tint ?? 0x00, 0x00]);
    // image descriptor: full-frame, no local color table, not interlaced
    pushAll(bytes, [0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00]);
    bytes.push(minCodeSize);
    pushAll(bytes, subBlocks(lzwEncode(f.pixels, minCodeSize)));
  }
  bytes.push(0x3b); // trailer
  return Buffer.from(bytes);
}