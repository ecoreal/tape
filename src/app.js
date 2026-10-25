// App state + keybindings. Rendering is pure (render.js); this only mutates state.
import { renderFrame, match } from './render.js';
import { parseFile } from './parse.js';
import { forkSession } from './fork.js';
import { diffSummary } from './diff.js';

export function createApp({ events, file, skipped, meta, follow, filter }) {
  const st = {
    events, file, skipped, meta, follow, filter: filter || null,
    view: events,           // filtered view (same array object when unfiltered)
    viewMap: events.map((_, i) => i), // view index -> real index
    sel: events.length ? 0 : 0,
    scroll: 0,
    mode: 'normal', // normal | search | help
    query: '',
    note: null,     // transient status hint (e.g. "forked → file")
    done: false,
    diffMode: null,       // {source, at, summary, aTitles} while the diff view is open
    _forkInfo: undefined, // lazily detected fork marker; null = checked, not a fork
    _preDiffSel: 0,       // selection to restore when the diff view closes
    w: 80, h: 24,
  };
  applyFilter(st, filter);

  // --follow: reload the file; if the user was at the tail, ride the tail
  const reload = follow ? (() => {
    let lastLen = events.length;
    return () => {
      try {
        const { events: fresh } = parseFile(st.file);
        if (fresh.length !== lastLen) {
          const wasAtTail = st.sel >= st.view.length - 1;
          st.events = fresh;
          applyFilter(st, st.filter);
          if (wasAtTail) st.sel = st.view.length - 1;
          st.sel = Math.max(0, Math.min(st.sel, st.view.length - 1));
          lastLen = fresh.length;
        }
      } catch { /* mid-write read — next tick will retry */ }
    };
  })() : null;

  return {
    frame(w, h) { st.w = w; st.h = h; return renderFrame(st); },
    isDone: () => st.done,
    state: () => st, // read-only-ish peek for tests and debugging
    tick: reload,
    key(k) {
      if (st.note) st.note = null;
      if (st.diffMode) {
        // the diff view is read-only: d (or escape) goes back, q / ctrl-c quit
        if (k === 'd' || k === 'escape') exitDiff(st);
        return;
      }
      if (st.mode === 'help') {
        if (k === '?' || k === 'escape' || k === 'enter') st.mode = 'normal';
        return;
      }
      if (st.mode === 'search') {
        if (k === 'escape') { st.mode = 'normal'; st.query = ''; }
        else if (k === 'enter') { st.mode = 'normal'; findNext(st); }
        else if (k === 'backspace') st.query = st.query.slice(0, -1);
        else if (k.length === 1) st.query += k;
        return;
      }
      const n = st.view.length;
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
        case 'f': doFork(st); break;
        case 'd': doDiff(st); break;
        case 'escape': st.done = true; break;
      }
    },
  };
}

function applyFilter(st, filter) {
  if (!filter) {
    st.view = st.events;
    st.viewMap = st.events.map((_, i) => i);
    return;
  }
  st.view = [];
  st.viewMap = [];
  st.events.forEach((e, i) => {
    if (e.type === filter) { st.view.push(e); st.viewMap.push(i); }
  });
}

function findNext(st) {
  const n = st.view.length;
  if (!n || !st.query) return;
  for (let k = 1; k <= n; k++) {
    const i = (st.sel + k) % n;
    if (match(st.view[i], st.query)) { st.sel = i; st.scroll = 0; return; }
  }
}

// `f` — fork at the selected step, in place: writes <file>.fork-<n>.jsonl
// and keeps the TUI alive with a status note.
function doFork(st) {
  const real = st.viewMap[st.sel];
  try {
    const { out } = forkSession(st.file, real + 1, {});
    st.note = `🌿 forked at step ${real + 1} → ${out}`;
  } catch (e) {
    st.note = `fork failed: ${e.message}`;
  }
}

// Fork-ness, detected lazily and cached: the open session is a fork when its
// trailing event carries the marker forkSession writes. null = checked, no.
function forkInfo(st) {
  if (st._forkInfo !== undefined) return st._forkInfo;
  let info = null;
  try {
    const { events } = parseFile(st.file);
    const last = events[events.length - 1];
    const fk = last?.meta?.fork;
    if (fk) {
      const m = typeof fk === 'object' ? fk : last.meta; // {fork:{source,at}} or {fork:true, source, at}
      info = { source: m.source, at: m.at ?? null };
    }
  } catch { /* unreadable file — treat as not a fork */ }
  st._forkInfo = info;
  return info;
}

// `d` — toggle the diff view against the session this fork split from.
function doDiff(st) {
  const info = forkInfo(st);
  if (!info || !info.source) {
    st.note = 'not a fork — open a .fork-*.jsonl file';
    return;
  }
  let src;
  try {
    src = parseFile(info.source).events;
  } catch (e) {
    st.note = `diff failed: cannot read ${info.source} (${e.code || e.message})`;
    return;
  }
  const summary = diffSummary(src, st.events);
  // source titles mapped to the common prefix plus the diverging step, so the
  // view can show both sides at the split (aTitles[divergence] = source title)
  const span = summary.identicalPrefix + (summary.divergence != null ? 1 : 0);
  const aTitles = src.slice(0, span).map(e => e.title);
  st._preDiffSel = st.sel;
  st.scroll = 0;
  st.diffMode = { source: info.source, at: info.at, summary, aTitles };
}

function exitDiff(st) {
  st.diffMode = null;
  st.sel = st._preDiffSel ?? 0;
  st.scroll = 0;
}
