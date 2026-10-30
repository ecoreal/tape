# Changelog

## Unreleased

- 🪶 `tape gif` now writes **delta frames**: everything identical to the previous frame becomes a transparent pixel (graphical-control disposal 1), so the parts of the canvas that never move are free. A real session's film drops from 35.9 KB to 18.8 KB on the claude-code fixture and 286 → 233 KB on the 25-step demo, with a byte-identical composite (asserted in the tests by compositing both encodings the way a viewer does). `--no-diff` restores full frames; frame 0 is always complete because there is nothing on screen yet.

- 🔌 **OpenClaw / pi adapter** (issue #1, ✅) — `AgentSession` JSONL (`{type:'message', message:{role, content:[{type:'text'|'thinking'|'toolCall'}]}}`) now reads natively: roles `user | assistant | toolResult`, `toolCall` → `tool_use` (title = name + JSON arguments), `thinking` → assistant with `meta.thinking`, a `toolResult` with `isError: true` becomes an **`error` step** (a failed tool is data, not noise), and `usage: {input, output, cacheRead, cacheWrite, cost:{total}}` is harvested into stats (tokens in/out + summed cost; `stats` derives the duration from the entry timestamps — the fixture shows `10s`). Session headers, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom` and `label` join `META_TYPES` (counted, never steps), and `type:'message'` lines are never re-read by the claude-code branch, so unknown roles stay *skipped* instead of being guessed into `user`. Fixture + two golden tests; `tape adapters` now lists four formats.

- 🎞 `tape gif <file> [--out film.gif]` — the session as an animated GIF, written by a hand-rolled GIF89a/LZW encoder (`src/gif.js`, ~90 lines) and a hand-drawn 5×7 bitmap font (`src/font.js`): no dependencies, no font files, no network. Each frame reveals one more step, highlights it in its type's colour, and the ribbon at the bottom shows the whole session's shape; `--rows`, `--frames`, `--width`, `--scale`, `--delay` control the film. Deterministic — same events in, byte-identical GIF out. 77 tests (7 GIF container/LZW round-trips through an independent decoder, 12 film/font).
- 🧪 `test/gif.test.js` decodes our own output with a spec-side decoder: round-trip pixels, power-of-two palette, per-frame delays, NETSCAPE loop, the 4096-code dictionary-overflow path, and a 900×400 frame (sub-block chunking).

- ✨ `tape adapters` + docs/adapter-spec.md — the community contract for session-format adapters is now a real doc: the unified Step model (`{ts, type, title, text, meta}` + type enum), the claude-code mapping table (content blocks → steps, usage/cost-state harvesting), tolerance rules (bad JSON counted, never fatal; META_TYPES and how to extend it; unknown shapes skipped+counted), a copy-paste golden-test recipe, and a worked fictional example. `tape adapters` (`--json` too) prints every built-in adapter with its fixture and golden-test paths, generated from one `ADAPTERS` constant in src/parse.js; tests assert every advertised path exists on disk, so the registry can't rot. Unblocks #1 (OpenClaw).
- 🧪 tape-native golden fixture (`fixtures/tape-native/basic.jsonl`) + adapters-registry tests: 53 → 58 tests
- ✨ in-TUI diff — open a fork (`<file>.fork-N.jsonl`) and press `d` for a dedicated diff view against its source session: divergence step (the fork marker), source vs current titles at the split, identical-prefix / differing counts. `d` toggles back to the timeline with the selection restored; on a non-fork it hints `not a fork — open a .fork-*.jsonl file`. Help overlay (`?`) gains the `d` key.
- ✨ `--json` for every reporting command — `tape stats|diff|grep|cache <…> --json` emit stable single-line JSON on stdout for scripts and CI: stats mirrors `buildStats` (nulls where the transcript has no data), diff mirrors `diffSummary`, grep is an array of `{path, mtime, title, hits, steps}` (mtime ISO), cache mirrors the sidecar report (`entries`, `bytes`, `hitCapable`, `sessionToolUses`). Human output is unchanged without the flag; invalid input still fails with one clean line on stderr and exit code 1 in both modes (diff's unreadable files no longer dump a stack trace).
- ✨ `tape rerun` tool-result caching — the zero-cost re-run foundation. Reruns keep a JSONL sidecar next to the session (`<file>.toolcache.jsonl`): every tool call the transcript already answered is recorded with its original `tool_result` verbatim, and each synthetic assistant turn is recorded keyed by the hash of its prompt. Cached tool calls are recognized on the next rerun and their `tool_result` ships verbatim into the provider history. Appends are idempotent — the same hash is never written twice — and corrupt sidecar lines are skipped, never fatal.
- ✨ `tape cache <file>` — sidecar stats at a glance: entries · size · hit-capable hashes on one line, plus the full entry table.
- 🧪 toolcache round-trip / idempotence / corruption tests + rerun↔cache integration: 26 → 35 tests

## 0.1.1 (2026-10-25)

- ✨ `tape` with no args opens a session picker for `~/.claude/projects`
- ✨ `tape stats` — cost / tokens / duration / models / top tools + activity sparkline, all harvested from data the JSONL already contains
- 🔍 `tape diff a b` — first-divergence view between two sessions
- 🛡 session metadata lines (cost-state, attachments, …) counted separately from parse failures; api-request-blob payloads no longer masquerade as turns
- 🐛 coalesced keystrokes (paste / fast typing) no longer drop input in the TUI
- 🐛 `--frame` validates its number; unreadable paths and directories fail with a message, not a stack trace
- 🧪 golden-fixture tests for claude-code + generic formats; key-decoder unit tests; 20 tests

## 0.1.0

- initial release: timeline TUI, adapters (tape-native / claude-code / generic), search, headless `--frame` rendering, zero runtime dependencies
