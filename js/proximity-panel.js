// Floating "Proximity" panel: find words where two glyphs' OUTLINES are close to (or far from) each other.
//
//  - Glyph 1 and Glyph 2: glyph-name patterns, as in Bulk Apply ('name', '/regexp/', leading '!' inverts).
//  - Three values, each ignored or tested "<" / ">" a number (all tests must hold, AND):
//      nearest distance         shortest outline-to-outline distance
//      X component, Y component the signed offset from Glyph 1's nearest point to Glyph 2's nearest point
//                               (font units, y up); "abs" tests the size instead of the signed value
//  - Glyph 1 is the anchor. "Glyph 2 is" chooses which Glyph 2 it is compared with:
//      first to the right   the first matching glyph after Glyph 1 in the word (the default)
//      first to the left    the first matching glyph before it, looking leftwards
//      nearest              the Glyph 2 with the smallest outline distance ("distance >" then means "nothing within that distance")
//      any                  every Glyph 1 / Glyph 2 pair
//  - Scans the list currently selected in the main window; Replace / Add / Subtract put the matching words in the
//    Pattern List. Click a row to go to that word.
//
// Overlapping or nested outlines have distance 0 and X = Y = 0. Pairs further apart than "search range" count as far
// away: they satisfy "distance >" but cannot satisfy an X or Y test.
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

  const FIELDS = ['g1', 'g2', 'pick', 'dist-op', 'dist-val', 'x-op', 'x-val', 'x-abs', 'y-op', 'y-val', 'y-abs', 'range'];

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
      #proximityPanel .px-glyph { width:210px; }
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
      #proximityPanel .px-hintbox:hover .px-pop, #proximityPanel .px-hintbox:focus-within .px-pop,
      #proximityPanel .px-hintbox.open .px-pop { display:block; }
    `;
    document.head.appendChild(style);
  }

  function valueRow(key, label, hint, withAbs) {
    return `<tr><td>${label}</td>
      <td><select class='px-${key}-op'><option value='ignore'>ignore</option><option value='less'>less than</option><option value='greater'>greater than</option></select></td>
      <td><input type='text' class='px-num px-${key}-val' value='0'></td>
      <td>${withAbs ? `<label title='Test the size, ignoring the sign'><input type='checkbox' class='px-${key}-abs'>abs</label>` : ''}</td>
      <td style='color:#666'>${hint}</td></tr>`;
  }

  function build() {
    css();
    panel = document.createElement('div');
    panel.id = 'proximityPanel';
    panel.innerHTML = `
      <div class='px-head'><span>Glyph proximity</span><button type='button' class='px-close' aria-label='close'>X</button></div>
      <div class='px-body'>
        <table class='px-form'>
          <tr><td>Glyph 1</td><td colspan='3'><input type='text' class='px-glyph px-g1' spellcheck='false' placeholder="name, /regexp/ or !name"></td></tr>
          <tr><td>Glyph 2</td><td colspan='3'><input type='text' class='px-glyph px-g2' spellcheck='false' placeholder="name, /regexp/ or !name"></td></tr>
          <tr><td>Glyph 2 is</td><td colspan='3'><select class='px-pick' title='Which matching Glyph 2 is compared with Glyph 1 (the anchor)'>
            <option value='right'>the first match to the right of Glyph 1</option>
            <option value='left'>the first match to the left of Glyph 1</option>
            <option value='nearest'>the nearest match (by outline distance)</option>
            <option value='any'>any match (every pair)</option></select></td></tr>
          ${valueRow('dist', 'Nearest distance', 'font units', false)}
          ${valueRow('x', 'X component', 'Glyph 2 minus Glyph 1; negative = Glyph 2 is left', true)}
          ${valueRow('y', 'Y component', 'Glyph 2 minus Glyph 1; negative = Glyph 2 is below', true)}
        </table>
        <div class='px-row-actions'>
          <span class='px-hintbox'>Search range <input type='text' class='px-num px-range' value='600' aria-describedby='pxRangeHint'>
            <span class='px-hint' tabindex='0' role='button' aria-label='About the search range'>?</span>
            <span class='px-pop' id='pxRangeHint' role='tooltip'>
              <b>Search range</b> (font units, default 600).<br>
              Only pairs whose outlines are closer than this are measured exactly.<br>
              A pair further apart counts as <i>far</i>: it satisfies <i>Nearest distance &gt;</i> but can never satisfy an X or Y test, because their offsets are not measured.<br>
              A bigger range is slower. If <i>Nearest distance &gt; N</i> is set above the range, the range is stretched to N + 1.</span>
          </span>
        </div>
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
    q('.px-range').addEventListener('input', () => q('.px-hintbox').classList.remove('open'));
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
  // one value test: { op: 'ignore'|'less'|'greater', t: number, abs: bool }
  function readCond(key, withAbs) {
    const op = q(`.px-${key}-op`).value, t = parseFloat(q(`.px-${key}-val`).value);
    if (op !== 'ignore' && isNaN(t)) throw new Error(`The ${key === 'dist' ? 'distance' : key.toUpperCase()} value is not a number.`);
    return { op, t, abs: withAbs && q(`.px-${key}-abs`).checked };
  }
  const passes = (c, v) => {
    if (c.op === 'ignore') return true;
    const x = c.abs ? Math.abs(v) : v;
    return c.op === 'less' ? x < c.t : x > c.t;
  };

  async function scan() {
    let m1, m2, cd, cx, cy;
    try {
      m1 = GlyphQuery.matcher(q('.px-g1').value); m2 = GlyphQuery.matcher(q('.px-g2').value);
      if (!m1 || !m2) throw new Error('Enter a pattern for both Glyph 1 and Glyph 2.');
      cd = readCond('dist', false); cx = readCond('x', true); cy = readCond('y', true);
    } catch (e) { setStatus(String(e.message ?? e), 'err'); return; }
    const pick = q('.px-pick').value;
    let range = parseFloat(q('.px-range').value);
    if (isNaN(range) || range <= 0) range = 600;
    if (cd.op === 'greater') range = Math.max(range, cd.t + 1);       // must look at least as far as the threshold
    const componentTest = cx.op !== 'ignore' || cy.op !== 'ignore';

    // does this pair satisfy every active test? c = GlyphQuery.closest(...) or null (further than the range)
    const ok = (c) => {
      if (!c) return cd.op !== 'less' && !componentTest;               // far away: only "distance >" can hold
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
          let cands;
          if (pick === 'right') cands = g2s.filter(B => B.i > A.i).slice(0, 1);                   // first after A in the word
          else if (pick === 'left') cands = g2s.filter(B => B.i < A.i).slice(-1);                 // first before A, looking left
          else cands = g2s.filter(B => B !== A);
          if (!cands.length) continue;
          let use = cands.map(B => ({ B, c: GlyphQuery.closest(A, B, range) }));
          if (pick === 'nearest') {
            const key = (r) => r.c ? r.c.d : 1e12 + GlyphQuery.boxDistance(A, r.B);               // out of range: nearest box first
            use = [use.reduce((p, r) => key(r) < key(p) ? r : p)];
          }
          for (const { B, c } of use) {
            if (!ok(c)) continue;
            if (!best || (c ? c.d : Infinity) < best.d) {
              best = { d: c ? c.d : Infinity,
                       row: { glyph1: `#${A.i} ${A.name}`, glyph2: `#${B.i} ${B.name}`,
                              distance: c ? Math.round(c.d * 10) / 10 : `>${Math.round(range)}`,
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
