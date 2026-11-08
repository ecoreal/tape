// Where sessions live is configurable: `--root <dir>` / `$TAPE_SESSIONS_DIR`
// for `tape grep` and the no-arg picker — so the other three formats (OpenClaw
// / tape-native / generic) are searchable and pickable, not just claude-code's
// ~/.claude/projects. scanSessions also accepts a flat directory of *.jsonl,
// since the other adapters don't use Claude Code's <project>/<file> layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.js';
import { scanSessions, sessionsRoot, createPicker } from '../src/picker.js';
import { vis } from '../src/render.js';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// save/restore the env + homedir knobs every test here touches
function withHome(fn) {
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TAPE_SESSIONS_DIR: process.env.TAPE_SESSIONS_DIR,
  };
  return async () => {
    try { return await fn(); }
    finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test('scanSessions picks up plain *.jsonl in the root, next to project subdirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-flat-'));
  const flat = join(dir, 'flat.jsonl');
  writeFileSync(flat, JSON.stringify({ role: 'user', content: 'hello flat world' }) + '\n');
  mkdirSync(join(dir, 'proj'));
  const nested = join(dir, 'proj', 'nested.jsonl');
  writeFileSync(nested, JSON.stringify({ role: 'user', content: 'nested session' }) + '\n');
  utimesSync(flat, new Date(1_000_000), new Date(1_000_000));   // deterministic recency
  utimesSync(nested, new Date(2_000_000), new Date(2_000_000)); // …nested is newer
  try {
    const sessions = scanSessions(dir);
    assert.equal(sessions.length, 2);
    assert.ok(sessions[0].path.endsWith('nested.jsonl'), 'sorted newest-first');
    assert.ok(sessions[1].path.endsWith('flat.jsonl'));
    assert.equal(sessions[1].title, ''); // no summary line → empty title, filename shown instead
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionsRoot: --root beats $TAPE_SESSIONS_DIR beats ~/.claude/projects', withHome(async () => {
  const home = mkdtempSync(join(tmpdir(), 'tape-home-'));
  process.env.HOME = home;         // unix homedir resolution
  process.env.USERPROFILE = home;  // windows homedir resolution
  delete process.env.TAPE_SESSIONS_DIR;
  assert.equal(sessionsRoot(), join(home, '.claude', 'projects')); // the old default, unchanged
  process.env.TAPE_SESSIONS_DIR = '/sessions-from-env';
  assert.equal(sessionsRoot(), '/sessions-from-env');
  assert.equal(sessionsRoot('/from-flag'), '/from-flag');          // explicit wins
  rmSync(home, { recursive: true, force: true });
}));

test('tape grep --root searches any directory, not just ~/.claude/projects', withHome(async () => {
  const home = mkdtempSync(join(tmpdir(), 'tape-home-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'tape-sessions-'));
  writeFileSync(join(elsewhere, 'openclaw.jsonl'), [
    JSON.stringify({ type: 'session', version: 3, id: 'oc-1' }),            // meta, never a step
    JSON.stringify({ type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'the deploy pipeline hit ECONNRESET' }] } }),
  ].join('\n') + '\n');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.TAPE_SESSIONS_DIR;
  try {
    // default root (an empty fake home) stays blind to it
    const none = await capture(['grep', 'ECONNRESET', '--json']);
    assert.equal(none.err, '');
    assert.deepEqual(JSON.parse(none.out.trim()), []);

    // --root finds it, in both output modes
    const j = JSON.parse((await capture(['grep', 'ECONNRESET', '--root', elsewhere, '--json'])).out.trim());
    assert.equal(j.length, 1);
    assert.ok(j[0].path.endsWith('openclaw.jsonl'));
    assert.equal(j[0].steps, 1); // the session header counted as metadata, not a step
    assert.equal(j[0].hits, 1);
    const human = await capture(['grep', 'ECONNRESET', '--root', elsewhere]);
    assert.equal(human.err, '');
    assert.match(human.out, /"ECONNRESET" appears in 1 session\(s\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
}));

test('$TAPE_SESSIONS_DIR routes tape grep and the no-arg picker', withHome(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-env-'));
  const file = join(dir, 'native.jsonl');
  writeFileSync(file, JSON.stringify({ role: 'user', content: 'scrub back to step 15' }) + '\n');
  process.env.TAPE_SESSIONS_DIR = dir;
  const origTTY = process.stdout.isTTY;
  process.stdout.isTTY = false; // headless listing branch: no TUI is ever started
  try {
    const g = await capture(['grep', 'scrub']);
    assert.equal(g.err, '');
    assert.match(g.out, /"scrub" appears in 1 session\(s\)/);
    assert.ok(g.out.includes(file));

    const list = await capture([]);
    assert.equal(list.code, 0);
    assert.match(list.out, /sessions found/);
    assert.ok(list.out.includes(file), 'the flat session under $TAPE_SESSIONS_DIR is offered');

    // the picker footer names the root it actually scanned — on narrow frames
    // the path's head may be clipped, but its distinctive tail must survive
    const p = createPicker([{ path: file, mtime: 1, size: 10, title: '' }], dir);
    const footer = p.frame(80, 10).find(l => l.includes('session(s) under'));
    assert.ok(footer, 'footer line exists');
    assert.match(
      vis(footer),
      new RegExp(basename(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the scanned root (its unique tail) is named',
    );
  } finally {
    process.stdout.isTTY = origTTY;
    rmSync(dir, { recursive: true, force: true });
  }
}));
