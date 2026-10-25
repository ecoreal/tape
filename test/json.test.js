// --json mode for the reporting commands: stats · diff · grep · cache.
// Contract: valid single-line JSON on stdout, human text untouched without the
// flag, invalid input → message on stderr + exit code 1 in BOTH modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.js';
import { parseFile, parseLines } from '../src/parse.js';
import { buildStats, renderStats, statsJson } from '../src/stats.js';
import { diffSummary, renderDiff } from '../src/diff.js';
import { grepSessions, grepJson } from '../src/grep.js';
import { cachePathFor, cacheReport, renderCacheReport, cacheJson, load } from '../src/toolcache.js';
import { forkSession } from '../src/fork.js';
import { rerun } from '../src/rerun.js';
import { demoSession } from '../src/demo.js';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'fixtures', 'claude-code', 'basic.jsonl');

// run main() with stdout/stderr captured; process.exitCode reset per call
async function capture(argv) {
  const out = [], err = [];
  const origLog = console.log, origError = console.error, origCode = process.exitCode;
  console.log = (...a) => out.push(a.map(String).join(' '));
  console.error = (...a) => err.push(a.map(String).join(' '));
  process.exitCode = 0;
  try {
    await main(argv);
    return { out: out.join('\n'), err: err.join('\n'), code: process.exitCode };
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = origCode;
  }
}

const oneJsonLine = s => {
  const lines = s.trim().split('\n');
  assert.equal(lines.length, 1, `expected one line of JSON, got ${lines.length}`);
  return JSON.parse(lines[0]); // throws (fails the test) on invalid JSON
};

function tmpSession(name = 's.jsonl', body = demoSession()) {
  const dir = mkdtempSync(join(tmpdir(), 'tape-json-'));
  const file = join(dir, name);
  writeFileSync(file, body);
  return { dir, file };
}

// ---------- stats ----------

test('stats --json: single-line JSON mirroring buildStats, no invented fields', async () => {
  const { out, err, code } = await capture(['stats', FIXTURE, '--json']);
  assert.equal(err, '');
  assert.equal(code, 0);
  const j = oneJsonLine(out);
  assert.deepEqual(Object.keys(j), [
    'file', 'steps', 'byType', 'topTools', 'cost', 'durationMs', 'tokens', 'models', 'lines',
  ]);
  assert.equal(j.file, FIXTURE);
  const s = buildStats(parseFile(FIXTURE));
  assert.equal(j.steps, s.steps);
  assert.deepEqual(j.byType, s.byType);
  assert.deepEqual(j.topTools, s.topTools);
  assert.equal(j.cost, s.cost);
  assert.equal(j.durationMs, s.duration);
  assert.deepEqual(j.tokens, { in: s.tokens.in, out: s.tokens.out });
  assert.deepEqual(j.models, s.models);
  assert.deepEqual(j.lines, s.lines);
  // golden numbers from the hand-verified fixture
  assert.equal(j.cost, 0.041);
  assert.equal(j.durationMs, 184000);
  assert.deepEqual(j.tokens, { in: 1200, out: 85 });
  assert.deepEqual(j.lines, [42, 7]);
});

test('stats --json: nulls where the transcript has no cost data', async () => {
  const { out, code } = await capture(['stats', join(root, 'examples', 'demo-session.jsonl'), '--json']);
  assert.equal(code, 0);
  const j = oneJsonLine(out);
  assert.equal(j.cost, null);          // demo has no cost-state line
  assert.equal(j.durationMs, 408000);  // falls back to the timestamp span
  assert.deepEqual(j.tokens, { in: 0, out: 0 });
  assert.deepEqual(j.models, []);
});

test('stats: human output is byte-identical without --json', async () => {
  const human = await capture(['stats', FIXTURE]);
  const parsed = parseFile(FIXTURE);
  assert.equal(human.out, renderStats(parsed, FIXTURE));
  assert.equal(human.code, 0);
});

