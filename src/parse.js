// tape — session parsing. One schema of our own, plus tolerant adapters for
// formats agents already write. Bad lines never crash the player.
import { readFileSync } from 'node:fs';

// Single-width glyphs (no emoji: they break width math in every terminal).
export const TYPES = {
  user: { glyph: 'U', color: '\x1b[36m' },        // cyan
  assistant: { glyph: 'A', color: '\x1b[35m' },   // magenta
  tool_use: { glyph: 'T', color: '\x1b[33m' },    // yellow
  tool_result: { glyph: 'R', color: '\x1b[32m' }, // green
  error: { glyph: '!', color: '\x1b[31m' },       // red
  system: { glyph: 'S', color: '\x1b[90m' },      // gray
};

// Claude Code sessions interleave the conversation with bookkeeping lines
// (mode switches, cost state, attachments…). These are ignored BY DESIGN —
// they are metadata, not data loss, and get their own counter.
const META_TYPES = new Set([
  'mode', 'permission-mode', 'atis-latch', 'file-history-snapshot', 'last-prompt',
  'ai-title', 'api-request-shape', 'api-request', 'api-request-blob', 'cost-state',
  'attachment', 'summary',
]);

export function parseFile(path) {
  return parseLines(readFileSync(path, 'utf8'));
}

export function parseLines(text) {
  const events = [];
  let skipped = 0, meta = 0;
  const stats = { cost: null, durationMs: null, linesAdded: 0, linesRemoved: 0, tokensIn: 0, tokensOut: 0, models: {} };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let raw;
    try { raw = JSON.parse(t); } catch { skipped++; continue; }
    if (raw && typeof raw.type === 'string' && META_TYPES.has(raw.type)) {
      meta++;
      if (raw.type === 'cost-state') {
        if (raw.totalCostUSD != null) stats.cost = raw.totalCostUSD;
        if (raw.totalDuration != null) stats.durationMs = raw.totalDuration;
        stats.linesAdded = raw.totalLinesAdded ?? stats.linesAdded;
        stats.linesRemoved = raw.totalLinesRemoved ?? stats.linesRemoved;
      }
      continue;
    }
    // usage lives on the message envelope, not on content blocks
    if (raw?.message) {
      const u = raw.message.usage;
      if (u) {
        stats.tokensIn += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        stats.tokensOut += u.output_tokens || 0;
      }
      if (raw.message.model) stats.models[raw.message.model] = (stats.models[raw.message.model] || 0) + 1;
    }
    const mapped = normalize(raw);
    if (!mapped.length) skipped++;
    events.push(...mapped);
  }
  return { events: events.map((e, i) => ({ ...e, i })), skipped, meta, stats };
}

function ev(type, text, ts = '', meta = {}) {
  const flat = String(text ?? '').trim();
  const title = flat.split('\n')[0].replace(/\s+/g, ' ').slice(0, 72) || `(${type})`;
  return { ts: String(ts || ''), type, title, text: flat, meta };
}

function safeJson(v, n = 240) {
  try { return JSON.stringify(v).slice(0, n); } catch { return String(v).slice(0, n); }
}

// Returns 0..n events for one parsed JSON line.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return [];

  // 1) tape-native: {ts, type, text, meta}
  if (typeof raw.type === 'string' && TYPES[raw.type] && raw.text != null) {
    return [ev(raw.type, raw.text, raw.ts, raw.meta || {})];
  }

  // 2) Claude Code sessions: {type:'user'|'assistant', timestamp, message:{role, content}}
  const msg = raw.message;
  if (msg && (typeof msg.content === 'string' || Array.isArray(msg.content))) {
    const role = raw.type === 'assistant' || msg.role === 'assistant' ? 'assistant' : 'user';
    const ts = raw.timestamp || '';
    const out = [];
    if (typeof msg.content === 'string') {
      out.push(ev(role, msg.content, ts, msg.model ? { model: msg.model } : {}));
    } else {
      for (const b of msg.content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && b.text) out.push(ev(role, b.text, ts, msg.model ? { model: msg.model } : {}));
        else if (b.type === 'thinking' && b.thinking) out.push(ev(role, b.thinking, ts, { thinking: true }));
        else if (b.type === 'tool_use') out.push(ev('tool_use', `${b.name} ${safeJson(b.input, 200)}`, ts, { tool: b.name, id: b.id }));
        else if (b.type === 'tool_result') {
          const body = typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content) ? b.content.filter(x => x && x.text).map(x => x.text).join('\n') : safeJson(b.content);
          out.push(ev('tool_result', body || '(empty)', ts, { id: b.tool_use_id }));
        }
      }
    }
    if (out.length) return out;
  }

  // 3) generic chat shape: {role, content}
  if (typeof raw.role === 'string' && raw.content != null) {
    const type = raw.role === 'assistant' ? 'assistant' : raw.role === 'tool' ? 'tool_result' : 'user';
    const body = typeof raw.content === 'string' ? raw.content : safeJson(raw.content);
    return [ev(type, body, raw.ts || raw.timestamp || '')];
  }

  // 4) bare error line
  if (raw.type === 'error' || raw.level === 'error') {
    return [ev('error', raw.message || raw.text || raw.error || 'unknown error', raw.ts || '')];
  }

  return [];
}
