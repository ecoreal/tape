// toolcache — the zero-cost re-run foundation. A JSONL sidecar sitting next to
// a session file (`<file>.toolcache.jsonl`) recording what each step produced:
// tool calls → the tool_result the transcript already captured, and rerun's
// synthetic assistant turns. Identical inputs hash identically, so a later
// rerun recognizes what an earlier one saw instead of paying for it again.
// Same durability contract as session parsing: corrupt lines are skipped and
// counted as absent, never fatal.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, statSync } from 'node:fs';

export function cachePathFor(file) {
  return `${file}.toolcache.jsonl`;
}

const hex16 = s => createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 16);

// General hasher: deterministic 16-hex digest of any text. This keys the
// synthetic assistant turns rerun records (prompt → reply).
export function hashText(text) {
  return hex16(text);
}

// 16-hex digest of a step's text — but only tool_use steps are cache-keyed;
// anything else hashes the empty string (a stable "not cacheable" sentinel).
export function hashFor(step) {
  return hex16(step?.type === 'tool_use' ? step.text : '');
}

// Every valid entry in the sidecar, oldest first. A missing file is an empty
// cache; a corrupt line is skipped, not fatal.
export function load(path) {
  const entries = [];
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return entries; } // no cache yet
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e === 'object' && typeof e.hash === 'string' && e.hash) entries.push(e);
    } catch { /* torn mid-write or hand-mangled — skip the line, keep the cache */ }
  }
  return entries;
}

// Idempotent by hash: the same hash is never written twice. Returns true when
// a line was appended, false when the hash was already cached (or unusable).
export function append(path, entry) {
  if (!entry || typeof entry.hash !== 'string' || !entry.hash) return false;
  if (lookup(path, entry.hash)) return false;
  const line = JSON.stringify({
    hash: entry.hash,
    tool: entry.tool ?? null,
    input: entry.input ?? '',
    output: entry.output ?? '',
    ts: entry.ts || new Date().toISOString(),
  });
  appendFileSync(path, line + '\n');
  return true;
}

export function lookup(path, hash) {
  if (!hash) return null;
  return load(path).find(e => e.hash === hash) || null;
}

const humanSize = n => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const flat = s => String(s ?? '').replace(/\s+/g, ' ');
const when = ts => (ts ? String(ts).slice(0, 16).replace('T', ' ') : '—');

// Cache health for one session: how much of it a rerun would recognize.
// hitCapable counts the session's tool_use steps whose hash is already in the
// sidecar — those are marked cached and served verbatim on the next rerun.
export function cacheReport(parsed, file) {
  const cacheFile = cachePathFor(file);
  const entries = load(cacheFile);
  let size = 0;
  try { size = statSync(cacheFile).size; } catch { size = 0; }
  const known = new Set(entries.map(e => e.hash));
  const toolUses = parsed.events.filter(e => e.type === 'tool_use');
  const hitCapable = new Set(toolUses.map(e => hashFor(e)).filter(h => known.has(h)));
  return { cacheFile, entries, size, toolUses: toolUses.length, hitCapable: hitCapable.size };
}

export function renderCacheReport(r) {
  const out = [];
  out.push(`⏪ tape — cache  ${r.cacheFile}`);
  out.push('');
  out.push(`${r.entries.length} ${r.entries.length === 1 ? 'entry' : 'entries'} · ${humanSize(r.size)} · `
    + `${r.hitCapable} hit-capable hash${r.hitCapable === 1 ? '' : 'es'} `
    + `(${r.hitCapable}/${r.toolUses} tool_use in session)`);
  if (!r.entries.length) {
    out.push('');
    out.push(`(no cache yet — \`tape rerun <file>\` records tool calls and turns as it continues)`);
    return out.join('\n');
  }
  out.push('');
  out.push('hash              tool         input                               output                              when');
  for (const e of r.entries) {
    out.push([
      cut(String(e.hash || ''), 16).padEnd(16),
      cut(e.tool == null ? '(assistant)' : String(e.tool), 11).padEnd(11),
      cut(flat(e.input), 34).padEnd(34),
      cut(flat(e.output), 36).padEnd(36),
      when(e.ts),
    ].join('  '));
  }
  return out.join('\n');
}
