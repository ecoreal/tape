# Adapter spec — adding a session format to tape

tape reads the JSONL that AI agents already write. Every format funnels into one
unified **Step model**; everything downstream (timeline, search, stats, diff,
fork) works only in terms of that model. The contract, short on purpose: an
adapter is one `normalize()` branch, one fixture, one golden test — ~20 lines.

## 1. The unified Step model

`normalize(raw)` in [src/parse.js](../src/parse.js) maps one parsed JSON object
to **0..n** steps of shape `{ ts, type, title, text, meta }`:

| field | contract |
|---|---|
| `ts` | ISO-ish string, copied verbatim (`''` when the format has no time). Never reformatted. |
| `type` | one of the enum below. Never a new string. |
| `title` | first line of `text`, whitespace-flattened, capped at 72 chars. Timeline label. |
| `text` | the full text, trimmed. This is what `/` search finds and what `fork` edits. |
| `meta` | free-form object: `{tool, id}` on tool steps, `{model}` on text steps, `{thinking: true}`, … |

The `type` enum (glyphs + colors live in `TYPES` in src/parse.js):

| type | glyph | means |
|---|---|---|
| `user` | U | human turn |
| `assistant` | A | model prose (thinking is an assistant step with `meta.thinking: true`) |
| `tool_use` | T | a tool call; `title` leads with the tool name |
| `tool_result` | R | the tool's output |
| `error` | ! | anything that failed |
| `system` | S | framework chatter worth showing |

Do not invent new types. A novel line is either one of these (often `system`),
bookkeeping (→ META_TYPES below), or skipped. That discipline is what keeps
filters, diffs and renders portable across every format.

## 2. Reference mapping: claude-code

Claude Code writes `{type:'user'|'assistant', timestamp, message:{role, content, model?, usage?}}` where `content` is a string **or** an array of typed blocks — one line can map to several steps:

| input | → steps |
|---|---|
| `message.content` is a string | one step of the envelope role, `ts = timestamp`, `meta.model` when present |
| block `{type:'text', text}` | step of the envelope role (`user` or `assistant`) |
| block `{type:'thinking', thinking}` | `assistant` step with `meta.thinking: true` |
| block `{type:'tool_use', id, name, input}` | `tool_use` step; title `"<name> <json input>"`; `meta: {tool: name, id}` |
| block `{type:'tool_result', tool_use_id, content}` | `tool_result` step; `meta: {id: tool_use_id}`; string content verbatim, `[{text}]` arrays joined with `\n`, other shapes JSON-snippeted |
| envelope `message.usage` | **not a step** — harvested: `tokensIn += input_tokens + cache_read_input_tokens`, `tokensOut += output_tokens` |
| envelope `message.model` | counted in `stats.models` and stamped on text steps |
| `timestamp` | → `ts`, verbatim |
| top-level `{type:'cost-state', totalCostUSD, totalDuration, totalLinesAdded, totalLinesRemoved}` | bookkeeping — harvested into `stats` (last value wins); never a step |
| role | envelope rule: `type === 'assistant' \|\| message.role === 'assistant'` wins, else `user` |

Golden truth for this table: `fixtures/claude-code/basic.jsonl` +
`test/fixtures.test.js`.

## 3. Tolerance rules (non-negotiable)

Real transcripts are messy; the parser never throws on content.

1. A line that is not valid JSON is **counted** (`skipped`) and skipped — never fatal.
2. A line whose `type` is in `META_TYPES` is **counted** (`meta`) and dropped —
   bookkeeping, not data loss. Current set:
   `mode, permission-mode, atis-latch, file-history-snapshot, last-prompt,
   ai-title, api-request-shape, api-request, api-request-blob, cost-state,
   attachment, summary`.
   **To extend it**: add the string to `META_TYPES` in src/parse.js, add a line in
   your fixture, and assert the `meta` count in your golden test. Harvesting side
   effects (cost-state feeding `stats`) is the sanctioned exception.
3. A parsed line matching no adapter branch (unknown shape) maps to 0 steps and
   is **counted as skipped**. Never guess, never fabricate, never crash.
