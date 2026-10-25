// `tape diff a.jsonl b.jsonl` — where did two runs of the same task split?
// Pure functions: first divergence, per-step differences, compact rendering.
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].type !== b[i].type || a[i].text !== b[i].text) return i;
  }
  return a.length === b.length ? null : n; // one ran longer
}

export function diffSummary(a, b) {
  const at = firstDiff(a, b);
  const differing = { count: 0 };
  const n = Math.min(a.length, b.length);
  for (let i = at ?? n; i < n; i++) {
    if (a[i].type !== b[i].type || a[i].text !== b[i].text) differing.count++;
  }
  return {
    divergence: at,
    steps: [a.length, b.length],
    differingAfterDivergence: differing.count,
    identicalPrefix: at ?? n,
  };
}

export function renderDiff(a, b, files) {
  const s = diffSummary(a, b);
  const out = [];
  out.push(bold('⏪ tape — diff') + dim(`  ${files[0]}  vs  ${files[1]}`));
  out.push('');
  if (s.divergence == null && a.length === b.length) {
    out.push('✓ identical sessions');
    return out.join('\n');
  }
  out.push(`steps        ${s.steps[0]} vs ${s.steps[1]}`);
  if (s.divergence != null) {
    const i = s.divergence;
    out.push(`divergence   step ${i + 1}`);
    out.push('');
    out.push(dim(`  A · ${a[i].type}`) + '  ' + cut(a[i].title, 52));
    out.push(dim(`  B · ${b[i].type}`) + '  ' + cut(b[i].title, 52));
    out.push('');
    out.push(dim(`identical prefix: ${s.identicalPrefix} steps · ${s.differingAfterDivergence} steps differ after divergence`));
    if (s.steps[0] !== s.steps[1]) out.push(dim(`length differs: ${s.steps[0]} vs ${s.steps[1]} — one session ran further`));
  } else {
    out.push(dim('no content divergence — one session is a prefix of the other'));
  }
  return out.join('\n');
}
