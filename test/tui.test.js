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

test('windows terminal keys: delete / home / end / pgup / pgdn', () => {
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x33, 0x7e])), ['delete']); // \x1b[3~
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x48])), ['home']);         // \x1b[H
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x46])), ['end']);          // \x1b[F
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x35, 0x7e])), ['pgup']);   // \x1b[5~
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x36, 0x7e])), ['pgdn']);   // \x1b[6~
  // long-form home/end variants some WT/ssh setups send
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x31, 0x7e])), ['home']);   // \x1b[1~
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x34, 0x7e])), ['end']);    // \x1b[4~
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x37, 0x7e])), ['home']);   // \x1b[7~
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x38, 0x7e])), ['end']);    // \x1b[8~
});

test('windows terminal: unknown CSI blobs are swallowed, never leak chars', () => {
  // mouse report \x1b[<0;13;42M would previously decode as escape + "[<0;13;42M"
  const mouse = Buffer.concat([Buffer.from('j'), Buffer.from([0x1b, 0x5b, 0x3c, 0x30, 0x3b, 0x31, 0x33, 0x3b, 0x34, 0x32, 0x4d]), Buffer.from('k')]);
  assert.deepEqual(decodeKeys(mouse), ['j', 'k']);
  // focus event \x1b[I and bracketed paste end \x1b[201~ vanish too
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x49])), []);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e])), []);
});

test('ss3 arrows (PuTTY/ssh-to-Windows style) decode like CSI arrows', () => {
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x4f, 0x41])), ['up']);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x4f, 0x42])), ['down']);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x4f, 0x43])), ['right']);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x4f, 0x44])), ['left']);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x4f, 0x48])), ['home']);
});

test('truncated CSI at a chunk edge is swallowed, never leaked as keys', () => {
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b])), []);
  assert.deepEqual(decodeKeys(Buffer.from([0x1b, 0x5b, 0x33])), []); // cut mid-\x1b[3~
  // a genuinely lone ESC still reads as escape
  assert.deepEqual(decodeKeys(Buffer.from([0x1b])), ['escape']);
});
