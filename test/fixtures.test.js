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

test('generic fixture parses with one garbage line counted', () => {
  const { events, skipped } = parseFile(join(root, 'fixtures', 'generic', 'chat.jsonl'));
  assert.equal(events.length, 3);
  assert.equal(skipped, 1);
  assert.equal(events[2].type, 'user');
});
