// Floating "Proximity" panel: find words where two glyphs' OUTLINES are close to (or far from) each other.
//
//  - Glyph 1 and Glyph 2: glyph-name patterns, as in Bulk Apply ('name', '/regexp/', leading '!' inverts).
//    A blank Glyph 1 or Glyph 2 means any glyph.
//  - Three values, each a "from" .. "to" range (blank = no limit on that side, both blank = ignored; all ranges must hold, AND):
//      nearest distance         shortest outline-to-outline distance. Its "to" (default 600) is also the SEARCH RANGE: pairs
//                               further apart than that are not measured and cannot match; leave it blank for no upper limit
//      X component, Y component the signed offset from Glyph 1's nearest point to Glyph 2's nearest point
//                               (font units, y up); "abs" tests the size instead of the signed value
//  - Glyph 1 is the anchor. "Glyph 2 is" chooses which Glyph 2 it is compared with:
//      first to the right   the first matching glyph after Glyph 1 in the word (the default)
//      first to the left    the first matching glyph before it, looking leftwards
//      nearest              the Glyph 2 with the smallest outline distance
//      any                  every Glyph 1 / Glyph 2 pair
//  - Only glyphs in DIFFERENT cursive runs are compared (a mark counts as part of the run of the base it is attached to),
//    so "first to the right" skips Glyph 2 glyphs that are joined to Glyph 1.
//  - Scans the list currently selected in the main window; Replace / Add / Subtract put the matching words in the
//    Pattern List. Click a row to go to that word.
//
// Overlapping or nested outlines have distance 0 and X = Y = 0. With no distance "to", a pair further apart than the
// search range still satisfies the distance test but cannot satisfy an X or Y range (their offsets are not measured).
//
// Relies on globals from index.html: wordList, setPatternList, refreshSVG, breadCrumbAdd, progressPanel, and
// GlyphQuery (js/glyph-query.js).
'use strict';

