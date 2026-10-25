import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstDiff, diffSummary, renderDiff } from '../src/diff.js';
import { parseLines } from '../src/parse.js';
import { demoSession } from '../src/demo.js';

test('firstDiff finds the exact split point', () => {
  const a = parseLines(demoSession()).events;
  const b = parseLines(demoSession().replace('docker restart pg-test', 'docker kill pg-test')).events;
  assert.equal(firstDiff(a, b), 15); // the docker step (step 16 of 25)
  assert.equal(firstDiff(a, a), null);
  const shorter = a.slice(0, 10);
  assert.equal(firstDiff(a, shorter), 10);
});

test('renderDiff reports divergence and prefix relationship', () => {
  const a = parseLines(demoSession()).events;
  const b = a.slice();
  b[3] = { ...b[3], text: b[3].text + ' (edited)', title: b[3].title + '…' };
  const text = renderDiff(a, b, ['a.jsonl', 'b.jsonl']);
  assert.match(text, /divergence +step 4/);
  assert.match(text, /identical prefix: 3 steps/);
  const same = renderDiff(a, a, ['a.jsonl', 'a.jsonl']);
  assert.match(same, /identical sessions/);
});
