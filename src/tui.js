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
    const key = decodeKey(chunk);
    if (!key) return;
    if (key === 'ctrl-c' || key === 'q') return finish();
    app.key(key);
    if (app.isDone()) return finish();
    draw();
  }

  process.stdin.on('data', onData);
  process.on('exit', () => {
    if (!done) out.write('\x1b[?25h\x1b[?1049l');
  });
  draw();
  return promise;
}

export function decodeKey(b) {
  if (b[0] === 27) {
    if (b.length === 1) return 'escape';
    if (b[1] === 91) {
      switch (b[2]) {
        case 65: return 'up'; case 66: return 'down';
        case 67: return 'right'; case 68: return 'left';
        case 53: return 'pgup'; case 54: return 'pgdn';
      }
    }
    return null;
  }
  if (b[0] === 13) return 'enter';
  if (b[0] === 9) return 'tab';
  if (b[0] === 127 || b[0] === 8) return 'backspace';
  if (b[0] === 3) return 'ctrl-c';
  if (b[0] < 32) return null;
  return b.toString('utf8').toLowerCase();
}
