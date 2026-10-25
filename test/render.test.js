import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines } from '../src/parse.js';
import { demoSession } from '../src/demo.js';
import { createApp } from '../src/app.js';
import { vis } from '../src/render.js';

function appAt(sel) {
  const { events } = parseLines(demoSession());
  const app = createApp({ events, file: 'demo.jsonl', skipped: 0 });
  for (let i = 0; i < sel; i++) app.key('j');
  return app;
}

test('frame fits width and shows step position', () => {
  const app = appAt(5);
  const lines = app.frame(100, 24);
  assert.equal(lines.length, 24);
  for (const l of lines) assert.ok(vis(l).length <= 100, `line too wide: ${vis(l)}`);
  assert.match(vis(lines[0]), /tape/);
  assert.match(vis(lines[23]), /6\/2\d/);
});

test('arrow keys move selection and detail follows', () => {
  const app = appAt(0);
  app.key('j'); app.key('j');
  const lines = vis(app.frame(100, 24).join('\n'));
  assert.match(lines, /3\/2\d/);
});

test('search jumps to first matching event', () => {
  const app = appAt(0);
  app.key('/');
  for (const ch of 'docker') app.key(ch);
  app.key('enter');
  const lines = vis(app.frame(100, 24).join('\n'));
  // first event mentioning docker is the restart tool_use (step 16 of 25)
  assert.match(lines, /16\/25/);
  assert.match(lines, /docker restart/);
});
