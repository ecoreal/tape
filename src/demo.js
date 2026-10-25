// A realistic agent debugging session used by `tape demo` — the 10-second path
// to "oh, I get it". Ends with an infra flake so the timeline has drama.
import { writeFileSync } from 'node:fs';

const T0 = Date.parse('2026-10-25T12:04:11Z');

function demoLines() {
  let n = 0;
  const L = (type, text, meta) => ({ ts: new Date(T0 + n++ * 17000).toISOString(), type, text, meta });
  return [
    L('user', 'The login page 500s intermittently in prod. Find and fix it. Auth tests live in tests/auth.test.js.'),
    L('assistant', "I'll reproduce the failure first, then trace the auth path from the login route to the session store."),
    L('tool_use', 'Read src/auth/session.ts', { tool: 'Read' }),
    L('tool_result', `  14 | export async function refreshSession(userId: string) {
  15 |   const row = await db.sessions.get(userId);
  16 |   const next = await issueToken(userId);
  17 |   await db.sessions.put(userId, next);   // ← not awaited anywhere upstream
  18 |   return next;
  19 | }`),
    L('tool_use', 'Read src/auth/login.ts', { tool: 'Read' }),
    L('tool_result', `  31 | router.post('/login', async (req, res) => {
  32 |   const s = await loginOrRefresh(req);
  33 |   res.json({ token: s.token });   // response flushes before session write lands
  34 | });`),
    L('assistant', 'Suspicious: refreshSession resolves the token before the DB write is awaited. If a second refresh lands in the same tick we can get a torn write and the read side 500s. Confirming with the test suite.'),
    L('tool_use', 'Bash npm test -- tests/auth.test.js', { tool: 'Bash' }),
    L('tool_result', `> npm test -- tests/auth.test.js

  ✗ concurrent refresh keeps one session row (2 racing requests)
  ✗ token from refresh is usable on next request
  ✗ login returns 200 under load
  9 passed · 3 failed`, { ok: false }),
    L('assistant', '3 failures, all around concurrent refresh — consistent with the race. Fix: serialize refreshes per user with a small in-flight map (a mutex per key), and await the write before returning.'),
    L('tool_use', 'Edit src/auth/session.ts (+14 -3)', { tool: 'Edit' }),
    L('tool_result', 'Applied edit to src/auth/session.ts. refreshSession now goes through withUserLock(userId, …) and awaits db.sessions.put before issuing the token.', { ok: true }),
    L('tool_use', 'Bash npm test -- tests/auth.test.js', { tool: 'Bash' }),
    L('error', 'fetch failed: ECONNRESET — test DB container (pg-test) died mid-run. 12 tests did not complete.'),
    L('assistant', 'The DB container crashed mid-run — that is an infra flake, not the code under test. Restarting the container and rerunning.'),
    L('tool_use', 'Bash docker restart pg-test && npm test -- tests/auth.test.js', { tool: 'Bash' }),
    L('tool_result', `> npm test -- tests/auth.test.js

  ✓ concurrent refresh keeps one session row
  ✓ token from refresh is usable on next request
  ✓ login returns 200 under load
  12 passed · 0 failed`, { ok: true }),
    L('assistant', 'Root cause: token refresh raced the session write; two concurrent refreshes could tear the row. Fix: per-user lock around refresh. All 12 auth tests green.'),
    L('user', 'nice. add a regression test so this never comes back.'),
    L('tool_use', 'Edit tests/auth.test.js (+31)', { tool: 'Edit' }),
    L('tool_result', 'Added "regression: two concurrent refreshes produce exactly one session row" — spins 2 parallel refresh calls and asserts a single row and matching token.', { ok: true }),
    L('tool_use', 'Bash npm test -- tests/auth.test.js', { tool: 'Bash' }),
    L('tool_result', '13 passed · 0 failed (0.9s)', { ok: true }),
    L('assistant', 'Regression test added and passing: 13/13 green. Summary — cause: race in refreshSession; fix: per-user mutex; proof: new regression test. Done ✅'),
    L('system', 'session ended · 25 steps · 4m 6s · $0.041', {}),
  ];
}

export function demoSession() {
  return demoLines().map(l => JSON.stringify(l)).join('\n') + '\n';
}

export function writeDemo(path) {
  const lines = demoLines();
  writeFileSync(path, demoSession());
  return lines.length;
}
