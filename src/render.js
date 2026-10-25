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
  if (st.diffMode) return finishFrame(renderDiffLines(st), st.w, st.h);
  const { w, h } = st;
  const lines = [];
  const n = st.view.length;

  // header
  const left = bold('⏪ tape') + ' ' + dim(String(st.file || ''));
  const countBits = [`${n} steps`];
  if (st.filter) countBits.push(`filtered: ${st.filter} of ${st.events.length}`);
  if (st.meta) countBits.push(`${st.meta} meta`);
  if (st.skipped) countBits.push(`${st.skipped} skipped`);
  const right = dim(countBits.join(' · '));
  lines.push(padTo(cut(left, w - vis(right).length - 1) + ' ' + right, w));

  const listW = Math.max(24, Math.min(46, Math.floor(w * 0.45)));
  const detW = w - listW - 3; // borders + gap
  const rows = Math.max(3, h - 4); // header + panel top/bottom + status

  // left rows (over the filtered view)
  const sel = st.sel;
  const start = Math.max(0, Math.min(sel - (rows >> 1), n - rows));
  const leftRows = [];
  for (let r = 0; r < rows; r++) {
    const i = start + r;
    if (i >= n) { leftRows.push(''); continue; }
    const e = st.view[i];
    const t = TYPES[e.type] || TYPES.system;
    const isMatch = st.query && match(e, st.query);
    let row = `  ${t.glyph} ${cut(e.title, listW - 7)}`;
    if (isMatch) row = `\x1b[33m${row}\x1b[0m`;
    if (i === sel) row = `\x1b[7m${padTo(row, listW - 2)}\x1b[27m`;
    leftRows.push(row);
  }

  // right detail
  const e = n ? st.view[sel] : null;
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
      'f            fork here (writes <file>.fork-N.jsonl)',
      'd            diff vs fork source (forks only)',
      '/            search        q  quit',
      '',
      'formats: tape-native · claude-code · {role,content}',
      'also: stats · diff a b · --follow (tail live)',
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
    const hint = st.note || '↑↓ select · f fork · / search · ? help · q quit';
    const pos = `${n ? sel + 1 : 0}/${n}`;
    const line = (st.note ? hint + '  ' : dim(cut(hint, w - vis(pos).length - 1)) + ' ') + pos;
    lines.push(padTo(cut(line, w), w));
  }

  // last-resort width guard lives in finishFrame: pad to h, hard-cut overwide
  return finishFrame(lines, w, h);
}

// shared tail: pad to exactly h lines, hard-cut anything wider than w
function finishFrame(lines, w, h) {
  while (lines.length < h) lines.push('');
  return lines.slice(0, h).map(l => (vis(l).length <= w ? l : vis(l).slice(0, Math.max(0, w - 1)) + '…'));
}

// The in-TUI diff view (st.diffMode): how the open fork split from its source.
// Pure function of state, like the timeline.
function renderDiffLines(st) {
  const { w, h } = st;
  const d = st.diffMode;
  const s = d.summary;
  const lines = [];

  const right = dim(`${s.steps[0]} vs ${s.steps[1]} steps`);
  const head = bold('⏪ tape — diff') + ' ' + dim(`vs ${d.source}`);
  // no full-width pad: in wide-glyph locales ⏪ renders 2 cells and a padded
  // line would wrap in a real terminal (the timeline header carries that
  // pre-existing quirk; this view stays wrap-free)
  lines.push(cut(head + ' ' + right, w));
  lines.push('');

  if (s.divergence == null) {
    lines.push(s.steps[0] === s.steps[1]
      ? '✓ identical sessions'
      : dim('no content divergence — one session is a prefix of the other'));
  } else {
    const i = s.divergence;
    lines.push(`divergence   step ${i + 1} (0-based ${i})`);
    lines.push('');
    const srcTitle = d.aTitles[i] != null ? d.aTitles[i] : '(missing)';
    const cur = st.events[i];
    lines.push(cut(`  source   ${srcTitle}`, w));
    lines.push(cut(`  current  ${cur ? cur.title : '(missing)'}`, w));
    lines.push('');
    lines.push(dim(`identical prefix: ${s.identicalPrefix} steps · ${s.differingAfterDivergence} steps differ after divergence`));
    if (s.steps[0] !== s.steps[1]) lines.push(dim(`length differs: ${s.steps[0]} vs ${s.steps[1]} — one session ran further`));
  }

  while (lines.length < h - 1) lines.push('');
  lines.push(dim('d back · q quit'));
  return lines;
}

export function match(e, q) {
  q = q.toLowerCase();
  return e.title.toLowerCase().includes(q) || e.text.toLowerCase().includes(q);
}
