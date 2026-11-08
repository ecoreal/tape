# Contributing to tape

Small, sharp tool — same rules apply. Thanks for helping!

## Development setup

```bash
git clone https://github.com/ecoreal/tape && cd tape
npm test          # node:test, offline
```

Node ≥ 18.17, **zero dependencies** — stdlib only. If a feature needs a
package, it belongs in a separate project.

## Modules

parse.js (4 session formats) · render.js/gif.js (film) · picker.js/tui.js (keys & alt-screen) · grep/fork/diff

## Ground rules

- **Platform-agnostic or bust.** CI runs Windows runners; no unix-only paths in tests (use `mkdtempSync`), no code that assumes a TTY.
- **Key decoding** (`decodeKeys`) is pure logic — every escape sequence we claim gets a test case.
- **Formats:** adapters for claude-code / tape-native / generic / OpenClaw must round-trip their fixtures.

## Commit style

Short, imperative, emoji-prefixed to match the house style:
`✨ features · 🐛 fixes · 📝 docs · 🔧 CI/build`.

## Filing issues

Include: the exact command, `--json` output where applicable (redact anything
private), Node version, and what you expected vs got.
