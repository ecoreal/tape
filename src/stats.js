// `tape stats <file>` — session summary from data the transcript already
// contains (cost-state lines, message usage envelopes, step sizes).
const SPARK = '▁▂▃▄▅▆▇█';
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

function humanMs(ms) {
  if (ms == null) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(0)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

export function sparkline(values, width = 60) {
  if (!values.length) return '';
  const sample = values.length <= width
    ? values
    : Array.from({ length: width }, (_, i) => values[Math.floor((i * values.length) / width)]);
  const max = Math.max(...sample, 1);
  return sample.map(v => SPARK[Math.min(SPARK.length - 1, Math.floor((v / max) * SPARK.length))]).join('');
}

export function buildStats(parsed) {
  const { events, stats } = parsed;
  const byType = {};
  const tools = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.type === 'tool_use' && e.meta?.tool) tools[e.meta.tool] = (tools[e.meta.tool] || 0) + 1;
  }
  const first = events.find(e => e.ts), last = [...events].reverse().find(e => e.ts);
  const spanMs = first && last ? Date.parse(last.ts) - Date.parse(first.ts) : null;
  return {
    steps: events.length,
    byType,
    topTools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 6),
    cost: stats.cost,
    duration: stats.durationMs ?? spanMs,
    lines: [stats.linesAdded, stats.linesRemoved],
    tokens: { in: stats.tokensIn, out: stats.tokensOut },
    models: Object.entries(stats.models).sort((a, b) => b[1] - a[1]),
    activity: events.map(e => e.text.length),
  };
}

// Machine-readable twin of renderStats, for `tape stats <file> --json`:
// mirrors buildStats exactly (nulls where the transcript has no data) plus the
// file it describes. No invented fields — the `activity` sparkline stays
// render-only. Serialized as one line on stdout.
export function statsJson(parsed, file) {
  const s = buildStats(parsed);
  return {
    file,
    steps: s.steps,
    byType: s.byType,
    topTools: s.topTools,
    cost: s.cost,
    durationMs: s.duration,
    tokens: { in: s.tokens.in, out: s.tokens.out },
    models: s.models,
    lines: s.lines,
  };
}

export function renderStats(parsed, file) {
  const s = buildStats(parsed);
  const out = [];
  out.push(bold('⏪ tape — stats') + dim(`  ${file}`));
  out.push('');
  out.push(`steps        ${s.steps}  ` + Object.entries(s.byType).map(([t, n]) => `${t} ${n}`).join(' · '));
  if (s.duration != null) out.push(`duration     ${humanMs(s.duration)}`);
  if (s.cost != null) out.push(`cost         $${s.cost.toFixed(3)}`);
  if (s.tokens.in || s.tokens.out) {
    const k = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    out.push(`tokens       in ${k(s.tokens.in)} · out ${k(s.tokens.out)}`);
  }
  if (s.lines[0] || s.lines[1]) out.push(`lines        +${s.lines[0]} / -${s.lines[1]}`);
  if (s.models.length) out.push(`models       ${s.models.map(([m, n]) => `${m} (${n})`).join(', ')}`);
  if (s.topTools.length) out.push(`top tools    ${s.topTools.map(([t, n]) => `${t} ${n}`).join(' · ')}`);
  out.push('');
  out.push(dim('activity     ') + sparkline(s.activity));
  return out.join('\n');
}
