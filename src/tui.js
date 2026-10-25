// Minimal terminal runtime — the only place we touch the tty.
// Alt-screen, raw mode, key decoding. ~60 lines, no dependencies.
export async function run(app) {
  const out = process.stdout;
  if (!out.isTTY || !process.stdin.isTTY) {
    // headless: print one frame so scripts, CI and `--frame` still work
    console.log(app.frame(out.columns || 80, 24).join('\n'));
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    out.write('\x1b[?25h\x1b[?1049l');
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', onData);
    resolve();
  };

  let resolve;
  const promise = new Promise(r => (resolve = r));

  function draw() {
    const lines = app.frame(out.columns || 80, out.rows || 24);
    out.write('\x1b[H' + lines.map(l => '\x1b[K' + l).join('\n') + '\x1b[J');
  }

  function onData(chunk) {
    for (const key of decodeKeys(chunk)) {
      if (key === 'ctrl-c' || key === 'q') return finish();
      app.key(key);
      if (app.isDone()) return finish();
    }
    draw();
  }

  process.stdin.on('data', onData);
  process.on('exit', () => {
    if (!done) out.write('\x1b[?25h\x1b[?1049l');
  });
  draw();
  return promise;
}

// Terminals coalesce fast typing (and tmux/expect tools batch keystrokes):
// one stdin chunk can carry MANY keys. Scan the whole buffer, in order.
export function decodeKeys(b) {
  const out = [];
  for (let i = 0; i < b.length;) {
    if (b[i] === 27) {
      if (b[i + 1] === 91) {
        const c = b[i + 2];
        if (c === 65) { out.push('up'); i += 3; continue; }
        if (c === 66) { out.push('down'); i += 3; continue; }
        if (c === 67) { out.push('right'); i += 3; continue; }
        if (c === 68) { out.push('left'); i += 3; continue; }
        if (c === 53) { out.push('pgup'); i += 4; continue; } // \x1b[5~
        if (c === 54) { out.push('pgdn'); i += 4; continue; } // \x1b[6~
      }
      out.push('escape'); i += 1; continue; // lone ESC
    }
    if (b[i] === 13) { out.push('enter'); i += 1; continue; }
    if (b[i] === 9) { out.push('tab'); i += 1; continue; }
    if (b[i] === 127 || b[i] === 8) { out.push('backspace'); i += 1; continue; }
    if (b[i] === 3) { out.push('ctrl-c'); i += 1; continue; }
    if (b[i] < 32) { i += 1; continue; }
    // full UTF-8 code point, lowercased for keybinding purposes
    let len = 1;
    if (b[i] >= 0xf0) len = 4; else if (b[i] >= 0xe0) len = 3; else if (b[i] >= 0xc0) len = 2;
    out.push(b.subarray(i, i + len).toString('utf8').toLowerCase());
    i += len;
  }
  return out;
}

export function decodeKey(b) {
  return decodeKeys(b)[0] ?? null;
}
