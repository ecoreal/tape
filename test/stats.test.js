import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/parse.js';
import { buildStats, renderStats, sparkline } from '../src/stats.js';
import { demoSession } from '../src/demo.js';
import { parseLines } from '../src/parse.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('stats extraction: cost, duration, tokens, models, tools', () => {
  const parsed = parseFile(join(root, 'fixtures', 'claude-code', 'basic.jsonl'));
  const s = buildStats(parsed);
  assert.equal(s.cost, 0.041);
  assert.equal(s.duration, 184000);
  assert.equal(s.tokens.in, 1200);
  assert.equal(s.tokens.out, 85);
  assert.deepEqual(s.models, [['claude-x-1', 2]]);
  assert.deepEqual(s.topTools, [['Bash', 1]]);
  assert.equal(s.steps, 6);
});

test('renderStats produces a compact human summary', () => {
  const parsed = parseFile(join(root, 'fixtures', 'claude-code', 'basic.jsonl'));
  const text = renderStats(parsed, 'basic.jsonl');
  assert.match(text, /steps +6/);
  assert.match(text, /\$0\.041/);
  assert.match(text, /3m04s/);
  assert.match(text, /1\.2k/);
  assert.match(text, /[▁▂▃▄▅▆▇█]{6}/);
});

test('stats degrade gracefully on sessions without cost/usage data', () => {
  const s = buildStats(parseLines(demoSession()));
  assert.equal(s.cost, null);
  assert.equal(s.tokens.out, 0);
  assert.ok(s.activity.length === 25);
  const text = renderStats(parseLines(demoSession()), 'demo');
  assert.doesNotMatch(text, /cost/);
  assert.match(text, /[▁▂▃▄▅▆▇█]/); // activity sparkline still renders
});

test('sparkline samples long inputs down to width', () => {
  const line = sparkline(Array.from({ length: 500 }, (_, i) => i), 60);
  assert.equal(line.length, 60);
  assert.ok(sparkline([]) === '');
});

test('parse performance guard: 10k-line session under 300ms', () => {
  const base = demoSession().trim().split('\n');
  const big = Array.from({ length: 400 }, () => base).flat().join('\n');
  const t0 = performance.now();
  const { events } = parseLines(big);
  const dt = performance.now() - t0;
  assert.equal(events.length, 10000);
  assert.ok(dt < 300, `parse took ${dt.toFixed(0)}ms — regressed`);
});
