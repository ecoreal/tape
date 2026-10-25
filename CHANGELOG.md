# Changelog

## Unreleased

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
