import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cachePathFor, hashFor, hashText, load, append, lookup,
  cacheReport, renderCacheReport,
} from '../src/toolcache.js';
import { rerun, pairedResult } from '../src/rerun.js';
import { parseFile } from '../src/parse.js';
import { forkSession } from '../src/fork.js';
import { demoSession } from '../src/demo.js';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup(dir) {
  const file = join(dir, 's.jsonl');
  writeFileSync(file, demoSession());
  return file;
}

function forkOf(dir) {
  const src = setup(dir);
  return forkSession(src, 5, { out: join(dir, 'f.jsonl') }).out;
}

test('hashFor: deterministic 16-hex digest keyed on tool_use text', () => {
  const h = hashFor({ type: 'tool_use', text: 'Bash npm test -- tests/auth.test.js' });
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, hashFor({ type: 'tool_use', text: 'Bash npm test -- tests/auth.test.js' }));
  assert.notEqual(h, hashFor({ type: 'tool_use', text: 'Bash npm test -- tests/auth.test.js ' }));
  // non-tool_use steps hash the empty string — a stable "not cacheable" sentinel
  assert.equal(hashFor({ type: 'user', text: 'anything' }), hashFor({ type: 'assistant', text: 'other' }));
  assert.equal(hashFor({ type: 'user', text: 'anything' }), hashText(''));
  assert.equal(hashText(''), 'e3b0c44298fc1c14'); // sha256('') prefix
});

test('toolcache round-trip: append → load → lookup, fields preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const p = cachePathFor(join(dir, 's.jsonl'));
  assert.equal(p, join(dir, 's.jsonl.toolcache.jsonl')); // sidecar lives next to the session
  const e1 = {
    hash: hashFor({ type: 'tool_use', text: 'Read src/auth/session.ts' }),
    tool: 'Read', input: 'Read src/auth/session.ts', output: '  14 | export …',
    ts: '2026-10-26T04:00:00.000Z',
  };
  const e2 = { hash: 'aaaaaaaaaaaaaaaa', tool: null, input: 'the prompt', output: 'the reply' };
  assert.equal(append(p, e1), true);
  assert.equal(append(p, e2), true);
  const all = load(p);
  assert.equal(all.length, 2);
  assert.deepEqual(
    { hash: all[0].hash, tool: all[0].tool, input: all[0].input, output: all[0].output, ts: all[0].ts },
    e1,
  );
  assert.equal(lookup(p, e1.hash).output, '  14 | export …');
  const hit2 = lookup(p, e2.hash);
  assert.equal(hit2.tool, null);
  assert.equal(hit2.input, 'the prompt');
  assert.equal(hit2.output, 'the reply');
  assert.match(hit2.ts, /^\d{4}-\d{2}-\d{2}T/); // default ts filled in
  assert.equal(lookup(p, 'missing0'), null);
  assert.equal(lookup(p, ''), null);
  assert.deepEqual(load(join(dir, 'nope.jsonl')), []); // missing sidecar = empty cache
  rmSync(dir, { recursive: true, force: true });
});

