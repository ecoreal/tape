import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif } from '../src/gif.js';

// A decoder written against the spec (not against our encoder): it is the
// independent half of the round-trip. If both sides drifted the same way, PIL
// and ImageMagick would still reject the file — see test/film-cli below.
function lzwDecode(bytes, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1, bitPos = 0, old = null, first = 0;
  let table = Array.from({ length: clear }, (_, i) => [i]);
  const out = [];
  const read = () => {
    let code = 0;
    for (let b = 0; b < codeSize; b++) {
      const byte = bytes[bitPos >> 3];
      if (byte === undefined) return -1;
      code |= ((byte >> (bitPos & 7)) & 1) << b;
      bitPos++;
    }
    return code;
  };
  for (;;) {
    const code = read();
    if (code < 0 || code === eoi) break;
    if (code === clear) {
      codeSize = minCodeSize + 1; next = eoi + 1; old = null;
      table = Array.from({ length: clear }, (_, i) => [i]);
      continue;
    }
    let entry;
    if (code < next) entry = table[code];
    else if (code === next && old) entry = [...old, first];
    else throw new Error(`invalid code ${code} at ${out.length} (next ${next}, width ${codeSize})`);
    out.push(...entry);
    first = entry[0];
    if (old && next < 4096) {
      table[next++] = [...old, first];
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    old = entry;
  }
  return out;
}

// Walk the container without trusting our writer: header, LSD, GCT, blocks.
function parseGif(buf) {
  assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a');
  const width = buf[6] | (buf[7] << 8);
  const height = buf[8] | (buf[9] << 8);
  const packed = buf[10];
  const gctSize = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  let i = 13;
  const palette = [];
  for (let k = 0; k < gctSize; k++, i += 3) palette.push([buf[i], buf[i + 1], buf[i + 2]]);
  const frames = [];
  let loop = null;
  let delay = null;
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x3b) { i++; break; }
    if (b === 0x21) {
      const label = buf[i + 1];
      i += 2;
      if (label === 0xf9) {
        delay = buf[i + 2] | (buf[i + 3] << 8);
      } else if (label === 0xff) {
        const name = buf.subarray(i + 1, i + 12).toString('ascii');
        assert.equal(name, 'NETSCAPE2.0');
        loop = buf[i + 14] | (buf[i + 15] << 8);
      }
      while (buf[i] !== 0) i += buf[i] + 1;
      i++;
      continue;
    }
    if (b === 0x2c) {
      const fw = buf[i + 5] | (buf[i + 6] << 8);
      const fh = buf[i + 7] | (buf[i + 8] << 8);
      const lpacked = buf[i + 9];
      assert.equal(lpacked & 0x80, 0, 'no local colour table expected');
      i += 10;
      const minCode = buf[i++];
      const data = [];
      while (buf[i] !== 0) {
        const n = buf[i++];
        for (let k = 0; k < n; k++) data.push(buf[i++]);
      }
      i++;
      frames.push({ width: fw, height: fh, minCode, data: Uint8Array.from(data), delay });
      continue;
    }
    throw new Error(`unexpected block 0x${b.toString(16)} at ${i}`);
  }
  return { width, height, palette, frames, loop, end: i, gctSize };
}

const pal = n => Array.from({ length: n }, (_, i) => [(i * 37) & 255, (i * 91) & 255, (255 - i * 11) & 255]);

function roundTrip(colors, w, h, seed = 1) {
  const pixels = new Uint8Array(w * h);
  let s = seed;
  for (let i = 0; i < pixels.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = s % colors;
  }
  const buf = encodeGif({ width: w, height: h, palette: pal(colors), frames: [{ pixels }], delayCs: 5 });
  const gif = parseGif(buf);
  const frame = gif.frames[0];
  const back = lzwDecode(frame.data, frame.minCode);
  assert.equal(back.length, pixels.length, 'decoded pixel count');
  assert.deepEqual(Uint8Array.from(back), pixels, 'decoded pixels are identical');
  return { buf, gif };
}

test('LZW round-trips through an independent decoder', () => {
  roundTrip(2, 7, 5);
  roundTrip(4, 33, 17);
  roundTrip(29, 120, 40);
});

test('LZW round-trips a frame big enough to overflow the 4096-code table', () => {
  // random noise fills the dictionary fast and forces the clear-code path
  roundTrip(256, 300, 200, 99);
  roundTrip(29, 400, 260, 7);
});

test('solid run-length content compresses to a fraction of the raw pixels', () => {
  const w = 200, h = 100;
  const pixels = new Uint8Array(w * h).fill(3);
  const buf = encodeGif({ width: w, height: h, palette: pal(8), frames: [{ pixels }] });
  const { frames } = parseGif(buf);
  assert.ok(frames[0].data.length < 2000, `expected <2000 bytes, got ${frames[0].data.length}`);
});

test('GIF container: header, logical screen, palette power of two, trailer', () => {
  const { buf, gif } = roundTrip(6, 40, 20);
  assert.equal(gif.width, 40);
  assert.equal(gif.height, 20);
  assert.equal(gif.gctSize, 8, 'six colours round up to an 8-entry table');
  assert.deepEqual(gif.palette.slice(0, 6), pal(6).map(c => c.map(v => v & 255)));
  assert.deepEqual(gif.palette[6], [0, 0, 0], 'unused table slots are black');
  assert.equal(buf[buf.length - 1], 0x3b, 'trailer byte');
  assert.equal(gif.end, buf.length, 'no bytes after the trailer');
});

test('animation: one image per frame, per-frame delays, NETSCAPE loop', () => {
  const w = 12, h = 6;
  const frames = [0, 1, 2].map(k => ({ pixels: new Uint8Array(w * h).fill(k % 4), delayCs: 4 + k }));
  const buf = encodeGif({ width: w, height: h, palette: pal(4), frames, loop: 0 });
  const gif = parseGif(buf);
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.loop, 0, 'loop forever');
  assert.deepEqual(gif.frames.map(f => f.delay), [4, 5, 6]);
  // frame k decodes to exactly k % 4 everywhere
  gif.frames.forEach((f, k) => {
    const px = lzwDecode(f.data, f.minCode);
    assert.ok(px.every(v => v === k % 4), `frame ${k} pixels`);
  });
});

test('a one-colour frame still produces a valid image block', () => {
  const pixels = new Uint8Array(10 * 10).fill(1);
  const buf = encodeGif({ width: 10, height: 10, palette: pal(2), frames: [{ pixels }] });
  const { frames } = parseGif(buf);
  assert.deepEqual(lzwDecode(frames[0].data, frames[0].minCode), Array(100).fill(1));
});

test('large frames do not blow the stack when writing sub-blocks', () => {
  const w = 900, h = 400;
  const pixels = new Uint8Array(w * h);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 63;
  const buf = encodeGif({ width: w, height: h, palette: pal(63), frames: [{ pixels }] });
  const { frames } = parseGif(buf);
  const back = lzwDecode(frames[0].data, frames[0].minCode);
  assert.equal(back.length, w * h);
  assert.equal(back[12345], pixels[12345]);
});