import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, normalize } from '../src/parse.js';
import { demoSession } from '../src/demo.js';

test('demo session parses with zero skipped lines', () => {
  const { events, skipped } = parseLines(demoSession());
  assert.equal(skipped, 0);
  assert.ok(events.length >= 20);
  assert.equal(events[0].type, 'user');
  assert.ok(events.some(e => e.type === 'error'));
  assert.ok(events.some(e => e.type === 'error' && e.text.includes('ECONNRESET')));
  // indices assigned
  assert.equal(events[1].i, 1);
});

test('claude-code adapter maps content blocks', () => {
  const line = {
    type: 'assistant',
    timestamp: '2026-10-25T10:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'test-model',
      content: [
        { type: 'text', text: 'reading the file' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } },
      ],
    },
  };
  const out = normalize(line);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'assistant');
  assert.equal(out[1].type, 'tool_use');
  assert.equal(out[1].meta.tool, 'Read');
  assert.match(out[1].title, /Read/);

  const toolResult = normalize({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }] },
  });
  assert.equal(toolResult[0].type, 'tool_result');
  assert.equal(toolResult[0].text, 'file body');
});

test('generic {role,content} lines and garbage lines are handled', () => {
  assert.equal(normalize({ role: 'user', content: 'hi' })[0].type, 'user');
  const { events, skipped } = parseLines('not json\n{"role":"assistant","content":"ok"}\n\n{"unknown":"shape"}');
  assert.equal(events.length, 1);
  assert.equal(skipped, 2);
});