test('append is idempotent by hash — the same hash is never written twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const p = cachePathFor(join(dir, 's.jsonl'));
  const e = { hash: 'bbbbbbbbbbbbbbbb', tool: 'Bash', input: 'Bash npm test', output: '9 passed' };
  assert.equal(append(p, e), true);
  assert.equal(append(p, { ...e, output: 'would-be rewrite' }), false);
  assert.equal(load(p).length, 1);
  assert.equal(lookup(p, e.hash).output, '9 passed'); // first write wins, file untouched
  const raw = readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(raw.length, 1);
  assert.equal(append(p, { hash: 'cccccccccccccccc', tool: null, input: 'p', output: 'r' }), true);
  assert.equal(load(p).length, 2);
  assert.equal(append(p, { input: 'no hash at all' }), false); // unusable entry refused
  assert.equal(load(p).length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('corrupt sidecar lines are skipped, never fatal; appending still works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const p = cachePathFor(join(dir, 's.jsonl'));
  const good = h => JSON.stringify({ hash: h, tool: 'Read', input: 'in ' + h, output: 'out ' + h, ts: '2026-10-26T04:00:00.000Z' });
  writeFileSync(p, [
    good('dddddddddddddddd'),
    '',
    'not json at all',
    '{"hash":',              // torn mid-write
    '{"nohash":1}',          // JSON but not an entry
    good('eeeeeeeeeeeeeeee'),
    '   ' + good('ffffffffffffffff'), // leading whitespace tolerated
  ].join('\n') + '\n');
  const all = load(p);
  assert.deepEqual(all.map(e => e.hash), ['dddddddddddddddd', 'eeeeeeeeeeeeeeee', 'ffffffffffffffff']);
  assert.equal(lookup(p, 'eeeeeeeeeeeeeeee').input, 'in eeeeeeeeeeeeeeee');
  // the cache stays writable after corruption, and dedupe still sees old hashes
  assert.equal(append(p, { hash: 'dddddddddddddddd', tool: null, input: 'x', output: 'y' }), false);
  assert.equal(append(p, { hash: '9999999999999999', tool: null, input: 'p', output: 'r' }), true);
  assert.equal(load(p).length, 4);
  rmSync(dir, { recursive: true, force: true });
});

test('pairedResult: adjacency fallback, meta.id preference, honest nulls', () => {
  const ev = (type, text, meta) => ({ type, text, meta: meta || {} });
  // demo-style transcript: no block ids, result directly follows its call
  const plain = [
    ev('tool_use', 'A'), ev('tool_result', 'outA'),
    ev('tool_use', 'B'), ev('tool_result', 'outB'),
  ];
  assert.equal(pairedResult(plain, 0).text, 'outA');
  assert.equal(pairedResult(plain, 2).text, 'outB');
  // ids present: an interleaved stranger must not be mistaken for the answer
  const ids = [
    ev('tool_use', 'A', { tool: 'X', id: 't1' }),
    ev('tool_result', 'stranger', { id: 't2' }),
    ev('tool_result', 'real', { id: 't1' }),
    ev('tool_use', 'B', { id: 't9' }),
  ];
  assert.equal(pairedResult(ids, 0).text, 'real');
  assert.equal(pairedResult(ids, 3), null); // truncated mid-pair
  // no result before the next tool_use → null
  assert.equal(pairedResult([ev('tool_use', 'A'), ev('tool_use', 'B')], 0), null);
});

test('rerun with echo provider populates the toolcache; a second rerun adds nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const f = forkOf(dir);
  const r1 = await rerun(f, { provider: 'echo', turns: 2 });
  assert.equal(r1.added, 2);
  assert.equal(r1.toolSeeded, 2);  // both tool_use steps of the fork recorded
  assert.equal(r1.turnEntries, 2); // one assistant-turn entry per successful call
  assert.equal(r1.toolHits, 2);    // turn 2 already recognizes both tool calls
  assert.equal(r1.cacheFile, cachePathFor(f));

  const entries = load(cachePathFor(f));
  assert.equal(entries.length, 4); // 2 tool calls + 2 assistant turns
  const { events } = parseFile(f);
  const tool = entries.find(e => e.tool === 'Read');
  assert.equal(tool.input, 'Read src/auth/session.ts');
  assert.equal(tool.output, events[3].text); // paired tool_result captured verbatim
  const turn = entries.find(e => e.tool === null);
  assert.equal(turn.input, events[0].text);  // keyed by the prompt that produced it
  assert.match(turn.output, /echo: acknowledged "The login page/);

  const before = readFileSync(cachePathFor(f), 'utf8');
  const r2 = await rerun(f, { provider: 'echo', turns: 1 });
  assert.equal(r2.added, 1);
  assert.equal(r2.toolSeeded, 0);
  assert.equal(r2.turnEntries, 0); // same conversation state → same hash → no write
  assert.equal(r2.toolHits, 2);
  assert.equal(readFileSync(cachePathFor(f), 'utf8'), before); // byte-identical sidecar
  rmSync(dir, { recursive: true, force: true });
});

test('cached tool calls ship their result verbatim into the provider history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const f = forkOf(dir);
  const events0 = parseFile(f).events;
  const SENTINEL = 'CACHED TOOL OUTPUT :: original run saw 14 | export async function refreshSession';
  // pre-seed only the LAST tool_use (the fork cut its result off — fallback path)
  append(cachePathFor(f), {
    hash: hashFor(events0[4]), tool: 'Read', input: events0[4].text, output: SENTINEL,
    ts: '2026-10-26T00:00:00.000Z',
  });
  // partial coverage is visible to `tape cache` before the rerun runs
  const partial = cacheReport(parseFile(f), f);
  assert.equal(partial.hitCapable, 1);
  assert.equal(partial.toolUses, 2);

  const r = await rerun(f, { provider: 'echo', turns: 1 });
  assert.equal(r.toolHits, 1);   // the pre-seeded call was served from cache
  assert.equal(r.toolSeeded, 1); // the other call was recorded for next time
  const reply = parseFile(f).events.at(-1).text;
  assert.ok(reply.includes('CACHED TOOL OUTPUT'), 'cache output reached the provider history');
  // the call seeded this pass captured its paired tool_result verbatim
  const seeded = load(cachePathFor(f)).find(e => e.input === 'Read src/auth/session.ts');
  assert.equal(seeded.output, events0[3].text);
  rmSync(dir, { recursive: true, force: true });
});

test('tape cache report: one-line stats + entry table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const f = forkOf(dir);
  await rerun(f, { provider: 'echo', turns: 1 });
  const rep = cacheReport(parseFile(f), f);
  assert.equal(rep.cacheFile, cachePathFor(f));
  assert.equal(rep.entries.length, 3); // 2 tool calls + 1 assistant turn
  assert.ok(rep.size > 0);
  assert.equal(rep.toolUses, 2);
  assert.equal(rep.hitCapable, 2); // the rerun above made both calls hit-capable

  const text = renderCacheReport(rep);
  assert.match(text, /⏪ tape — cache/);
  assert.match(text, /3 entries · \d[\d.]* B · 2 hit-capable hashes \(2\/2 tool_use in session\)/);
  assert.match(text, /hash\s+tool\s+input\s+output\s+when/);
  assert.match(text, /Read/);
  assert.match(text, /\(assistant\)/);
  assert.match(text, /echo: acknowledged/);
  assert.match(text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  rmSync(dir, { recursive: true, force: true });
});

test('cache report degrades gracefully on a session with no sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-tc-'));
  const f = setup(dir);
  const rep = cacheReport(parseFile(f), f);
  assert.equal(rep.entries.length, 0);
  assert.equal(rep.size, 0);
  assert.equal(rep.toolUses, 8);  // the demo session has 8 tool_use steps
  assert.equal(rep.hitCapable, 0);
  const text = renderCacheReport(rep);
  assert.match(text, /0 entries · 0 B · 0 hit-capable hashes \(0\/8 tool_use in session\)/);
  assert.match(text, /no cache yet/);
  rmSync(dir, { recursive: true, force: true });
});
