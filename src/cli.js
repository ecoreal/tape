import { parseFile } from './parse.js';
import { createApp } from './app.js';
import { run } from './tui.js';
import { writeDemo } from './demo.js';
import { vis } from './render.js';
import { scanSessions, createPicker } from './picker.js';
import { renderStats } from './stats.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VERSION = '0.1.0';

const HELP = `⏪ tape ${VERSION} — time-travel debugger for AI agent sessions

usage:
  tape                           pick a session from ~/.claude/projects
  tape <file.jsonl>              open an interactive timeline (TUI)
  tape demo [out.jsonl]          write a sample session, then open-ready
  tape <file> --frame <n>        render frame at step n to stdout (headless)
                                 --width W --height H --plain (no colors)

keys: ↑/↓ select · J/K scroll · g/G ends · / search · ? help · q quit

formats: tape-native · Claude Code sessions (~/.claude/projects/**\u002f*.jsonl) · generic {role,content}`;

export async function main(argv) {
  if (argv[0] === '-h' || argv[0] === '--help') { console.log(HELP); return; }
  if (argv[0] === '-v' || argv[0] === '--version') { console.log(VERSION); return; }
  const isStats = argv[0] === 'stats';
  if (isStats) argv = argv.slice(1);
  if (argv[0] === 'diff') {
    const [, fa, fb] = argv;
    if (!fa || !fb) { console.error('tape diff: need two files — tape diff a.jsonl b.jsonl'); process.exitCode = 1; return; }
    const A = parseFile(fa), B = parseFile(fb);
    if (!A.events.length || !B.events.length) { console.error('tape diff: both files need events'); process.exitCode = 1; return; }
    const { renderDiff } = await import('./diff.js');
    console.log(renderDiff(A.events, B.events, [fa, fb]));
    return;
  }
  if (argv[0] === 'demo') {
    const out = argv.slice(1).find(a => !a.startsWith('-')) || 'demo-session.jsonl';
    const n = writeDemo(out);
    console.log(`✨ wrote ${n}-step demo session → ${out}`);
    console.log(`▶ now run: tape ${out}`);
    return;
  }

  let file = null, frame = null, width = 0, height = 0, plain = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--frame') {
      frame = Number(argv[++i]);
      if (!Number.isFinite(frame)) {
        console.error('tape: --frame needs a step number, e.g. --frame 15');
        process.exitCode = 1;
        return;
      }
    }
    else if (a === '--width') width = Number(argv[++i]);
    else if (a === '--height') height = Number(argv[++i]);
    else if (a === '--plain') plain = true;
    else if (!a.startsWith('-') && file === null) file = a;
  }
  if (!file) {
    // no file given: offer the sessions this machine already has
    const sessions = scanSessions(join(homedir(), '.claude', 'projects'));
    if (!sessions.length) { console.log(HELP); process.exitCode = 1; return; }
    if (!process.stdout.isTTY) {
      console.log('sessions found (run `tape <path>`):\n');
      sessions.slice(0, 15).forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)} ${s.path}`));
      return;
    }
    const picker = createPicker(sessions);
    await run(picker); // exits alt-screen after enter/q
    if (!picker.result) return; // q — user changed their mind
    file = picker.result.path;
    console.log(`⏪ opening ${file}`);
  }

  let parsed;
  try {
    parsed = parseFile(file);
  } catch (e) {
    console.error(`tape: cannot read ${file} (${e.code || e.message})`);
    process.exitCode = 1;
    return;
  }
  const { events, skipped, meta } = parsed;
  if (!events.length) {
    console.error(`tape: no recognizable events in ${file} (${skipped} skipped, ${meta} metadata lines)`);
    process.exitCode = 1;
    return;
  }

  if (isStats) {
    console.log(renderStats(parsed, file));
    return;
  }

  const app = createApp({ events, file, skipped, meta });
  if (frame !== null) {
    const target = Math.max(0, Math.min(events.length - 1, Math.floor(frame)));
    app.key('G'); // jump to last, then step back to requested frame
    for (let i = events.length - 1; i > target; i--) app.key('up');
    const lines = app.frame(width || 80, height || 24);
    console.log(lines.map(l => (plain ? vis(l) : l)).join('\n'));
    return;
  }
  await run(app);
}