test('statsJson matches the CLI contract directly', () => {
  const parsed = parseLines(demoSession());
  const j = statsJson(parsed, 'demo.jsonl');
  assert.equal(j.file, 'demo.jsonl');
  assert.equal(j.steps, 25);
  assert.deepEqual(Object.keys(j), [
    'file', 'steps', 'byType', 'topTools', 'cost', 'durationMs', 'tokens', 'models', 'lines',
  ]);
});

// ---------- diff ----------

test('diff --json: mirrors diffSummary — divergence, steps, prefix', async () => {
  const a = tmpSession('a.jsonl');
  const b = tmpSession('b.jsonl', demoSession().replace('docker restart pg-test', 'docker kill pg-test'));
  const { out, err, code } = await capture(['diff', a.file, b.file, '--json']);
  assert.equal(err, '');
  assert.equal(code, 0);
  const j = oneJsonLine(out);
  assert.deepEqual(Object.keys(j), ['divergence', 'steps', 'differingAfterDivergence', 'identicalPrefix']);
  assert.deepEqual(j, diffSummary(parseFile(a.file).events, parseFile(b.file).events));
  assert.equal(j.divergence, 15);      // 0-based split point
  assert.deepEqual(j.steps, [25, 25]);
  assert.equal(j.differingAfterDivergence, 1);
  assert.equal(j.identicalPrefix, 15);

  const same = oneJsonLine((await capture(['diff', a.file, a.file, '--json'])).out);
  assert.equal(same.divergence, null);
  assert.equal(same.identicalPrefix, 25);
  rmSync(a.dir, { recursive: true, force: true });
  rmSync(b.dir, { recursive: true, force: true });
});

test('diff: human output is byte-identical without --json', async () => {
  const a = tmpSession('a.jsonl');
  const b = tmpSession('b.jsonl', demoSession().replace('docker restart pg-test', 'docker kill pg-test'));
  const human = await capture(['diff', a.file, b.file]);
  const A = parseFile(a.file), B = parseFile(b.file);
  assert.equal(human.out, renderDiff(A.events, B.events, [a.file, b.file]));
  assert.equal(human.code, 0);
  rmSync(a.dir, { recursive: true, force: true });
  rmSync(b.dir, { recursive: true, force: true });
});

// ---------- grep ----------

