// `tape rerun <file>` — continue a forked/truncated session.
// Providers: "echo" (offline, deterministic — tests & demos) or any
// OpenAI-compatible endpoint via TAPE_API_KEY / TAPE_MODEL / TAPE_BASE_URL.
import { readFileSync, appendFileSync } from 'node:fs';
import { parseLines } from './parse.js';

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

export async function rerun(path, { provider = 'echo', turns = 2 } = {}) {
  const fn = PROVIDERS[provider] || openaiProvider;
  let { events } = parseLines(readFileSync(path, 'utf8'));
  let added = 0;
  for (let t = 0; t < turns; t++) {
    events = parseLines(readFileSync(path, 'utf8')).events;
    const history = events
      .filter(e => e.type === 'user' || e.type === 'assistant')
      .map(e => ({ role: e.type, text: e.text }));
    if (!history.length) throw new Error('nothing to rerun from');
    let reply;
    try {
      reply = await fn(history);
    } catch (e) {
      return { added, error: e.message };
    }
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', text: reply }) + '\n');
    added++;
  }
  return { added };
}