const ProximityPanel = (() => {
  const LS_KEY = 'gposeProximityPanel';
  const SHOW_ROWS = 500;
  let panel = null;
  const state = { hits: [], words: [], listName: '' };
  const q = (sel) => panel.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const FIELDS = ['g1', 'g2', 'pick', 'dist-from', 'dist-to', 'x-from', 'x-to', 'x-abs', 'y-from', 'y-to', 'y-abs'];
  const DEFAULT_RANGE = 600;     // search range when the distance "to" is blank

  function css() {
    const style = document.createElement('style');
    style.textContent = `
      #proximityPanel { position:fixed; top:90px; left:120px; width:640px; height:560px; min-width:420px; min-height:300px;
        z-index:1000; display:none; flex-direction:column; background:#fff; border:1px solid #888;
        box-shadow:0 4px 16px rgba(0,0,0,.35); resize:both; overflow:hidden; font-size:13px; }
      #proximityPanel .px-head { background:#456; color:#fff; padding:4px 8px; cursor:move; user-select:none;
        display:flex; justify-content:space-between; align-items:center; }
      #proximityPanel .px-body { flex:1; overflow:auto; padding:6px 8px; display:flex; flex-direction:column; gap:6px; }
      #proximityPanel table.px-form td { padding:2px 4px; }
      #proximityPanel input[type=text] { font-family:monospace; }
      #proximityPanel .px-glyph { width:290px; }
      #proximityPanel .px-num { width:60px; }
      #proximityPanel .px-status { font-size:12px; color:#444; }
      #proximityPanel .px-status.err { color:#c00; }
      #proximityPanel .px-results { flex:1; min-height:80px; overflow:auto; border:1px solid #ccc; }
      #proximityPanel table.px-res { border-collapse:collapse; width:100%; font-size:12px; }
      #proximityPanel table.px-res th { position:sticky; top:0; background:#eef; text-align:left; padding:2px 6px; }
      #proximityPanel table.px-res td { padding:1px 6px; border-top:1px solid #eee; white-space:nowrap; }
      #proximityPanel table.px-res tr.px-row { cursor:pointer; }
      #proximityPanel table.px-res tr.px-row:hover { background:#def; }
      #proximityPanel .px-row-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      #proximityPanel .px-hintbox { position:relative; display:inline-flex; align-items:center; gap:4px; }
      #proximityPanel .px-hint { display:inline-block; width:16px; height:16px; line-height:16px; text-align:center; border-radius:50%;
        background:#789; color:#fff; font-size:11px; font-weight:bold; cursor:help; user-select:none; }
      #proximityPanel .px-pop { display:none; position:absolute; left:0; top:100%; margin-top:6px; width:330px; z-index:10;
        background:#ffd; border:1px solid #886; padding:6px 9px; box-shadow:0 2px 8px rgba(0,0,0,.3);
        font-size:12px; line-height:1.4; font-family:sans-serif; font-weight:normal; color:#222; white-space:normal; }
      #proximityPanel table.px-form .px-pop { left:-150px; }
      #proximityPanel table.px-form th { text-align:left; font-weight:normal; color:#666; font-size:11px; padding:0 4px; }
      #proximityPanel .px-hintbox:hover .px-pop, #proximityPanel .px-hintbox:focus-within .px-pop,
      #proximityPanel .px-hintbox.open .px-pop { display:block; }
    `;
    document.head.appendChild(style);
  }

  // one range row: from / to boxes (blank = no limit), an optional abs tick and a hint. `extra` goes after the "to" box.
  function valueRow(key, label, hint, withAbs, toDefault, extra = '') {
    return `<tr><td>${label}</td>
      <td><input type='text' class='px-num px-${key}-from' value='' placeholder='from' aria-label='${label} from'></td>
      <td><span class='${extra ? 'px-hintbox' : ''}'><input type='text' class='px-num px-${key}-to' value='${toDefault}' placeholder='to' aria-label='${label} to'>${extra}</span></td>
      <td>${withAbs ? `<label title='Test the size, ignoring the sign'><input type='checkbox' class='px-${key}-abs'>abs</label>` : ''}</td>
      <td style='color:#666'>${hint}</td></tr>`;
  }
  const RANGE_HINT = `<span class='px-hint' tabindex='0' role='button' aria-label='About the distance range'>?</span>
    <span class='px-pop' id='pxRangeHint' role='tooltip'>
      <b>Nearest distance</b> (font units). Blank = no limit on that side.<br>
      The <b>to</b> value (default 600) is also the <b>search range</b>: only pairs whose outlines are that close are measured, so a smaller value is faster and a pair further apart never matches.<br>
      Clear <b>to</b> to allow any distance: a pair further apart than 600 (or than <b>from</b>) still passes the distance test, but cannot pass an X or Y range because its offsets are not measured.</span>`;

  function build() {
    css();
    panel = document.createElement('div');
    panel.id = 'proximityPanel';
    panel.innerHTML = `
      <div class='px-head'><span>Glyph proximity</span><button type='button' class='px-close' aria-label='close'>X</button></div>
      <div class='px-body'>
        <table class='px-form'>
          <tr><td>Glyph 1</td><td colspan='3'><input type='text' class='px-glyph px-g1' spellcheck='false' placeholder="blank = any glyph; or name, /regexp/, !name"></td></tr>
          <tr><td>Glyph 2</td><td colspan='3'><input type='text' class='px-glyph px-g2' spellcheck='false' placeholder="blank = any glyph; or name, /regexp/, !name"></td></tr>
          <tr><td>Glyph 2 is</td><td colspan='3'><select class='px-pick' title='Which matching Glyph 2 is compared with Glyph 1 (the anchor)'>
            <option value='right'>the first match to the right of Glyph 1</option>
            <option value='left'>the first match to the left of Glyph 1</option>
            <option value='nearest'>the nearest match (by outline distance)</option>
            <option value='any'>any match (every pair)</option></select></td></tr>
          <tr><th></th><th>from</th><th>to</th><th></th><th></th></tr>
          ${valueRow('dist', 'Nearest distance', 'font units; "to" is the search range', false, DEFAULT_RANGE, RANGE_HINT)}
          ${valueRow('x', 'X component', 'Glyph 2 minus Glyph 1; negative = Glyph 2 is left', true, '')}
          ${valueRow('y', 'Y component', 'Glyph 2 minus Glyph 1; negative = Glyph 2 is below', true, '')}
        </table>
        <div class='px-row-actions'>
          <button type='button' class='px-scan' style='background-color:#afa;'>Scan</button>
          <span class='px-list'></span>
        </div>
        <div class='px-status'></div>
        <div class='px-results'></div>
        <div class='px-row-actions'>Pattern List:
          <button type='button' class='px-pl' data-mode='replace' disabled>Replace</button>
          <button type='button' class='px-pl' data-mode='merge' disabled>Add</button>
          <button type='button' class='px-pl' data-mode='subtract' disabled>Subtract</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    q('.px-close').onclick = hide;
    q('.px-scan').onclick = scan;
    q('.px-hint').addEventListener('click', (e) => { e.currentTarget.parentElement.classList.toggle('open'); });   // touch / keyboard
    q('.px-hint').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } });
    q('.px-dist-to').addEventListener('input', () => q('.px-hintbox').classList.remove('open'));
    q('.px-dist-to').setAttribute('aria-describedby', 'pxRangeHint');
    panel.querySelectorAll('.px-pl').forEach(b => { b.onclick = () => toPatternList(b.dataset.mode); });
    q('.px-results').addEventListener('click', (e) => {
      const tr = e.target.closest('tr.px-row');
      if (tr) jumpTo(Number(tr.dataset.wi));
    });
    panel.addEventListener('input', saveForm);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[type=text]')) scan(); });
    loadForm();
    makeDraggable(panel, q('.px-head'));
  }

  function makeDraggable(elm, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = elm.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      const move = (m) => {
        elm.style.left = Math.max(0, Math.min(window.innerWidth - 60, m.clientX - dx)) + 'px';
        elm.style.top  = Math.max(0, Math.min(window.innerHeight - 30, m.clientY - dy)) + 'px';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ---- remembering the form (a per-browser convenience only) ----------------------------------------------
  function saveForm() {
    try {
      const o = {};
      for (const f of FIELDS) { const el = q('.px-' + f); o[f] = el.type === 'checkbox' ? el.checked : el.value; }
      window.localStorage.setItem(LS_KEY, JSON.stringify(o));
    } catch (e) { /* storage unavailable */ }
  }
  function loadForm() {
    try {
      const o = JSON.parse(window.localStorage.getItem(LS_KEY) ?? 'null');
      if (!o) return;
      for (const f of FIELDS) { const el = q('.px-' + f); if (el && f in o) { if (el.type === 'checkbox') el.checked = !!o[f]; else el.value = o[f]; } }
    } catch (e) { /* ignore */ }
  }

  function setStatus(msg, cls = '') {
    const el = q('.px-status');
    el.textContent = msg;
    el.className = 'px-status ' + cls;
  }

  // ---- the scan ---------------------------------------------------------------------------------------
  // one range test: { from, to (null = no limit), abs }
  const NAMES = { dist: 'distance', x: 'X', y: 'Y' };
  function readRange(key, withAbs) {
    const num = (cls) => {
      const t = q(`.px-${key}-${cls}`).value.trim();
      if (t === '') return null;
      const n = Number(t);
      if (isNaN(n)) throw new Error(`The ${NAMES[key]} "${cls}" value is not a number.`);
      return n;
    };
    const r = { from: num('from'), to: num('to'), abs: withAbs && q(`.px-${key}-abs`).checked };
    if (r.from !== null && r.to !== null && r.from > r.to) throw new Error(`The ${NAMES[key]} "from" is larger than its "to".`);
    return r;
  }
  const active = (c) => c.from !== null || c.to !== null;
  const passes = (c, v) => {
    const x = c.abs ? Math.abs(v) : v;
    return (c.from === null || x >= c.from) && (c.to === null || x <= c.to);
  };
  // the cursive run a glyph belongs to: a mark takes the run of the base it is attached to
  const runOf = (g) => (g.mark && g.rootBase) ? g.rootBase.run : g.run;

  async function scan() {
    let m1, m2, cd, cx, cy;
    try {
      m1 = GlyphQuery.matcher(q('.px-g1').value) ?? (() => true);     // blank = any glyph
      m2 = GlyphQuery.matcher(q('.px-g2').value) ?? (() => true);
      cd = readRange('dist', false); cx = readRange('x', true); cy = readRange('y', true);
    } catch (e) { setStatus(String(e.message ?? e), 'err'); return; }
    const pick = q('.px-pick').value;
    // the distance "to" is the search range; with no "to", look at least as far as the default and the "from"
    const range = cd.to !== null ? cd.to : Math.max(DEFAULT_RANGE, (cd.from ?? 0) + 1);
    const limit = cd.to !== null ? cd.to + 0.001 : range;             // "to" itself is inside the range
    const componentTest = active(cx) || active(cy);

    // does this pair satisfy every active range? c = GlyphQuery.closest(...) or null (further than the search range)
    const ok = (c) => {
      if (!c) return cd.to === null && !componentTest;                // far away: only an open-ended distance can hold
      return passes(cd, c.d) && passes(cx, c.dx) && passes(cy, c.dy);
    };

    const listKey = GlyphQuery.activeListKey();
    setStatus('Scanning...');
    const res = await GlyphQuery.scan({
      title: 'Proximity', list: listKey, apply: false, quiet: true,
      test: (w) => {
        const g1s = w.glyphs.filter(g => g.outline && m1(g.name));
        if (!g1s.length) return null;
        const g2s = w.glyphs.filter(g => g.outline && m2(g.name));
        if (!g2s.length) return null;
        let best = null;
        for (const A of g1s) {
          // the Glyph 2 glyphs this Glyph 1 is compared with
          const runA = runOf(A);
          const others = g2s.filter(B => B !== A && runOf(B) !== runA);                          // only glyphs in other cursive runs
          let cands;
          if (pick === 'right') cands = others.filter(B => B.i > A.i).slice(0, 1);                // first after A in the word
          else if (pick === 'left') cands = others.filter(B => B.i < A.i).slice(-1);              // first before A, looking left
          else cands = others;
          if (!cands.length) continue;
          let use = cands.map(B => ({ B, c: GlyphQuery.closest(A, B, limit) }));
          if (pick === 'nearest') {
            const key = (r) => r.c ? r.c.d : 1e12 + GlyphQuery.boxDistance(A, r.B);               // out of range: nearest box first
            use = [use.reduce((p, r) => key(r) < key(p) ? r : p)];
          }
          for (const { B, c } of use) {
            if (!ok(c)) continue;
            if (!best || (c ? c.d : Infinity) < best.d) {
              best = { d: c ? c.d : Infinity,
                       row: { glyph1: `#${A.i} ${A.name}`, glyph2: `#${B.i} ${B.name}`,
                              distance: c ? Math.round(c.d * 10) / 10 : `>${Math.round(limit)}`,
                              x: c ? Math.round(c.dx) : '-', y: c ? Math.round(c.dy) : '-',
                              note: c && c.nested ? 'inside' : (c && c.d === 0 ? 'overlap' : '') } };
            }
          }
        }
        return best ? best.row : null;
      },
    });
    state.hits = res.hits;
    state.words = res.words;
    state.listName = listKey;
    render(res);
  }

  function render(res) {
    const shown = state.hits.slice(0, SHOW_ROWS);
    q('.px-results').innerHTML = `<table class='px-res'><tr><th>#</th><th>Word</th><th>Glyph 1</th><th>Glyph 2</th><th>Distance</th><th>X</th><th>Y</th><th></th></tr>`
      + shown.map(h => `<tr class='px-row' data-wi='${h.index - 1}'><td>${h.index}</td><td>${esc(h.word)}</td><td>${esc(h.glyph1)}</td><td>${esc(h.glyph2)}</td>`
        + `<td>${esc(h.distance)}</td><td>${esc(h.x)}</td><td>${esc(h.y)}</td><td>${esc(h.note)}</td></tr>`).join('')
      + '</table>';
    setStatus(`${state.hits.length} words match in the ${state.listName} list (${res.searched} searched, ${res.ms} ms)`
      + (state.hits.length > SHOW_ROWS ? `; showing the first ${SHOW_ROWS}` : '') + '.');
    panel.querySelectorAll('.px-pl').forEach(b => { b.disabled = !state.words.length; });
  }

  function toPatternList(mode) {
    if (!state.words.length) return;
    setPatternList(state.words, mode);
    setStatus(`${mode === 'subtract' ? 'Removed' : mode === 'merge' ? 'Added' : 'Replaced with'} ${state.words.length} words (Pattern List now ${wordList.filtered.pattern.length}).`);
  }

  function jumpTo(wi) {
    if (wi === wordList.getCurrentIndex()) return;
    breadCrumbAdd(wordList.getCurrentIndex(true));         // so "back" is one click away
    refreshSVG(null, wi + 1, true);
    try { window.localStorage.setItem('index', wi + 1); } catch (e) { /* ignore */ }
  }

  function updateListLabel() {
    const key = GlyphQuery.activeListKey();
    q('.px-list').textContent = `List: ${key} (${GlyphQuery.listIndices(key).length} words)`;
  }

  function show() {
    if (!panel) build();
    panel.style.display = 'flex';
    updateListLabel();
  }
  function hide() { if (panel) panel.style.display = 'none'; }
  function toggle() { if (panel && panel.style.display === 'flex') hide(); else show(); }

  return { show, hide, toggle };
})();
