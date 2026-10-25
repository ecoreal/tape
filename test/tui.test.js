// Key decoding is the one TUI piece that's pure logic — test every escape
// sequence we claim to support. (The full interactive loop still needs a
// human with a real terminal; this covers the wiring.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeKey } from '../src/tui.js';

test('arrow keys and special keys decode correctly', () => {
  assert.equal(decodeKey(Buffer.from([0x1b, 0x5b, 0x41])), 'up');
  assert.equal(decodeKey(Buffer.from([0x1b, 0x5b, 0x42])), 'down');
  assert.equal(decodeKey(Buffer.from([0x1b, 0x5b, 0x43])), 'right');
  assert.equal(decodeKey(Buffer.from([0x1b, 0x5b, 0x44])), 'left');
  assert.equal(decodeKey(Buffer.from([0x1b])), 'escape');
  assert.equal(decodeKey(Buffer.from([0x0d])), 'enter');
  assert.equal(decodeKey(Buffer.from([0x09])), 'tab');
  assert.equal(decodeKey(Buffer.from([0x7f])), 'backspace');
  assert.equal(decodeKey(Buffer.from([0x03])), 'ctrl-c');
});

test('printable keys lowercase; control bytes are ignored', () => {
  assert.equal(decodeKey(Buffer.from('J')), 'j');
  assert.equal(decodeKey(Buffer.from('?')), '?');
  assert.equal(decodeKey(Buffer.from('/')), '/');
  assert.equal(decodeKey(Buffer.from([0x01])), null);
});
