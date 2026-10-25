// In-TUI diff view: `d` on an open fork diffs against its source session.
// App-state assertions via app.state(), rendering via the pure renderFrame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/parse.js';
import { demoSession } from '../src/demo.js';
import { forkSession } from '../src/fork.js';
import { createApp } from '../src/app.js';
import { vis } from '../src/render.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function forkOfDemo(dir, keepSteps = 5) {
  const src = join(dir, 's.jsonl');
  writeFileSync(src, demoSession());
  const out = forkSession(src, keepSteps).out;
  return { src, fork: out, parsed: parseFile(out) };
}

test('`d` on a fork opens the diff view: divergence is the fork marker (0-based 5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const { src, fork, parsed } = forkOfDemo(dir);
  const app = createApp({ ...parsed, file: fork });
  app.key('d');
  const dm = app.state().diffMode;
  assert.ok(dm, 'diffMode set');
  assert.equal(dm.source, src);
  assert.equal(dm.summary.divergence, 5); // source[5] vs fork marker
  assert.equal(dm.summary.identicalPrefix, 5);
  assert.deepEqual(dm.summary.steps, [25, 6]); // source vs fork lengths
  assert.equal(dm.summary.differingAfterDivergence, 1);
  assert.equal(dm.aTitles[5], parseFile(src).events[5].title, 'aTitles carries the source title at the split');
  const lines = app.frame(100, 24).map(vis);
  assert.match(lines[0], /diff vs/);
  assert.ok(lines[0].includes(src), 'header names the source session');
  assert.match(lines.join('\n'), /0-based 5/);
  assert.match(lines.join('\n'), /identical prefix: 5 steps · 1 steps differ/);
  assert.match(lines.at(-1), /d back · q quit/);
  rmSync(dir, { recursive: true, force: true });
});

test('`d` again returns to the timeline with the selection restored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const { fork, parsed } = forkOfDemo(dir);
  const app = createApp({ ...parsed, file: fork });
  app.key('j'); app.key('j'); app.key('j'); // select step 4
  app.key('d');
  assert.ok(app.state().diffMode);
  app.key('j'); // navigation is dead in the diff view
  app.key('d');
  const st = app.state();
  assert.equal(st.diffMode, null);
  assert.equal(st.sel, 3, 'selection restored, untouched by the diff view');
  const lines = app.frame(100, 24).map(vis).join('\n');
  assert.match(lines, /4\/6/); // back to the timeline, fork has 6 steps
  assert.doesNotMatch(lines, /diff vs/);
  rmSync(dir, { recursive: true, force: true });
});

test('non-fork session: `d` sets the note and changes nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const file = join(dir, 'plain.jsonl');
  writeFileSync(file, demoSession());
  const app = createApp({ ...parseFile(file), file });
  app.key('d');
  const st = app.state();
  assert.equal(st.diffMode, null);
  assert.equal(st.note, 'not a fork — open a .fork-*.jsonl file');
  assert.match(app.frame(100, 24).map(vis).join('\n'), /not a fork — open a \.fork-\*\.jsonl file/);
  rmSync(dir, { recursive: true, force: true });
});

test('entering the diff view resets scroll; leaving restores selection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const { fork, parsed } = forkOfDemo(dir);
  const app = createApp({ ...parsed, file: fork });
  app.key('j'); app.key('j');
  app.key('J'); app.key('J'); // scroll = 10
  assert.equal(app.state().scroll, 10);
  app.key('d');
  assert.equal(app.state().scroll, 0, 'scroll reset on enter');
  app.key('d');
  assert.equal(app.state().sel, 2, 'selection restored on exit');
  assert.equal(app.state().scroll, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('renderFrame in diffMode: source path, counts and footer, within width bounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const { src, fork, parsed } = forkOfDemo(dir);
  const app = createApp({ ...parsed, file: fork });
  app.key('d');
  for (const w of [100, 60, 44]) {
    const lines = app.frame(w, 24).map(vis);
    assert.equal(lines.length, 24);
    for (const l of lines) assert.ok(l.length <= w, `line too wide at w=${w}: ${l}`);
    const text = lines.join('\n');
    assert.match(text, /⏪ tape — diff/);
    assert.match(lines[0], /diff vs/);
    assert.match(text, /divergence +step 6 \(0-based 5\)/);
    assert.match(text, /identical prefix: 5 steps/);
    assert.match(text, /d back · q quit/);
  }
  assert.ok(app.frame(100, 24).map(vis)[0].includes(src), 'full source path visible at w=100');
  rmSync(dir, { recursive: true, force: true });
});

test('help overlay lists the d key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-diffmode-'));
  const { fork, parsed } = forkOfDemo(dir);
  const app = createApp({ ...parsed, file: fork });
  app.key('?');
  assert.match(app.frame(100, 24).map(vis).join('\n'), /d +diff vs fork source \(forks only\)/);
  rmSync(dir, { recursive: true, force: true });
});
