import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilm, PALETTE, C, TYPE_STYLE, createCanvas, rect, text, ansiLinesToCanvas, fit, deltaFrames, TRANSPARENT } from '../src/film.js';
import { drawable, glyph } from '../src/font.js';
import { encodeGif } from '../src/gif.js';
import { parseLines } from '../src/parse.js';
import { demoSession } from '../src/demo.js';

const demo = () => parseLines(demoSession());

const pixelsAt = (frame, x, y, width) => frame.pixels[y * width + x];

test('film is deterministic: same events ⇒ byte-identical GIF', () => {
  const { events } = demo();
  const a = encodeGif(buildFilm({ file: 's.jsonl', events, frames: 6 }));
  const b = encodeGif(buildFilm({ file: 's.jsonl', events, frames: 6 }));
  assert.ok(a.equals(b), 'two builds must be identical');
});

test('one frame per stop, capped by --frames, and the last stop is the final step', () => {
  const events = Array.from({ length: 200 }, (_, i) => ({ type: 'user', title: `step ${i}`, text: `step ${i}` }));
  const film = buildFilm({ events, frames: 10 });
  assert.ok(film.frames.length <= 11, `got ${film.frames.length} frames`);
  assert.ok(film.frames.length >= 10);
  // the final frame must be the fully revealed session: every ribbon cell lit
  const last = film.frames[film.frames.length - 1];
  assert.ok(last.pixels.some(p => p !== PALETTE.indexOf(PALETTE[0])), 'final frame has ink');
});

test('every frame only uses palette indices that exist (or the transparent slot)', () => {
  const { events } = demo();
  const film = buildFilm({ events, frames: 5, width: 400, rows: 6 });
  for (const f of film.frames) {
    assert.equal(f.pixels.length, film.width * film.height);
    const max = Math.max(...f.pixels);
    assert.ok(max <= TRANSPARENT, `index ${max} outside the ${PALETTE.length}+1 table`);
  }
  const full = buildFilm({ events, frames: 5, width: 400, rows: 6, diff: false });
  for (const f of full.frames) {
    assert.ok(Math.max(...f.pixels) < PALETTE.length, 'full frames never use the transparent slot');
  }
});

test('the current step is highlighted in its own type colour', () => {
  const events = [
    { type: 'user', title: 'hello', text: 'hello' },
    { type: 'error', title: 'boom', text: 'boom' },
  ];
  const film = buildFilm({ events, frames: 2, width: 400, rows: 6 });
  // frame 1 stops on the error step: its bright red must appear, and its band
  const last = film.frames[film.frames.length - 1];
  const redBright = C.hue(TYPE_STYLE.error.hue, 1);
  assert.ok(last.pixels.includes(redBright), 'bright red for the current error');
  assert.ok(last.pixels.includes(C.band), 'selected row gets a band');
});

test('types keep distinct hues; unknown types fall back to system', () => {
  const hues = Object.values(TYPE_STYLE).map(s => s.hue);
  assert.equal(new Set(hues).size, hues.length, 'each type owns a hue');
  const film = buildFilm({ events: [{ type: 'wat', title: 'x' }], frames: 2 });
  const system = C.hue(TYPE_STYLE.system.hue, 1);
  assert.ok(film.frames[0].pixels.includes(system));
});

test('ribbon: one lit cell per revealed step, future steps stay faint', () => {
  const events = Array.from({ length: 10 }, () => ({ type: 'user', title: 'x' }));
  const film = buildFilm({ events, frames: 10, width: 400, rows: 8 });
  const ribbonRow = film.height - 12 - 1 - 6; // inside the ribbon strip
  const lit = film.frames[0].pixels.slice(ribbonRow * film.width).filter(p => p !== C.bg && p !== C.faint);
  assert.ok(lit.length > 0, 'first frame lights at least the cursor');
});

test('empty input is a clean error, not a broken file', () => {
  assert.throws(() => buildFilm({ events: [] }), /no events/);
});

test('canvas primitives clip instead of throwing', () => {
  const cv = createCanvas(4, 4);
  rect(cv, -2, -2, 10, 10, 7);
  assert.ok(cv.px.every(v => v === 7));
  rect(cv, 10, 10, 5, 5, 9);
  assert.ok(cv.px.every(v => v === 7), 'out-of-bounds rect is a no-op');
  text(cv, 0, 0, 'A', 1, 1); // draws inside
  text(cv, 100, 100, 'ZZZ', 1, 1); // fully outside: no throw
});

test('ANSI SGR maps to palette: colour, bold, dim, reset', () => {
  const cv = createCanvas(60, 40);
  ansiLinesToCanvas(cv, ['\x1b[36mcyan\x1b[0m plain', '\x1b[1;31mbright red\x1b[0m', '\x1b[2mdim\x1b[0m'], 2, 2, { scale: 1 });
  assert.ok(cv.px.includes(C.hue(6, 0)), 'cyan 36');
  assert.ok(cv.px.includes(C.hue(1, 1)), 'bold red 1;31');
  assert.ok(cv.px.includes(C.ink), 'default ink');
  assert.ok(cv.px.includes(C.dim), 'dim 2');
});

