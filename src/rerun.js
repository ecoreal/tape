// `tape rerun <file>` — continue a forked/truncated session.
// Providers: "echo" (offline, deterministic — tests & demos) or any
// OpenAI-compatible endpoint via TAPE_API_KEY / TAPE_MODEL / TAPE_BASE_URL.
// A JSONL sidecar (<file>.toolcache.jsonl, see toolcache.js) records every
// tool call the transcript already answered plus each synthetic assistant
// turn, so a second rerun recognizes what the first one saw — the zero-cost
// re-run foundation. Appends are idempotent: same hash, never written twice.
import { readFileSync, appendFileSync } from 'node:fs';
import { parseLines } from './parse.js';
import { cachePathFor, hashFor, hashText, load as loadCache, append as appendCache } from './toolcache.js';

export function echoProvider(history) {
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  const seed = lastUser ? lastUser.text.slice(0, 40).replace(/\s+/g, ' ') : '(silence)';
  return Promise.resolve(`echo: acknowledged "${seed}" — offline provider, set TAPE_API_KEY for a real continuation.`);
}

export async function openaiProvider(history) {
  const key = process.env.TAPE_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no TAPE_API_KEY — use --provider echo');
  const base = (process.env.TAPE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.TAPE_MODEL || 'gpt-4o-mini';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are continuing an agent session transcript. Reply as the assistant would, concisely.' },
        ...history.map(m => ({ role: m.role, content: m.text })),
      ],
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(Number(process.env.TAPE_TIMEOUT_MS) || 15000),
  });
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('provider returned nothing');
  return text;
}

export const PROVIDERS = { echo: echoProvider, openai: openaiProvider };

// The tool_result that answers events[i] (a tool_use): nearest following
// tool_result, preferring a meta.id match, bounded by the next tool_use.
// Real transcripts often carry no block ids — adjacency is the fallback.
export function pairedResult(events, i) {
  const id = events[i]?.meta?.id;
  let fallback = null;
  for (let j = i + 1; j < events.length; j++) {
    const e = events[j];
    if (e.type === 'tool_use') break;
    if (e.type !== 'tool_result') continue;
    if (!id || !e.meta?.id) return e; // no ids to match — adjacency wins
    if (!fallback) fallback = e;
    if (e.meta.id === id) return e;
  }
  return fallback;
}

// History for the provider, cache-aware. The sidecar is snapshotted once per
// turn: a tool_use whose hash is already cached is marked cached and its
// paired tool_result text ships verbatim into the history (falling back to
// the cached output when a fork cut the pair in half); an uncached tool call
// is recorded in the sidecar (seeding) so the NEXT turn or rerun recognizes
// it. user/assistant steps pass through untouched.
function buildHistory(events, cacheFile) {
  const known = new Map(loadCache(cacheFile).map(e => [e.hash, e]));
  const history = [];
  const hitHashes = new Set();
  let seeded = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'user' || e.type === 'assistant') {
      history.push({ role: e.type, text: e.text });
    } else if (e.type === 'tool_use') {
      const hash = hashFor(e);
      const result = pairedResult(events, i);
      if (known.has(hash)) {
        hitHashes.add(hash);
        const text = result ? result.text : known.get(hash).output || '';
        if (text) history.push({ role: 'user', text, cached: true, tool: e.meta?.tool ?? null });
      } else if (appendCache(cacheFile, {
        hash,
        tool: e.meta?.tool ?? null,
        input: e.text,
        output: result ? result.text : '',
      })) {
        seeded++;
      }
    }
  }
  return { history, hitHashes, seeded };
}

export async function rerun(path, { provider = 'echo', turns = 2 } = {}) {
  const fn = PROVIDERS[provider] || openaiProvider;
  const cacheFile = cachePathFor(path);
  let added = 0, toolSeeded = 0, turnEntries = 0;
  const toolHits = new Set();
  for (let t = 0; t < turns; t++) {
    const events = parseLines(readFileSync(path, 'utf8')).events;
    const { history, hitHashes, seeded } = buildHistory(events, cacheFile);
    toolSeeded += seeded;
    for (const h of hitHashes) toolHits.add(h);
    if (!history.length) throw new Error('nothing to rerun from');
    let reply;
    try {
      reply = await fn(history);
    } catch (e) {
      return { added, error: e.message, toolHits: toolHits.size, toolSeeded, turnEntries, cacheFile };
    }
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', text: reply }) + '\n');
    added++;
    // record the synthetic assistant turn, keyed by the prompt that produced
    // it: the same conversation state hashes the same, so re-running an
    // unchanged session never grows the cache
    const prompt = [...history].reverse().find(m => m.role === 'user')?.text ?? '';
    if (appendCache(cacheFile, { hash: hashText(prompt), tool: null, input: prompt, output: reply })) turnEntries++;
  }
  return { added, toolHits: toolHits.size, toolSeeded, turnEntries, cacheFile };
}