test('grep --json: array of {path, mtime ISO, title, hits, steps}; no hits → []', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tape-home-'));
  const proj = join(home, '.claude', 'projects', 'proj');
  mkdirSync(proj, { recursive: true });
  const session = join(proj, 'flaky.jsonl');
  writeFileSync(session, [
    JSON.stringify({ type: 'summary', summary: 'the flaky DB night' }),
    JSON.stringify({ role: 'user', content: 'the pipeline died with ECONNRESET twice' }),
    JSON.stringify({ role: 'assistant', content: 'on it' }),
  ].join('\n') + '\n');
  const origHome = process.env.HOME;
  process.env.HOME = home; // unix homedir resolution
  process.env.USERPROFILE = home; // windows homedir resolution
  try {
    const { out, err, code } = await capture(['grep', 'ECONNRESET', '--json']);
    assert.equal(err, '');
    assert.equal(code, 0);
    const j = oneJsonLine(out);
    assert.ok(Array.isArray(j));
    assert.equal(j.length, 1);
    assert.deepEqual(Object.keys(j[0]), ['path', 'mtime', 'title', 'hits', 'steps']);
    assert.equal(j[0].path, session);
    assert.equal(typeof j[0].mtime, 'string');
    assert.match(j[0].mtime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO, not raw ms
    assert.ok(Math.abs(Date.parse(j[0].mtime) - statSync(session).mtimeMs) < 1000); // the file's mtime
    assert.equal(j[0].title, 'the flaky DB night');
    assert.equal(j[0].hits, 1);
    assert.equal(j[0].steps, 2);

    const none = await capture(['grep', 'no-such-needle-xyz', '--json']);
    assert.equal(none.code, 0);
    assert.deepEqual(oneJsonLine(none.out), []);
    assert.equal(none.err, '');

    const human = await capture(['grep', 'ECONNRESET']);
    assert.match(human.out, /"ECONNRESET" appears in 1 session\(s\)/);
    assert.equal(human.code, 0);
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test('grepJson maps hits to the published shape', () => {
  const j = grepJson([{
    path: '/x/s.jsonl', mtime: Date.parse('2026-10-25T12:00:00Z'),
    title: 't', hits: 3, steps: 9, first: { type: 'user', text: 'internal' },
  }]);
  assert.deepEqual(j, [{
    path: '/x/s.jsonl', mtime: '2026-10-25T12:00:00.000Z', title: 't', hits: 3, steps: 9,
  }]); // `first` (a render detail) stays out of the JSON
  assert.deepEqual(grepSessions('nothing-at-all', join(tmpdir(), 'tape-empty-')), []);
});

// ---------- cache ----------

test('cache --json: entries verbatim + bytes/hitCapable/sessionToolUses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-json-'));
  const src = join(dir, 's.jsonl');
  writeFileSync(src, demoSession());
  const f = forkSession(src, 5, { out: join(dir, 'f.jsonl') }).out;
  await rerun(f, { provider: 'echo', turns: 1 });

  const { out, err, code } = await capture(['cache', f, '--json']);
  assert.equal(err, '');
  assert.equal(code, 0);
  const j = oneJsonLine(out);
  assert.deepEqual(Object.keys(j), ['entries', 'bytes', 'hitCapable', 'sessionToolUses']);
  const rep = cacheReport(parseFile(f), f);
  assert.deepEqual(j.entries, load(cachePathFor(f))); // full mirror of the sidecar
  assert.deepEqual(j.entries, rep.entries);
  assert.equal(j.bytes, rep.size);
  assert.ok(j.bytes > 0);
  assert.equal(j.hitCapable, 2);
  assert.equal(j.sessionToolUses, 2);

  const noCache = oneJsonLine((await capture(['cache', src, '--json'])).out);
  assert.deepEqual(noCache.entries, []);
  assert.equal(noCache.bytes, 0);
  assert.equal(noCache.hitCapable, 0);
  assert.equal(noCache.sessionToolUses, 8); // demo session tool_use steps

  const human = await capture(['cache', f]);
  assert.equal(human.out, renderCacheReport(rep)); // byte-identical without --json
  rmSync(dir, { recursive: true, force: true });
});

test('cacheJson mirrors the report shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-json-'));
  const f = join(dir, 's.jsonl');
  writeFileSync(f, demoSession());
  const j = cacheJson(cacheReport(parseFile(f), f));
  assert.deepEqual(Object.keys(j), ['entries', 'bytes', 'hitCapable', 'sessionToolUses']);
  assert.deepEqual(j, { entries: [], bytes: 0, hitCapable: 0, sessionToolUses: 8 });
  rmSync(dir, { recursive: true, force: true });
});

// ---------- consistency: errors stay on stderr with exit 1 in both modes ----------

test('errors in --json mode: stderr message, empty stdout, exit code 1', async () => {
  const missing = join(tmpdir(), 'tape-missing-does-not-exist.jsonl');
  for (const [argv, re] of [
    [['stats', missing, '--json'], /tape: cannot read/],
    [['diff', missing, missing, '--json'], /tape diff: cannot read/],
    [['cache', missing, '--json'], /tape cache: cannot read/],
    [['grep', '--json'], /tape grep: need a query/],
    [['diff', missing, '--json'], /tape diff: need two files/],
  ]) {
    const r = await capture(argv);
    assert.equal(r.code, 1, `exit code for ${argv.join(' ')}`);
    assert.equal(r.out, '', `stdout must stay empty for ${argv.join(' ')}`);
    assert.match(r.err, re);
    assert.equal(r.err.trim().split('\n').length, 1, 'one clean line, no stack trace');
  }
});

test('errors in human mode behave identically (same stderr shape, exit 1)', async () => {
  const missing = join(tmpdir(), 'tape-missing-does-not-exist.jsonl');
  const json = await capture(['stats', missing, '--json']);
  const human = await capture(['stats', missing]);
  assert.equal(human.code, 1);
  assert.equal(human.err, json.err); // identical message in both modes
  assert.equal(human.out, '');
});
