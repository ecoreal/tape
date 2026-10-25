# Changelog

## Unreleased

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