4. Nothing inside a recognized line may throw either: cap embedded JSON
   (`safeJson`, 240 chars) and join text arrays instead of trusting shapes.

## 4. Adding an adapter — the recipe

1. **Fixture**: save 5–15 representative (redacted) lines as
   `fixtures/<name>/basic.jsonl`. Include the messy bits on purpose: a
   metadata line, a usage envelope, a multi-block message. One adapter = one
   directory.
2. **Branch**: add a numbered branch to `normalize()` in src/parse.js, ordered
   **before** the generic `{role, content}` fallback (most specific first).
   Return `[]` for shapes you do not handle — they are counted, not fatal.
3. **Golden test** in `test/fixtures.test.js` — copy, paste, adjust:

   ```js
   test('<name> fixture maps to the golden event sequence', () => {
     const { events, skipped, meta } = parseFile(join(root, 'fixtures', '<name>', 'basic.jsonl'));
     assert.equal(skipped, 0);   // raise this if your fixture has garbage lines
     assert.equal(meta, 0);      // raise this if your fixture has metadata lines
     assert.deepEqual(events.map(e => e.type), ['user', 'assistant']);
     assert.equal(events[0].text, 'the exact first line');
   });
   ```

   If an adapter change moves these numbers, that change is a breaking format
   change — think twice (the same warning guards the top of the file).
4. **Register**: append
   `{ name, status: 'built-in', fixture: 'fixtures/<name>/basic.jsonl', test: 'test/fixtures.test.js' }`
   to `ADAPTERS` in src/parse.js. `tape adapters` (and its tests) pick it up
   from there; a test asserts every listed path exists, so the registry cannot
   rot.
5. **Announce**: one CHANGELOG bullet under `## Unreleased`; update the formats
   line in the README and `tape --help`.

**Breaking** (needs a golden-test update and a CHANGELOG note): renaming Step
fields, changing the `type` enum, changing how an existing format maps (any
golden event sequence or count), changing `--json` output keys.
**Not breaking**: adding an adapter, adding a META_TYPE, tolerating more
shapes, harvesting more stats fields.

## 5. Worked mini-example: a fictional `glowlog` format

`fixtures/glowlog/basic.jsonl`:

```jsonl
{"v":1,"kind":"say","who":"human","msg":"why is the build red","wall":"2026-10-26T09:00:00Z"}
{"v":1,"kind":"say","who":"bot","msg":"checking the runner log","wall":"2026-10-26T09:00:02Z"}
{"v":1,"kind":"run","cmd":"npm test","wall":"2026-10-26T09:00:03Z"}
{"v":1,"kind":"out","text":"3 failing","wall":"2026-10-26T09:00:09Z"}
{"v":1,"kind":"tick","wall":"2026-10-26T09:00:10Z"}
```

The adapter branch (ordered before the generic `{role, content}` fallback):

```js
// 2.x) glowlog: {v:1, kind, who|msg|cmd|text, wall}
if (raw.v === 1 && typeof raw.kind === 'string') {
  const type = { say: raw.who === 'bot' ? 'assistant' : 'user', run: 'tool_use', out: 'tool_result' }[raw.kind];
  if (!type) return [];                                   // unknown kind → skipped+counted
  const text = raw.msg ?? raw.cmd ?? raw.text ?? '';
  return [ev(type, text, raw.wall, type === 'tool_use' ? { tool: raw.cmd } : {})];
}
```

Expected mapping:

| line | step |
|---|---|
| 1 | `user` — ts `2026-10-26T09:00:00Z`, text `why is the build red` |
| 2 | `assistant` — text `checking the runner log` |
| 3 | `tool_use` — title `npm test`, `meta.tool: 'npm test'` |
| 4 | `tool_result` — text `3 failing` |
| 5 | no step — `kind: 'tick'` is unknown → `skipped: 1` |

The golden test asserts types `[user, assistant, tool_use, tool_result]` and `skipped === 1`. That is the whole adapter — ship it.

## 6. Open asks

- **OpenClaw session format** — [#1](https://github.com/ecoreal/tape/issues/1). Grab it:
  three redacted lines from a real session are enough to start a PR.
