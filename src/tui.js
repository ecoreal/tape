// Minimal terminal runtime — the only place we touch the tty.
// Alt-screen, raw mode, key decoding. ~60 lines, no dependencies.
export async function run(app) {
  const out = process.stdout;
  if (!out.isTTY || !process.stdin.isTTY) {
    // headless: print one frame so scripts, CI and `--frame` still work
    console.log(app.frame(out.columns || 80, 24).join('\n'));
    return;
  }
  let timer = null;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
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
  if (typeof app.tick === 'function') {
    timer = setInterval(() => { app.tick(); if (!done) draw(); }, 600);
  }
  process.on('exit', () => {
    if (!done) out.write('\x1b[?25h\x1b[?1049l');
  });
  draw();
  return promise;
}

// Terminals coalesce fast typing (and tmux/expect tools batch keystrokes):
// one stdin chunk can carry MANY keys. Scan the whole buffer, in order.
// CSI sequences are parsed properly (params 0x30–0x3F, intermediates 0x20–0x2F,
// final 0x40–0x7E) so Windows Terminal's Delete/Home/End — and anything we
// don't map, like mouse reports — never leak garbage chars into the TUI.
const CSI_FINAL_KEYS = { 65: 'up', 66: 'down', 67: 'right', 68: 'left', 72: 'home', 70: 'end' };
const CSI_TILDE_KEYS = { 49: 'home', 51: 'delete', 52: 'end', 53: 'pgup', 54: 'pgdn', 55: 'home', 56: 'end' };

export function decodeKeys(b) {
  const out = [];
  for (let i = 0; i < b.length;) {
    if (b[i] === 27) {
      const csi = b[i + 1] === 91; // [
      const ss3 = b[i + 1] === 79; // O — old-style arrows (PuTTY/ssh consoles)
      if (csi || ss3) {
        let j = i + 2;
        if (ss3) {
          const f = j < b.length ? b[j] : -1;
          if (f >= 0x40 && f <= 0x7e) {
            if (CSI_FINAL_KEYS[f]) out.push(CSI_FINAL_KEYS[f]);
            i = j + 1; continue;
          }
          out.push('escape'); i += 1; continue;
        }
        while (j < b.length && ((b[j] >= 0x30 && b[j] <= 0x3f) || (b[j] >= 0x20 && b[j] <= 0x2f))) j++;
        const final = j < b.length ? b[j] : -1;
        if (final >= 0x40 && final <= 0x7e) {
          const p1 = b[i + 2];
          if (CSI_FINAL_KEYS[final]) out.push(CSI_FINAL_KEYS[final]);
          else if (final === 126 && CSI_TILDE_KEYS[p1]) out.push(CSI_TILDE_KEYS[p1]);
          // unknown CSI (mouse reports, focus events, win32-input-mode…) is
          // swallowed whole: one blob, zero stray chars
          i = j + 1; continue;
        }
        // truncated CSI at the chunk edge — swallow what we saw (the rest of
        // the sequence arrives in the next chunk); never leak params as keys
        i = j; continue;
      }
      out.push('escape'); i += 1; continue; // lone ESC
    }
    if (b[i] === 13) { out.push('enter'); i += 1; continue; }
    if (b[i] === 9) { out.push('tab'); i += 1; continue; }
    if (b[i] === 127 || b[i] === 8) { out.push('backspace'); i += 1; continue; }
    if (b[i] === 3) { out.push('ctrl-c'); i += 1; continue; }
    if (b[i] < 32) { i += 1; continue; }
    // full UTF-8 code point, case preserved (g/G and search input care)
    let len = 1;
    if (b[i] >= 0xf0) len = 4; else if (b[i] >= 0xe0) len = 3; else if (b[i] >= 0xc0) len = 2;
    out.push(b.subarray(i, i + len).toString('utf8'));
    i += len;
  }
  return out;
}

export function decodeKey(b) {
  return decodeKeys(b)[0] ?? null;
}