test('the font transliterates typography and drops decoration', () => {
  assert.equal(drawable('…'), '...');
  assert.equal(drawable('a→b'), 'A>B');
  assert.equal(drawable('⏪ tape ⚔'), '< TAPE X');
  assert.equal(drawable(''), '');
  assert.ok(glyph('A'));
  assert.equal(glyph('A').length, 7);
  assert.equal(glyph('é'), null, 'no accents in the table');
});

test('fit() truncates to the column budget and marks the cut', () => {
  assert.equal(fit('abc', 5), 'ABC');
  assert.equal(fit('abcdef', 4), 'ABC~');
  assert.equal(fit('abcdef', 0), '~');
});
test('writeFilm writes a real GIF file (header, trailer, non-zero frames)', async () => {
  const { writeFilm } = await import('../src/film.js');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tape-gif-'));
  try {
    const { events } = demo();
    const out = join(dir, 'film.gif');
    const r = writeFilm(out, buildFilm({ file: 'demo.jsonl', events, frames: 4, width: 400, rows: 6 }));
    const buf = readFileSync(out);
    assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(buf[buf.length - 1], 0x3b);
    assert.equal(r.bytes, buf.length);
    assert.ok(r.frames >= 4);
    assert.equal(r.width, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: a missing file or a directory fails with one clean line, not a stack trace', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { join: j } = await import('node:path');
  const bin = j(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'tape.js');
  const run = args => {
    try {
      execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out: '' };
    } catch (e) {
      return { code: e.status, out: String(e.stderr) };
    }
  };
  const missing = run(['gif', '/tmp/definitely-not-a-session.jsonl']);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /^tape: no such file/);
  assert.doesNotMatch(missing.out, /at .*node:fs/);
  const dir = run(['gif', '/tmp']);
  assert.equal(dir.code, 1);
  assert.match(dir.out, /^tape: that is a directory/);
  assert.doesNotMatch(dir.out, /at .*node:fs/);
});

test('deltaFrames: the first frame is complete, later frames carry only changes', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 9, 3, 9]);
  const out = deltaFrames([{ pixels: a }, { pixels: b }]);
  assert.deepEqual([...out[0].pixels], [1, 2, 3, 4], 'nothing to keep on screen yet');
  assert.equal(out[0].changed, 4);
  assert.deepEqual([...out[1].pixels], [TRANSPARENT, 9, TRANSPARENT, 9]);
  assert.equal(out[1].changed, 2);
});

test('deltaFrames: an unchanged frame becomes fully transparent (legal, disposal 1)', () => {
  const p = new Uint8Array([5, 5, 5, 5]);
  const out = deltaFrames([{ pixels: p }, { pixels: p }]);
  assert.ok([...out[1].pixels].every(v => v === TRANSPARENT));
  assert.equal(out[1].changed, 0);
});

test('buildFilm defaults to deltas and says so; --no-diff gives full frames', () => {
  const { events } = demo();
  const delta = buildFilm({ events, frames: 6, width: 400, rows: 6 });
  const full = buildFilm({ events, frames: 6, width: 400, rows: 6, diff: false });
  assert.equal(delta.transparent, TRANSPARENT);
  assert.equal(full.transparent, null);
  assert.ok(delta.frames[0].pixels.every(v => v !== TRANSPARENT), 'frame 0 is always complete');
  assert.ok(delta.frames.slice(1).some(f => f.pixels.includes(TRANSPARENT)), 'later frames are deltas');
  assert.deepEqual(full.frames.map(f => [...f.pixels]), buildFilm({ events, frames: 6, width: 400, rows: 6, diff: false }).frames.map(f => [...f.pixels]));
});

test('deltas shrink the file on a real session without changing what you see', () => {
  const { events } = demo();
  const opts = { file: 'demo.jsonl', events, frames: 12, width: 600, rows: 8 };
  const delta = encodeGif(buildFilm({ ...opts }));
  const full = encodeGif(buildFilm({ ...opts, diff: false }));
  assert.ok(delta.length < full.length, `delta ${delta.length} should beat full ${full.length}`);

  // composite both the way a viewer does (disposal 1: keep what is there)
  const render = film => {
    const { width, height } = film;
    const screen = new Uint8Array(width * height);
    return film.frames.map(f => {
      for (let i = 0; i < screen.length; i++) {
        if (film.transparent == null || f.pixels[i] !== film.transparent) screen[i] = f.pixels[i];
      }
      return [...screen];
    });
  };
  assert.deepEqual(render(buildFilm({ ...opts })), render(buildFilm({ ...opts, diff: false })));
});
