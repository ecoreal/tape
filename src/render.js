// Pure frame renderer: render(state) -> exactly h lines, each at most w wide.
// No side effects — this is what `tape --frame N` and the tests exercise.
import { TYPES } from './parse.js';

const ANSI = /\x1b\[[0-9;]*m/g;
export const vis = s => String(s).replace(ANSI, '');
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

function padTo(s, n) { const l = vis(s).length; return l >= n ? s : s + ' '.repeat(n - l); }
function cut(s, n) { s = String(s); return vis(s).length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…'; }

export function wrap(text, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para.length <= width) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (vis(line).length + word.length > width) {
        if (line.trim()) out.push(line.trimEnd());
        line = word.trimStart();
        while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
      } else line += word;
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

export function renderFrame(st) {
  const { w, h } = st;
  const lines = [];
  const n = st.events.length;

  // header
  const left = bold('⏪ tape') + ' ' + dim(String(st.file || ''));
  const counts = [`${n} steps`, st.meta ? `${st.meta} meta` : '', st.skipped ? `${st.skipped} skipped` : ''].filter(Boolean).join(' · ');
  const right = dim(counts);
  lines.push(padTo(cut(left, w - vis(right).length - 1) + ' ' + right, w));

  const listW = Math.max(24, Math.min(46, Math.floor(w * 0.45)));
  const detW = w - listW - 3; // borders + gap
  const rows = Math.max(3, h - 4); // header + panel top/bottom + status

  // left rows
  const sel = st.sel;
  const start = Math.max(0, Math.min(sel - (rows >> 1), n - rows));
  const leftRows = [];
  for (let r = 0; r < rows; r++) {
    const i = start + r;
    if (i >= n) { leftRows.push(''); continue; }
    const e = st.events[i];
    const t = TYPES[e.type] || TYPES.system;
    const isMatch = st.query && match(e, st.query);
    let row = `  ${t.glyph} ${cut(e.title, listW - 7)}`;
    if (isMatch) row = `\x1b[33m${row}\x1b[0m`;
    if (i === sel) row = `\x1b[7m${padTo(row, listW - 2)}\x1b[27m`;
    leftRows.push(row);
  }

  // right detail
  const e = n ? st.events[sel] : null;
  const detRows = [];
  if (e) {
    const t = TYPES[e.type] || TYPES.system;
    const bits = [`${t.color}${e.type}\x1b[0m`];
    if (e.meta?.tool) bits.push(dim(`tool=${e.meta.tool}`));
    if (e.meta?.model) bits.push(dim(e.meta.model));
    if (e.ts) bits.push(dim(e.ts.replace('T', ' ').slice(0, 19)));
    detRows.push(cut(bits.join('  '), detW));
    detRows.push('');
    const wrapped = wrap(e.text, detW);
    const visible = wrapped.slice(st.scroll, st.scroll + rows - 2);
    detRows.push(...visible);
  } else {
    detRows.push(dim('(no events — is this file empty?)'));
  }

  // assemble body
  const top = dim('┌' + '─'.repeat(listW - 2) + '┬' + '─'.repeat(detW + 1) + '┐');
  lines.push(padTo(top, w));
  for (let r = 0; r < rows; r++) {
    const l = padTo(leftRows[r] || '', listW - 2);
    const d = padTo(cut(detRows[r] || '', detW + 1), detW + 1);
    lines.push(padTo(dim('│') + l + dim('│') + d + dim('│'), w));
  }
  lines.push(padTo(dim('└' + '─'.repeat(listW - 2) + '┴' + '─'.repeat(detW + 1) + '┘'), w));

  // status / search / help
  if (st.mode === 'search') {
    const s = `/${st.query}█`;
    const hint = dim('  enter=jump  esc=cancel');
    lines.push(padTo(cut(s + hint, w), w));
  } else if (st.mode === 'help') {
    const keys = [
      '↑/↓ or j/k   select step',
      'J/K          scroll detail',
      'g / G        first / last step',
      '/            search        q  quit',
      '',
      'formats: tape-native · claude-code · {role,content}',
    ];
    const bw = Math.min(w - 4, 52);
    const bh = keys.length + 2;
    const overlay = [' ' + bold('tape — keys')];
    overlay.push(...keys.map(k => ' ' + k));
    for (let i = 0; i < h; i++) {
      if (i >= 2 && i < 2 + bh) {
        const row = overlay[i - 2] ?? '';
        lines[i] = padTo(' ' + cut(row, bw) + ' '.repeat(Math.max(0, bw - vis(row))), w);
      }
    }
    lines.push(padTo(dim('? close help'), w));
  } else {
    const hint = '↑↓ select · / search · ? help · q quit';
    const pos = `${n ? sel + 1 : 0}/${n}`;
    lines.push(padTo(dim(cut(hint, w - vis(pos).length - 1)) + ' ' + pos, w));
  }

  while (lines.length < h) lines.push('');
  // last-resort width guard: on very narrow terminals a composed line can
  // still exceed w (panel minimums) — hard-cut to plain text rather than wrap
  return lines.slice(0, h).map(l => (vis(l).length <= w ? l : vis(l).slice(0, Math.max(0, w - 1)) + '…'));
}

export function match(e, q) {
  q = q.toLowerCase();
  return e.title.toLowerCase().includes(q) || e.text.toLowerCase().includes(q);
}
