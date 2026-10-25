import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSessions, createPicker } from '../src/picker.js';
import { ADAPTERS } from '../src/parse.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vis } from '../src/render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('scanSessions finds jsonl files in project subdirs, sorted by recency', () => {
  // fixtures/ mirrors the real layout: <root>/<project-dir>/*.jsonl, and holds
  // exactly one fixture per registered adapter (docs/adapter-spec.md).
  const sessions = scanSessions(join(root, 'fixtures'));
  assert.equal(sessions.length, ADAPTERS.length); // tape-native + claude-code + generic
  assert.ok(sessions.some(s => s.path.endsWith('basic.jsonl') && s.size > 0));
  assert.ok(
    sessions[0].mtime >= sessions[1].mtime,
    'sorted newest-first',
  );
});

test('scanSessions tolerates a missing directory', () => {
  assert.deepEqual(scanSessions('/nonexistent/nowhere'), []);
});

test('picker state machine: navigate, open, quit', () => {
  const items = [{ path: 'a.jsonl', mtime: 2, size: 10, title: 'A' }, { path: 'b.jsonl', mtime: 1, size: 20, title: 'B' }];
  const p = createPicker(items);
  const lines = p.frame(80, 10);
  assert.equal(lines.length, 10);
  for (const l of lines) assert.ok(vis(l).length <= 80);
  assert.match(vis(lines[2]), /A/);
  p.key('j');
  assert.equal(p.result, null); // not confirmed yet
  p.key('enter');
  assert.equal(p.result.path, 'b.jsonl');
  const q = createPicker(items);
  q.key('k'); // clamped at top
  q.key('enter');
  assert.equal(q.result.path, 'a.jsonl');
});
