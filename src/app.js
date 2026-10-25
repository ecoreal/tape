// App state + keybindings. Rendering is pure (render.js); this only mutates state.
import { renderFrame, match } from './render.js';

export function createApp({ events, file, skipped, meta }) {
  const st = {
    events, file, skipped, meta,
    sel: events.length ? 0 : 0,
    scroll: 0,
    mode: 'normal', // normal | search | help
    query: '',
    done: false,
    w: 80, h: 24,
  };

  function findNext() {
    const n = st.events.length;
    if (!n || !st.query) return;
    for (let k = 1; k <= n; k++) {
      const i = (st.sel + k) % n;
      if (match(st.events[i], st.query)) { st.sel = i; st.scroll = 0; return; }
    }
  }

  return {
    frame(w, h) { st.w = w; st.h = h; return renderFrame(st); },
    isDone: () => st.done,
    key(k) {
      if (st.mode === 'help') {
        if (k === '?' || k === 'escape' || k === 'enter') st.mode = 'normal';
        return;
      }
      if (st.mode === 'search') {
        if (k === 'escape') { st.mode = 'normal'; st.query = ''; }
        else if (k === 'enter') { st.mode = 'normal'; findNext(); }
        else if (k === 'backspace') st.query = st.query.slice(0, -1);
        else if (k.length === 1) st.query += k;
        return;
      }
      const n = st.events.length;
      switch (k) {
        case 'up': if (st.sel > 0) { st.sel--; st.scroll = 0; } break;
        case 'down': if (st.sel < n - 1) { st.sel++; st.scroll = 0; } break;
        case 'j': if (st.sel < n - 1) { st.sel++; st.scroll = 0; } break;
        case 'k': if (st.sel > 0) { st.sel--; st.scroll = 0; } break;
        case 'J': st.scroll = Math.min(st.scroll + 5, 1e6); break;
        case 'K': st.scroll = Math.max(0, st.scroll - 5); break;
        case 'g': st.sel = 0; st.scroll = 0; break;
        case 'G': st.sel = Math.max(0, n - 1); st.scroll = 0; break;
        case '/': st.mode = 'search'; st.query = ''; break;
        case '?': st.mode = 'help'; break;
        case 'escape': st.done = true; break;
      }
    },
  };
}
