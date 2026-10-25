import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkSession } from '../src/fork.js';
import { rerun } from '../src/rerun.js';
import { parseFile } from '../src/parse.js';
import { demoSession } from '../src/demo.js';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fork keeps the prefix and drops the rest, with a fork marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-fork-'));
  const src = join(dir, 's.jsonl');
  writeFileSync(src, demoSession());
  const r = forkSession(src, 5, { out: join(dir, 'f.jsonl') });
  assert.equal(r.kept, 5);
  const { events } = parseFile(r.out);
  assert.equal(events.length, 6); // 5 steps + fork marker
  assert.equal(events[5].type, 'system');
  assert.match(events[5].text, /forked from .* at step 5/);
  assert.equal(events[4].type, "tool_use"); // demo step 5 (U A T R T)
  rmSync(dir, { recursive: true, force: true });
});

test('fork can edit the step-N user message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-fork-'));
  const src = join(dir, 's.jsonl');
  writeFileSync(src, demoSession());
  const r = forkSession(src, 1, { out: join(dir, 'f.jsonl'), editText: 'rewrite the login bug hunt entirely' });
  const { events } = parseFile(r.out);
  assert.equal(events[0].text, 'rewrite the login bug hunt entirely');
  assert.match(events[1].text, /\(edited\)/);
  rmSync(dir, { recursive: true, force: true });
});

test('rerun with the echo provider appends deterministic turns, then diff sees them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-rerun-'));
  const src = join(dir, 's.jsonl');
  writeFileSync(src, demoSession());
  const f = forkSession(src, 5, { out: join(dir, 'f.jsonl') });
  const r = await rerun(f.out, { provider: 'echo', turns: 2 });
  assert.equal(r.added, 2);
  const { events } = parseFile(f.out);
  assert.equal(events.length, 8); // 5 + marker + 2 rerun turns
  assert.match(events[7].text, /echo: acknowledged/);
  // the A/B loop closes: diff between original and fork shows divergence at the fork point
  const { firstDiff } = await import('../src/diff.js');
  const orig = parseFile(src).events;
  assert.equal(firstDiff(orig, events), 5); // step 6 is the fork marker
  rmSync(dir, { recursive: true, force: true });
});
