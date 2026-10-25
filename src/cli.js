import { parseFile } from './parse.js';
import { createApp } from './app.js';
import { run } from './tui.js';
import { writeDemo } from './demo.js';
import { vis } from './render.js';
import { scanSessions, createPicker } from './picker.js';
import { renderStats } from './stats.js';
import { join } from 'node:path';
const dim2 = s => `\x1b[2m${s}\x1b[0m`;
import { homedir } from 'node:os';

const VERSION = '0.1.0';

const HELP = `⏪ tape ${VERSION} — time-travel debugger for AI agent sessions

usage:
  tape                           pick a session from ~/.claude/projects
  tape <file.jsonl>              open an interactive timeline (TUI)
  tape demo [out.jsonl]          write a sample session, then open-ready
  tape <file> --frame <n>        render frame at step n to stdout (headless)
                                 --width W --height H --plain (no colors)
  tape <file> --follow            tail a live session; stays at the tail
  tape <file> --filter tool_use   view-only filter to one event type
  tape grep <query>               which local session mentioned X?
  tape diff <a.jsonl> <b.jsonl>   where did two runs of a task split?

keys: ↑/↓ select · J/K scroll · g/G ends · / search · ? help · q quit

formats: tape-native · Claude Code sessions (~/.claude/projects/**\u002f*.jsonl) · generic {role,content}`;

export async function main(argv) {
  if (argv[0] === '-h' || argv[0] === '--help') { console.log(HELP); return; }
  if (argv[0] === '-v' || argv[0] === '--version') { console.log(VERSION); return; }
  const isStats = argv[0] === 'stats';
  if (isStats) argv = argv.slice(1);
  if (argv[0] === 'film') {
    const args = argv.slice(1);
    const file = args.find(a => !a.startsWith('-'));
    let every = 4, width = 80, height = 18;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--every') every = Math.max(1, Number(args[++i]) || 4);
      if (args[i] === '--width') width = Number(args[++i]) || 80;
      if (args[i] === '--height') height = Number(args[++i]) || 18;
    }
    if (!file) { console.error('tape film: tape film <file> [--every 4]'); process.exitCode = 1; return; }
    const parsed2 = parseFile(file);
    if (!parsed2.events.length) { console.error('tape film: no events'); process.exitCode = 1; return; }
    const app = createApp({ ...parsed2, file });
    const total = parsed2.events.length;
    const stops = [];
    for (let i = every - 1; i < total; i += every) stops.push(i);
    if (stops[stops.length - 1] !== total - 1) stops.push(total - 1);
    console.log(dim2(`# tape film · ${file} · ${stops.length} frames (every ${every} steps)`));
    for (const idx of stops) {
      const at = total - 1 - idx;
      app.key('G');
      for (let k = 0; k < at; k++) app.key('up');
      console.log(dim2(`\n── step ${idx + 1}/${total} ${'─'.repeat(40)}`));
      console.log(app.frame(width, height).join('\n'));
    }
    return;
  }
  if (argv[0] === 'fork') {
    const args = argv.slice(1);
    const file = args.find(a => !a.startsWith('-'));
    const n = Number(args.find((a, i) => i > 0 && !a.startsWith('-') && /^\d+$/.test(a)) || args[1]);
    let out, noEdit = args.includes('--no-edit');
    for (let i = 0; i < args.length; i++) { if (args[i] === '--out') out = args[++i]; }
    if (!file || !Number.isFinite(n)) { console.error('tape fork: tape fork <file> <step> [--no-edit] [--out f]'); process.exitCode = 1; return; }
    const { forkSession, editInEditor } = await import('./fork.js');
    let editText;
    if (!noEdit) {
      // editor flow needs a real TTY; otherwise we fork without editing
      const stepText = parseFile(file).events[n - 1]?.text || '';
      editText = editInEditor(stepText) ?? undefined;
    }
    try {
      const r = forkSession(file, n, { out, editText });
      console.log(`🌿 forked at step ${r.kept} → ${r.out}`);
      console.log(`   continue: tape rerun ${r.out} [--provider echo|openai]`);
      console.log(`   compare:  tape diff ${file} ${r.out}`);
    } catch (e) { console.error(`tape fork: ${e.message}`); process.exitCode = 1; }
    return;
  }
  if (argv[0] === 'rerun') {
    const args = argv.slice(1);
    const file = args.find(a => !a.startsWith('-'));
    if (!file) { console.error('tape rerun: tape rerun <file> [--provider echo] [--turns 2]'); process.exitCode = 1; return; }
    let provider = 'echo', turns = 2;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--provider') provider = args[++i];
      if (args[i] === '--turns') turns = Number(args[++i]) || 2;
    }
    const { rerun } = await import('./rerun.js');
    const r = await rerun(file, { provider, turns });
    if (r.error) { console.error(`tape rerun: ${r.error}`); process.exitCode = 1; return; }
    console.log(`▶ rerun added ${r.added} turn(s) via ${provider}`);
    return;
  }
  if (argv[0] === 'grep') {
    const query = argv.slice(1).find(a => !a.startsWith('-'));
    if (!query) { console.error('tape grep: need a query — tape grep ECONNRESET'); process.exitCode = 1; return; }
    const { grepSessions } = await import('./grep.js');
    const hits = grepSessions(query);
    if (!hits.length) { console.log(`no local session mentions "${query}"`); return; }
    console.log(`"${query}" appears in ${hits.length} session(s):\n`);
    for (const h of hits) {
      const when = new Date(h.mtime).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`  ${when}  ${String(h.hits).padStart(2)} hits  ${h.title.slice(0, 40).padEnd(42)} ${h.path}`);
    }
    console.log(`\nopen one with: tape <path>   then / to jump between matches`);
    return;
  }
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

  let file = null, frame = null, width = 0, height = 0, plain = false, follow = false, filter = null;
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
    else if (a === '--follow') follow = true;
    else if (a === '--filter') filter = argv[++i];
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

  const app = createApp({ events, file, skipped, meta, follow, filter });
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
