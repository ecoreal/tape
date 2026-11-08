// `tape` with no arguments: find Claude Code sessions on this machine and
// let the user pick one. The fastest path from install to "oh, I get it".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// where this machine's sessions live, in override order: an explicit --root
// flag → $TAPE_SESSIONS_DIR → ~/.claude/projects (the Claude Code home base).
// grep and the no-arg picker share this so the 4 supported formats are all
// reachable, not just claude-code.
export function sessionsRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.TAPE_SESSIONS_DIR) return process.env.TAPE_SESSIONS_DIR;
  return join(homedir(), '.claude', 'projects');
}

export function scanSessions(root) {
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  const add = path => {
    try {
      const st = statSync(path);
      out.push({ path, mtime: st.mtimeMs, size: st.size, title: readTitle(path) });
    } catch { /* unreadable — skip */ }
  };
  for (const d of dirs) {
    // the usual layout is <root>/<project>/<session>.jsonl (Claude Code), but a
    // plain directory of *.jsonl works too — the other adapters write flat
    if (d.isFile()) {
      if (d.name.endsWith('.jsonl')) add(join(root, d.name));
      continue;
    }
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = readdirSync(join(root, d.name)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      add(join(root, d.name, f));
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// first summary/title line in the head of the file, if any
function readTitle(path) {
  try {
    const head = readFileSync(path, { encoding: 'utf8', flag: 'r' }).slice(0, 8192);
    for (const line of head.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'summary' && o.summary) return String(o.summary).slice(0, 60);
        if (o.type === 'ai-title' && o.aiTitle) return String(o.aiTitle).slice(0, 60);
      } catch { /* keep scanning */ }
    }
  } catch { /* no title */ }
  return '';
}

const ANSI = /\x1b\[[0-9;]*m/g;
const vis = s => String(s).replace(ANSI, '');
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

export function createPicker(sessions, root = '~/.claude/projects') {
  const st = { sel: 0, done: false, w: 80, h: 24 };
  return {
    get result() { return st.done ? sessions[st.sel] : null; },
    isDone: () => st.done,
    frame(w, h) {
      st.w = w; st.h = h;
      const lines = [];
      const head = bold('⏪ tape') + dim(' — pick a session (↑/↓ · enter open · q quit)');
      lines.push(head);
      lines.push(dim('─'.repeat(Math.max(0, w - 1))));
      const rows = Math.max(1, h - 4);
      const start = Math.max(0, Math.min(st.sel - (rows >> 1), sessions.length - rows));
      for (let r = 0; r < rows; r++) {
        const i = start + r;
        if (i >= sessions.length) { lines.push(''); continue; }
        const s = sessions[i];
        const when = new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' ');
        const label = `  ${when}  ${String(Math.round(s.size / 1024)).padStart(4)}KB  ${(s.title || s.path.split('/').pop()).slice(0, 46)}`;
        let row = label.length <= w - 2 ? label : label.slice(0, w - 3) + '…';
        if (i === st.sel) row = `\x1b[7m${row.padEnd(w - 2)}\x1b[27m`;
        lines.push(row);
      }
      // The footer names the scanned root. On a narrow frame, clip the path's
      // HEAD and keep its tail — the distinctive part lives at the end.
      const flabel = `${sessions.length} session(s) under `;
      const room = Math.max(1, w - 1 - flabel.length);
      const vroot = vis(String(root));
      const shown = vroot.length <= room ? root : '…' + vroot.slice(-(room - 1));
      lines.push(dim(flabel + shown));
      while (lines.length < h) lines.push('');
      return lines.slice(0, h).map(l => (vis(l).length <= w ? l : vis(l).slice(0, w)));
    },
    key(k) {
      if (k === 'up' || k === 'k') st.sel = Math.max(0, st.sel - 1);
      else if (k === 'down' || k === 'j') st.sel = Math.min(sessions.length - 1, st.sel + 1);
      else if (k === 'enter') st.done = true;
      else if (k === 'g') st.sel = 0;
      else if (k === 'G') st.sel = sessions.length - 1;
    },
  };
}
