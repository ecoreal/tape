// `tape adapters` — the registry is one constant (ADAPTERS in src/parse.js)
// that the CLI prints and these tests keep honest: names present in human
// output, stable JSON shape, and every advertised fixture/test path exists on
// disk — including docs/adapter-spec.md itself. The table cannot rot silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, adaptersJson } from '../src/parse.js';
import { main } from '../src/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// run main() with stdout/stderr captured; process.exitCode reset per call
async function capture(argv) {
  const out = [], err = [];
  const origLog = console.log, origError = console.error, origCode = process.exitCode;
  console.log = (...a) => out.push(a.map(String).join(' '));
  console.error = (...a) => err.push(a.map(String).join(' '));
  process.exitCode = 0;
  try {
    await main(argv);
    return { out: out.join('\n'), err: err.join('\n'), code: process.exitCode };
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = origCode;
  }
}

test('tape adapters: human output lists every adapter + points at the spec and #1', async () => {
  const { out, err, code } = await capture(['adapters']);
  assert.equal(err, '');
  assert.equal(code, 0);
  for (const a of ADAPTERS) assert.match(out, new RegExp(`\\b${a.name}\\b`));
  assert.match(out, /built-in/);
  assert.match(out, /docs\/adapter-spec\.md/);   // the community contract
  assert.match(out, /OpenClaw/i);
  assert.match(out, /issues\/1/);                // the OpenClaw ask
  // the table header aligns with the data
  assert.match(out, /name\s+status\s+fixture\s+test/);
});

test('tape adapters --json: one line, array of {name, status, fixture, test}', async () => {
  const { out, err, code } = await capture(['adapters', '--json']);
  assert.equal(err, '');
  assert.equal(code, 0);
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one line of JSON on stdout');
  const j = JSON.parse(lines[0]); // throws (fails the test) on invalid JSON
  assert.deepEqual(j, adaptersJson());
  assert.equal(j.length, ADAPTERS.length);
  for (const entry of j) {
    assert.deepEqual(Object.keys(entry), ['name', 'status', 'fixture', 'test']);
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.fixture, 'string');
  }
});

test('every advertised fixture and test path exists on disk (registry cannot rot)', () => {
  const seen = new Set();
  for (const a of ADAPTERS) {
    assert.ok(!seen.has(a.name), `duplicate adapter name: ${a.name}`);
    seen.add(a.name);
    assert.equal(a.status, 'built-in');
    assert.ok(existsSync(join(root, a.fixture)), `fixture missing: ${a.fixture}`);
    assert.ok(existsSync(join(root, a.test)), `test missing: ${a.test}`);
  }
  assert.ok(ADAPTERS.length >= 3, 'the three built-in adapters must stay registered');
});

test('the spec the CLI points at actually ships in the repo', () => {
  assert.ok(existsSync(join(root, 'docs', 'adapter-spec.md')), 'docs/adapter-spec.md is missing');
});
