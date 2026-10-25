// Key decoding is the one TUI piece that's pure logic — test every escape
// sequence we claim to support, including coalesced multi-key chunks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeKeys } from '../src/tui.js';

test('arrow keys and special keys decode correctly', () => {
  assert.equal(decodeKeys(Buffer.from([0x1b, 0x5b, 0x41]))[0], 'up');
  assert.equal(decodeKeys(Buffer.from([0x1b, 0x5b, 0x42]))[0], 'down');
  assert.equal(decodeKeys(Buffer.from([0x1b, 0x5b, 0x43]))[0], 'right');
  assert.equal(decodeKeys(Buffer.from([0x1b, 0x5b, 0x44]))[0], 'left');
  assert.equal(decodeKeys(Buffer.from([0x1b]))[0], 'escape');
  assert.equal(decodeKeys(Buffer.from([0x0d]))[0], 'enter');
  assert.equal(decodeKeys(Buffer.from([0x09]))[0], 'tab');
  assert.equal(decodeKeys(Buffer.from([0x7f]))[0], 'backspace');
  assert.equal(decodeKeys(Buffer.from([0x03]))[0], 'ctrl-c');
});

test('printable keys pass through with case; control bytes are ignored', () => {
  assert.equal(decodeKeys(Buffer.from('j'))[0], 'j');
  assert.equal(decodeKeys(Buffer.from('G'))[0], 'G'); // case matters: g=first, G=last
  assert.equal(decodeKeys(Buffer.from('?'))[0], '?');
  assert.equal(decodeKeys(Buffer.from([0x01])).length, 0);
});

test('coalesced keystrokes decode in order (fast typing / paste)', () => {
  // tmux and real terminals can deliver "/docker\r" as ONE chunk
  assert.deepEqual(decodeKeys(Buffer.from('/docker\r')), ['/', 'd', 'o', 'c', 'k', 'e', 'r', 'enter']);
  assert.deepEqual(decodeKeys(Buffer.from('jjq')), ['j', 'j', 'q']);
  // escape sequences mixed inline with printable keys
  assert.deepEqual(
    decodeKeys(Buffer.concat([Buffer.from('j'), Buffer.from([0x1b, 0x5b, 0x42]), Buffer.from('k')])),
    ['j', 'down', 'k'],
  );
  // multi-byte utf8 does not split
  assert.deepEqual(decodeKeys(Buffer.from('中')), ['中']);
});
