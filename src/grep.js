// `tape grep <query>` — which of this machine's sessions mentioned X?
import { scanSessions } from './picker.js';
import { parseFile } from './parse.js';
import { match } from './render.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function grepSessions(query, root = join(homedir(), '.claude', 'projects'), limit = 20) {
  const hits = [];
  for (const s of scanSessions(root)) {
    let parsed;
    try { parsed = parseFile(s.path); } catch { continue; }
    const found = parsed.events.filter(e => match(e, query));
    if (found.length) {
      hits.push({
        path: s.path,
        mtime: s.mtime,
        title: s.title || s.path.split('/').pop(),
        hits: found.length,
        first: found[0],
        steps: parsed.events.length,
      });
    }
    if (hits.length >= limit) break;
  }
  return hits;
}
