// Golden tests: fixtures are hand-verified transcripts. If an adapter change
// moves these numbers, that change is a breaking format change — think twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/parse.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('claude-code fixture maps to the golden event sequence', () => {
  const { events, skipped, meta } = parseFile(join(root, 'fixtures', 'claude-code', 'basic.jsonl'));
  assert.equal(skipped, 0);
  assert.equal(meta, 3); // summary + cost-state + mode: bookkeeping, not data loss
  assert.deepEqual(events.map(e => e.type), [
    'user', 'assistant', 'tool_use', 'tool_result', 'assistant', 'assistant',
  ]);
  const toolUse = events[2];
  assert.equal(toolUse.meta.tool, 'Bash');
  assert.match(toolUse.title, /Bash/);
  assert.equal(events[3].text, '1 failed\n  ✗ auth refresh race');
  // thinking block maps to assistant with a marker
  assert.equal(events[4].meta.thinking, true);
});

test('tape-native fixture maps to the golden event sequence', () => {
  const { events, skipped, meta } = parseFile(join(root, 'fixtures', 'tape-native', 'basic.jsonl'));
  assert.equal(skipped, 0);
  assert.equal(meta, 0);
  assert.deepEqual(events.map(e => e.type), [
    'user', 'assistant', 'tool_use', 'tool_result', 'error', 'assistant',
  ]);
  assert.equal(events[0].ts, '2026-10-25T12:00:00.000Z');
  assert.equal(events[2].meta.tool, 'grep');
  assert.equal(events[4].text, 'fetch failed: ECONNRESET — registry socket dropped mid-install');
});

test('generic fixture parses with one garbage line counted', () => {
  const { events, skipped } = parseFile(join(root, 'fixtures', 'generic', 'chat.jsonl'));
  assert.equal(events.length, 3);
  assert.equal(skipped, 1);
  assert.equal(events[2].type, 'user');
});

test('openclaw fixture maps to the golden event sequence', () => {
  const { events, skipped, meta, stats } = parseFile(join(root, 'fixtures', 'openclaw', 'basic.jsonl'));
  assert.equal(skipped, 1); // one non-JSON line, tolerated
  assert.equal(meta, 5);    // session header, model_change, thinking_level, compaction, custom
  assert.deepEqual(events.map(e => e.type), [
    'user', 'assistant', 'assistant', 'tool_use', 'tool_result',
    'assistant', 'tool_use', 'tool_result', 'assistant', 'error',
  ]);
  assert.equal(events[1].meta.thinking, true, 'thinking block is an assistant step with a marker');
  assert.equal(events[3].meta.tool, 'read');
  assert.equal(events[3].meta.id, 'call_7');
  assert.match(events[4].text, /export async function logout/, 'multi-line tool output survives verbatim');
  assert.equal(events[9].type, 'error', 'isError:true toolResult becomes an error step');
  assert.equal(events[9].meta.tool, 'bash');
  // usage: {input, output, cacheRead} + nested cost sum
  assert.equal(stats.tokensIn, 6400);
  assert.equal(stats.tokensOut, 285);
  assert.equal(Math.round(stats.cost * 1e4) / 1e4, 0.0204);
  assert.deepEqual(stats.models, { 'claude-x-1': 3 });
});

test('openclaw: unknown roles and blocks map to nothing (counted, never fatal)', async () => {
  const { parseLines } = await import('../src/parse.js');
  const lines = [
    { type: 'message', message: { role: 'system', content: [{ type: 'text', text: 'hi' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'image', data: 'x' }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } },
  ].map(o => JSON.stringify(o)).join('\n');
  const { events, skipped } = parseLines(lines);
  assert.deepEqual(events.map(e => e.type), ['tool_result']);
  assert.equal(skipped, 2, 'two unhandled lines are counted, not guessed');
});
