# Changelog

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
