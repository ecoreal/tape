// `tape fork <file> <N>` — branch a session at step N: keep the prefix,
// optionally edit step N in $EDITOR, write a new tape-native file.
// The rest of the original session is dropped; `tape rerun` continues it.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFile } from './parse.js';
import { spawnSync } from 'node:child_process';

export function forkSession(path, keepSteps, { out, editText } = {}) {
  const { events } = parseFile(path);
  if (keepSteps < 1 || keepSteps > events.length) {
    throw new Error(`step must be 1..${events.length}`);
  }
  const prefix = events.slice(0, keepSteps).map(e => ({
    ts: e.ts, type: e.type, text: e.text, meta: e.meta,
  }));
  if (editText != null) {
    const last = prefix[prefix.length - 1];
    if (last.type !== 'user') throw new Error(`step ${keepSteps} is "${last.type}" — forking edits user steps`);
    last.text = editText;
  }
  prefix.push({
    ts: new Date().toISOString(),
    type: 'system',
    text: `forked from ${path} at step ${keepSteps}${editText != null ? ' (edited)' : ''} — continue with: tape rerun <this file>`,
    meta: { fork: true, source: path, at: keepSteps },
  });
  const outFile = out || `${path.replace(/\.jsonl$/i, '')}.fork-${keepSteps}.jsonl`;
  writeFileSync(outFile, prefix.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { out: outFile, kept: keepSteps };
}

// non-interactive-friendly: opens $EDITOR on the step text; returns null on no-op
export function editInEditor(text) {
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (!editor || !process.stdout.isTTY) return null;
  const tmp = `/tmp/tape-fork-${Date.now()}.md`;
  writeFileSync(tmp, text);
  const r = spawnSync(editor, [tmp], { stdio: 'inherit' });
  if (r.status !== 0) return null;
  const edited = readFileSync(tmp, 'utf8').trim();
  return edited && edited !== text.trim() ? edited : null;
}
