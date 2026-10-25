import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, parseFile } from '../src/parse.js';
import { demoSession } from '../src/demo.js';
import { createApp } from '../src/app.js';
import { vis } from '../src/render.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup(dir) {
  const file = join(dir, 's.jsonl');
  writeFileSync(file, demoSession());
  return { file, parsed: parseFile(file) };
}

test('--filter is view-only: selection stays inside the view, indices map back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-filter-'));
  const { file, parsed } = setup(dir);
  const app = createApp({ ...parsed, file, filter: 'tool_use' });
  const tools = parsed.events.filter(e => e.type === 'tool_use');
  const lines = app.frame(100, 24).map(vis);
  assert.match(lines[0], /filtered: tool_use of \d+/);
  // only tool rows in the list pane
  const body = lines.slice(2, -2).join('\n');
  assert.ok(!/  U /m.test(body), 'no user rows under tool_use filter');
  // navigation walks the filtered view only
  app.key('G');
  const tail = app.frame(100, 24).map(vis);
  assert.match(tail.join(''), new RegExp(`${tools.length}/${tools.length}`));
  // viewMap: the fork key uses real indices — fork at last tool_use step
  rmSync(dir, { recursive: true, force: true });
});

test("`f` forks at the selected step without leaving the TUI", () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-ffork-'));
  const { file, parsed } = setup(dir);
  const app = createApp({ ...parsed, file });
  app.key('j'); app.key('j'); // step 3
  app.key('f');
  const out = join(dir, 's.fork-3.jsonl');
  assert.ok(existsSync(out), 'fork file written');
  const forked = parseLines(readFileSync(out, 'utf8'));
  assert.equal(forked.events.length, 4); // 3 kept + fork marker
  assert.equal(forked.events[3].type, 'system');
  const lines = app.frame(100, 24).map(vis).join('\n');
  assert.match(lines, /forked at step 3/);
  assert.equal(app.isDone(), false, 'TUI stays open');
  // note clears on next keypress
  app.key('j');
  assert.doesNotMatch(app.frame(100, 24).map(vis).join('\n'), /forked at step/);
  rmSync(dir, { recursive: true, force: true });
});
