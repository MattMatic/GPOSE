// Floating "Placement scatter" panel: shows how one glyph (or a family of glyphs, via /regexp/) is
// placed across the words of the active list, grouped by context, so outliers stand out and can be
// sent to the Pattern List.
//
//  - Pick a target glyph and optional context glyphs (-3..+3, in glyph-array order).
//  - Each metric (dy, dx, ax, absolute dy, dy relative to the base) gets its own strip chart:
//    X = context group (e.g. the preceding base's family), Y = the value. One bubble per distinct
//    value, sized by word count, coloured by the worst traffic-light rating inside it.
//  - Click / Ctrl-click / Shift+drag a rectangle to select bubbles; double-click a bubble to jump to a word.
//  - Shift+wheel zooms, drag pans (as the main SVG), double-click on empty space resets the zoom.
//  - Selected words go to the Pattern List (replace / add / subtract), or a Bulk Apply pattern is
//    generated from the selection and its collateral matches previewed.
//
// Relies on globals from index.html: wordList, setPatternList, patternMatchShow, patternMatchFind,
// patternMatchExtract, inpPattern, txtMinMatch, txtMaxGap, inpPatternChanged, breadCrumbAdd,
// refreshSVG, radClass* (the active list), FORCEFIELD_QUALITY is not needed (ratings are 0..4).
'use strict';

const PlacementPanel = (() => {
  const SLOTS = [-3, -2, -1, 1, 2, 3];
  const Q_COLOURS = ['#7c7', '#dd5', '#f93', '#f44', '#c3c'];
  const Q_NAMES = ['OK', 'Maybe', 'Kerning', 'Near', 'Collision'];
  const FORM_RE = /^[A-Z]+([imfu])(?=\d|\.|$)/;   // Gulzar naming: LETTER + form + variant (BEi15)
  const NS = 'http://www.w3.org/2000/svg';
  const LISTS = [['all', 'All'], ['collision', 'Collision'], ['near', 'Near'], ['kerning', 'Kerning'],
                 ['maybe', 'Maybe'], ['pattern', 'Pattern'], ['edited', 'Edited']];

  const METRICS = {
    dy:    { label: 'dy',         get: o => o.dy },
    dx:    { label: 'dx',         get: o => o.dx },
    ax:    { label: 'ax',         get: o => o.ax },
    absDy: { label: 'abs dy',     get: o => o.absDy },
    relDy: { label: 'dy vs base', get: o => o.relDy },
  };

  // ---- small helpers ------------------------------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const fam = (n) => (n === undefined ? '^' : n.replace(/\d+$/, ''));
  const form = (n) => (n === undefined ? '.' : (FORM_RE.exec(n)?.[1] ?? '-'));
  const num = (x) => (typeof x === 'number' && !isNaN(x) ? x : 0);

  // '' -> null (any glyph); '/re/' -> regexp; 'name' -> exact; leading '!' inverts
  function compileMatcher(text) {
    text = (text ?? '').trim();
    if (!text) return null;
    let invert = false;
    if (text[0] === '!') { invert = true; text = text.slice(1); }
    let test;
    if (text.length > 2 && text[0] === '/' && text.endsWith('/')) {
      const re = new RegExp(text.slice(1, -1), 'u');
      test = (n) => re.test(n);
    } else {
      test = (n) => n === text;
    }
    return invert ? (n) => !test(n) : test;
  }

  // "BEi15" -> "/^BEi\d+$/" (names without a trailing number stay exact)
  function familyText(name) {
    const f = fam(name);
    return f === name ? name : `/^${escRe(f)}\\d+$/`;
  }

  // Round a height to the nearest multiple of `size` (no -0)
  const tierOf = (h, size) => {
    const sz = size > 0 ? size : 100;
    const t = Math.round(h / sz) * sz;
    return t === 0 ? 0 : t;
  };

  const GROUPS = {
    none:    { label: 'None',                 key: () => '(all)' },
    l1fam:   { label: 'Previous glyph family', key: o => fam(o.nb[-1]), slots: { '-1': 'fam' } },
    l1:      { label: 'Previous glyph',       key: o => o.nb[-1] ?? '^', slots: { '-1': 'exact' } },
    l2:      { label: '2 before',             key: o => o.nb[-2] ?? '^', slots: { '-2': 'exact' } },
    r1fam:   { label: 'Next glyph family',    key: o => fam(o.nb[1]), slots: { '1': 'fam' } },
    r1:      { label: 'Next glyph',           key: o => o.nb[1] ?? '$', slots: { '1': 'exact' } },
    l1l2fam: { label: 'Two previous families', key: o => `${fam(o.nb[-2])} ${fam(o.nb[-1])}`, slots: { '-2': 'fam', '-1': 'fam' } },
    baseh:   { label: 'Base height (abs dy of the base)', numeric: true, nopattern: true, key: o => String(o.baseDy) },
    baset:   { label: 'Base height tier', numeric: true, nopattern: true, key: (o, opts) => String(tierOf(o.baseDy, opts.tier)) },
    forms:   { label: 'Forms around (i m f)', key: o => `${[-3, -2, -1].map(s => form(o.nb[s])).join('')}|${[1, 2, 3].map(s => form(o.nb[s])).join('')}` },
  };

  // ---- data (pure; tested with stubs) -------------------------------------------------------

  /**
   * Match context tokens outward from `start` (dir -1 = leftwards, +1 = rightwards), nearest token first.
   * A null token is a wildcard. Consecutive tokens may be separated by up to `gap` skipped glyphs
   * (the Bulk Apply "Max Gap" meaning). Returns the matched glyph indices, or null.
   */
  function matchChain(names, start, dir, tokens, gap) {
    const res = [];
    const rec = (pos, k) => {
      if (k === tokens.length) return true;
      for (let d = 0; d <= gap; d++) {
        const j = pos + dir * (1 + d);
        if (j < 0 || j >= names.length) break;
        const t = tokens[k];
        if (t && !t(names[j])) continue;
        res.push(j);
        if (rec(j, k + 1)) return true;
        res.pop();
      }
      return false;
    };
    return rec(start, 0) ? res : null;
  }

  // Slots -1,-2,-3 (or +1,+2,+3) as a nearest-first token list, up to the farthest filled slot
  function chainTokens(spec, sign) {
    let far = 0;
    for (let k = 1; k <= 3; k++) if (spec.slots[sign * k]) far = k;
    const out = [];
    for (let k = 1; k <= far; k++) out.push(spec.slots[sign * k] ?? null);
    return out;
  }

  /**
   * One record per occurrence of the target glyph (matching the context slots) in the given words.
   * spec: { target: fn, slots: { [-3..3]: fn|null }, gap: number (glyphs allowed between context tokens) }
   * In each record `nb[s]` is the glyph matched for slot s (the plain neighbour when the slot is not
   * part of the context chain).
   */
  function collect(wl, indices, spec) {
    const gap = Math.max(0, spec.gap | 0);
    const leftTokens = chainTokens(spec, -1), rightTokens = chainTokens(spec, 1);
    const hbs = wl.hbs;
    const nameCache = new Map();
    const nameOf = (gid) => {
      let n = nameCache.get(gid);
      if (n === undefined) { n = hbs.getGlyphName(gid); nameCache.set(gid, n); }
      return n;
    };
    const occs = [];
    for (const wi of indices) {
      const we = wl.get(wi);
      const hb = we?.hb;
      if (!hb) continue;
      const n = hb.length;
      const names = new Array(n);
      for (let i = 0; i < n; i++) names[i] = nameOf(hb[i].g);
      const marks = hb.attachments?.marks?.marks;
      for (let gi = 0; gi < n; gi++) {
        if (!spec.target(names[gi])) continue;
        const left = leftTokens.length ? matchChain(names, gi, -1, leftTokens, gap) : [];
        if (!left) continue;
        const right = rightTokens.length ? matchChain(names, gi, 1, rightTokens, gap) : [];
        if (!right) continue;
        const d = we.delta?.[gi] ?? {};
        const h = hb[gi];
        const dx = num(d.dx), dy = num(d.dy), ax = num(d.ax);
        const absDy = num(h.dy) + dy;
        let baseAbsDy = 0;
        const pair = marks?.find(e => e[0] === gi);
        if (pair) baseAbsDy = num(hb[pair[1]]?.dy) + num(we.delta?.[pair[1]]?.dy);
        const nb = {};
        for (let s = -3; s <= 3; s++) nb[s] = names[gi + s];
        left.forEach((j, k) => { nb[-(k + 1)] = names[j]; });
        right.forEach((j, k) => { nb[k + 1] = names[j]; });
        occs.push({
          key: `${wi}:${gi}`, wi, gi, name: names[gi], nb,
          dx, dy, ax, absDy, relDy: absDy - baseAbsDy,
          baseDy: pair ? baseAbsDy : absDy,   // a glyph that is not a mark is its own base
          absDx: num(h.dx) + dx,
          set: { dx: typeof d.dx === 'number', dy: typeof d.dy === 'number', ax: typeof d.ax === 'number' },
          q: we.getQuality?.() ?? 0,
        });
      }
    }
    return occs;
  }

  /** Group the occurrences, order the groups, and make one bubble per (group, value) per metric. */
  function buildCharts(occs, metricKeys, groupKey, sortKey, opts = {}) {
    const o2 = { tier: 100, outlierShare: 0.15, ...opts };
    const gk = GROUPS[groupKey].key;
    const numeric = !!GROUPS[groupKey].numeric;
    const cats = new Map();
    for (const o of occs) {
      const c = gk(o, o2);
      let a = cats.get(c);
      if (!a) cats.set(c, a = []);
      a.push(o);
    }
    const m0 = METRICS[metricKeys[0]].get;
    const median = (arr) => {
      const v = arr.map(m0).sort((a, b) => a - b);
      const n = v.length;
      return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    };
    // Share of a column that is NOT on its most common value (first metric), and how many that is
    const offMode = (arr) => {
      const counts = new Map();
      for (const o of arr) { const v = m0(o); counts.set(v, (counts.get(v) ?? 0) + 1); }
      const top = Math.max(...counts.values());
      return { off: arr.length - top, share: (arr.length - top) / arr.length };
    };
    const order = [...cats.keys()];
    const colOff = new Map(order.map(c => [c, offMode(cats.get(c))]));
    if (sortKey === 'name') order.sort(numeric ? (a, b) => Number(a) - Number(b) : undefined);
    else if (sortKey === 'outlier') {
      order.sort((a, b) => colOff.get(b).share - colOff.get(a).share || colOff.get(b).off - colOff.get(a).off
                           || cats.get(b).length - cats.get(a).length || (a < b ? -1 : 1));
    } else if (sortKey === 'count') order.sort((a, b) => cats.get(b).length - cats.get(a).length || (a < b ? -1 : 1));
    else {
      const med = new Map(order.map(c => [c, median(cats.get(c))]));
      order.sort((a, b) => med.get(a) - med.get(b) || cats.get(b).length - cats.get(a).length || (a < b ? -1 : 1));
    }
    const charts = metricKeys.map(mk => {
      const get = METRICS[mk].get;
      const bubbles = [];
      order.forEach((c, ci) => {
        const byVal = new Map();
        for (const o of cats.get(c)) {
          const v = get(o);
          let b = byVal.get(v);
          if (!b) byVal.set(v, b = { metric: mk, cat: c, ci, value: v, occs: [] });
          b.occs.push(o);
        }
        const colN = cats.get(c).length;
        for (const b of byVal.values()) {
          b.words = new Set(b.occs.map(o => o.wi));
          b.q = b.occs.reduce((m, o) => Math.max(m, o.q), 0);
          b.colN = colN;
          b.share = b.occs.length / colN;
          b.minor = colN >= 5 && b.share <= o2.outlierShare;   // a few occurrences against a populated column
          bubbles.push(b);
        }
      });
      return { metric: mk, bubbles };
    });
    return { order, cats, charts, colOff };
  }

  /**
   * Bulk Apply pattern reproducing the selection. ctx: { texts: {[-3..3]: string}, group, shared }
   * Returns { text, tokens, notes[] }.
   */
  function buildPattern(sel, metricKeys, ctx) {
    const notes = [];
    const slotToken = (s) => {
      const filt = (ctx.texts[s] ?? '').trim();
      if (filt) return filt;
      let mode = GROUPS[ctx.group]?.slots?.[s];
      if (!mode && ctx.shared) mode = 'exact';
      if (!mode) return null;
      const names = new Set();
      for (const o of sel) {
        const n = o.nb[s];
        if (n === undefined) return null;
        names.add(n);
      }
      if (mode === 'exact') {
        if (names.size === 1) return [...names][0];
        if (ctx.group !== 'none' && GROUPS[ctx.group]?.slots?.[s] && names.size <= 8) {
          return `/^(?:${[...names].map(escRe).join('|')})$/`;
        }
        return null;
      }
      const bodies = new Set([...names].map(n => (fam(n) === n ? escRe(n) : `${escRe(fam(n))}\\d+`)));
      if (bodies.size === 1) return familyText([...names][0]);
      if (bodies.size <= 8) return `/^(?:${[...bodies].join('|')})$/`;
      notes.push(`Too many different families at ${s > 0 ? '+' : ''}${s}; left as a wildcard.`);
      return null;
    };

    const slotTokens = {};
    for (const s of SLOTS) slotTokens[s] = slotToken(s);
    const used = SLOTS.filter(s => slotTokens[s]);
    const lo = Math.min(0, ...used), hi = Math.max(0, ...used);

    const clauses = [];
    const single = (get) => {
      const vals = new Set(sel.map(get));
      return vals.size === 1 ? [...vals][0] : undefined;
    };
    const plain = (field) => {
      if (!metricKeys.includes(field)) return;
      const v = single(o => o[field]);
      if (v === undefined) { notes.push(`${field}: several different values are selected, so no ${field} test is in the pattern.`); return; }
      if (v === 0) {
        if (sel.every(o => !o.set[field])) clauses.push(`${field}:!*`);
        else notes.push(`${field}: 0 mixes "no delta" and an explicit 0; no ${field} test is in the pattern.`);
      } else clauses.push(`${field}:${v}`);
    };
    plain('dy'); plain('dx'); plain('ax');
    if (!clauses.some(c => c.startsWith('dy:'))) {
      if (metricKeys.includes('absDy')) {
        const v = single(o => o.absDy);
        if (v === undefined) notes.push('abs dy: several different values are selected, so no test is in the pattern.');
        else clauses.push(`dy:@${v}`);
      } else if (metricKeys.includes('relDy')) {
        const v = single(o => o.relDy);
        if (v === undefined) notes.push('dy vs base: several different values are selected, so no test is in the pattern.');
        else clauses.push(`dy:b${v}`);
      }
    }
    if (!clauses.length) notes.push('No value test: the pattern matches this context whatever the value.');
    if (GROUPS[ctx.group]?.nopattern) notes.push('Base height cannot be tested by a pattern, so the grouping is not in it; Preview shows what else matches.');

    const tokens = [];
    for (let s = lo; s <= hi; s++) {
      if (s === 0) {
        const t = (ctx.texts[0] ?? '').trim();
        tokens.push(t + (clauses.length ? `<${clauses.join(' ')}>` : ''));
      } else {
        tokens.push(slotTokens[s] || '/.+/');
      }
    }
    for (const t of tokens) if (/\s/.test(t.replace(/<[^>]*>/g, ''))) { notes.push(`"${t}" contains a space, which the pattern syntax cannot hold.`); break; }
    return { text: tokens.join(' '), tokens: tokens.length, notes };
  }

  // ---- panel --------------------------------------------------------------------------------

  let panel = null, elCharts = null, elStatus = null;
  const state = {
    occs: [], occByKey: new Map(), spec: null, built: null, bubbles: [],
    sel: new Set(), group: 'l1fam', metrics: ['dy'], pattern: null,
    timer: 0, sigWord: -1, sig: '', glyphWord: -1, noFollow: false,
    views: [], viewSig: '', suppressClick: false, selSnapshot: null,
  };

  const q = (sel) => panel.querySelector(sel);

  function css() {
    const style = document.createElement('style');
    style.textContent = `
      #placementPanel { position:fixed; top:60px; left:40px; width:820px; height:660px; min-width:480px; min-height:300px;
        z-index:1000; display:none; flex-direction:column; background:#fff; border:1px solid #888;
        box-shadow:0 4px 16px rgba(0,0,0,.35); resize:both; overflow:hidden; font-size:13px; }
      #placementPanel .pp-head { background:#456; color:#fff; padding:4px 8px; cursor:move; user-select:none;
        display:flex; justify-content:space-between; align-items:center; }
      #placementPanel .pp-body { flex:1; overflow:auto; padding:6px 8px; }
      #placementPanel table.pp-grid { border-collapse:collapse; }
      #placementPanel table.pp-grid td { padding:1px 2px; text-align:center; }
      #placementPanel table.pp-grid input { width:92px; font-family:monospace; font-size:12px; }
      #placementPanel table.pp-grid input.pp-slot[data-s='0'] { background:#ffe; font-weight:bold; }
      #placementPanel table.pp-grid button { font-size:11px; padding:0 4px; }
      #placementPanel .pp-row { margin:4px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      #placementPanel .pp-status { font-size:12px; color:#444; }
      #placementPanel .pp-status.err { color:#c00; }
      #placementPanel .pp-status.stale { color:#a60; }
      #placementPanel .pp-charts { overflow-x:auto; border:1px solid #ccc; margin:4px 0; min-height:60px; }
      #placementPanel svg.pp-svg { display:block; user-select:none; }
      #placementPanel svg.pp-svg.dragging { cursor:grabbing; }
      #placementPanel .pp-ml { font-size:12px; font-weight:bold; fill:#345; }
      #placementPanel .pp-tick { font-size:10px; fill:#666; }
      #placementPanel .pp-cat { font-size:10px; fill:#333; cursor:pointer; }
      #placementPanel .pp-cat:hover { fill:#06c; font-weight:bold; }
      #placementPanel .bub { cursor:pointer; }
      #placementPanel .bub circle.pp-dot { stroke:#555; stroke-width:1; fill-opacity:.85; }
      #placementPanel .bub.sel circle.pp-dot { stroke:#000; stroke-width:3.5; }
      #placementPanel .bub.psel circle.pp-dot { stroke:#000; stroke-width:2.5; stroke-dasharray:3 2; }
      #placementPanel .bub circle.pp-ring { display:none; fill:none; stroke:#06f; stroke-width:2.5; }
      #placementPanel .bub.cur circle.pp-ring { display:inline; }
      #placementPanel .pp-charts.emph .bub:not(.minor) { opacity:.22; }
      #placementPanel .pp-vl { display:none; font-size:10px; fill:#222; pointer-events:none; }
      #placementPanel .pp-charts.emph .pp-vl { display:inline; }
      #placementPanel .pp-band { fill:rgba(0,100,255,.12); stroke:#06f; stroke-dasharray:4 3; pointer-events:none; }
      #placementPanel .pp-words { max-height:90px; overflow:auto; border:1px solid #ddd; padding:2px 4px; line-height:1.5; }
      #placementPanel .pp-w { cursor:pointer; margin-right:8px; white-space:nowrap; }
      #placementPanel .pp-w:hover { background:#def; }
      #placementPanel .pp-pat { width:100%; box-sizing:border-box; font-family:monospace; }
      #placementPanel .pp-notes { color:#a60; font-size:12px; }
      #placementPanel .pp-leg span { display:inline-block; margin-right:8px; }
      #placementPanel .pp-leg i { display:inline-block; width:10px; height:10px; border:1px solid #555; margin-right:3px; }
    `;
    document.head.appendChild(style);
  }

  function build() {
    css();
    panel = document.createElement('div');
    panel.id = 'placementPanel';
    const gOpts = Object.entries(GROUPS).map(([k, g]) => `<option value='${k}'${k === state.group ? ' selected' : ''}>${esc(g.label)}</option>`).join('');
    const mOpts = Object.entries(METRICS).map(([k, m]) =>
      `<label><input type='checkbox' class='pp-metric' value='${k}'${k === 'dy' ? ' checked' : ''}>${esc(m.label)}</label>`).join(' ');
    const slotHead = [-3, -2, -1, 0, 1, 2, 3].map(s => `<td>${s === 0 ? 'TARGET' : (s > 0 ? '+' + s : s)}</td>`).join('');
    const slotIn = [-3, -2, -1, 0, 1, 2, 3].map(s => `<td><input class='pp-slot' data-s='${s}' spellcheck='false' placeholder='${s === 0 ? 'name or /re/' : 'any'}'></td>`).join('');
    const slotMode = [-3, -2, -1, 0, 1, 2, 3].map(s =>
      `<td><select class='pp-mode' data-s='${s}' title='any: no test. = word / family: taken from the glyph at this position in the current word (and follows the word). custom: whatever is typed.'>`
      + (s === 0 ? '' : `<option value='any'>any</option>`)
      + `<option value='exact'>= word</option><option value='fam'>&#8776; family</option><option value='custom'>custom</option></select></td>`).join('');
    const listRadios = LISTS.map(([k, label]) =>
      `<label><input type='radio' name='ppList' class='pp-ls' value='${k}'><span data-lbl='${k}'>${label}</span></label>`).join(' ');
    panel.innerHTML = `
      <div class='pp-head'><span>Placement scatter</span><button type='button' class='pp-close' aria-label='close'>X</button></div>
      <div class='pp-body'>
        <div class='pp-row'>List: ${listRadios}
          <button type='button' class='pp-plot' style='background-color:#afa;'>Plot</button></div>
        <div class='pp-row'>Glyph in current word: <select class='pp-pos'></select>
          <label title='When you move to another word, re-take the = word / family fields from it and re-plot'><input type='checkbox' class='pp-follow' checked>follow word</label>
          Max gap: <input class='pp-gap' type='text' value='0' size='2' title='Glyphs allowed between context glyphs (as Bulk Apply Max Gap)'></div>
        <table class='pp-grid'><tr>${slotHead}</tr><tr>${slotIn}</tr><tr>${slotMode}</tr></table>
        <div class='pp-row'>Group by <select class='pp-group'>${gOpts}</select>
          <span class='pp-tierbox' title='Heights are rounded to a multiple of this'>tier <input class='pp-tier' type='text' value='100' size='4'></span>
          Sort <select class='pp-sort'><option value='median'>by value</option><option value='outlier'>by outlierness</option><option value='count'>by count</option><option value='name'>by name</option></select>
          Show ${mOpts}</div>
        <div class='pp-row'><label title='Fade bubbles that hold most of their column and label the rest'><input type='checkbox' class='pp-emph'>emphasise outliers</label>
          bubble &le; <input class='pp-thr' type='text' value='15' size='2'>% of its column (columns of 5 or more)</div>
        <div class='pp-row pp-status'></div>
        <div class='pp-row pp-leg'></div>
        <div class='pp-charts'></div>
        <div class='pp-row'><b>Selection</b> <span class='pp-sum'>nothing selected</span>
          <button type='button' class='pp-none'>Clear</button></div>
        <div class='pp-row'>Pattern List:
          <button type='button' class='pp-pl' data-mode='replace' title='Replace the Pattern List with the selected words'>Replace</button>
          <button type='button' class='pp-pl' data-mode='merge' title='Add the selected words (Ctrl)'>Add</button>
          <button type='button' class='pp-pl' data-mode='subtract' title='Remove the selected words from the Pattern List (Shift)'>Subtract</button>
          &nbsp;|&nbsp; <button type='button' class='pp-mkpat'>Make pattern</button>
          <label><input type='checkbox' class='pp-shared'>include context shared by all selected</label></div>
        <div class='pp-patbox' style='display:none'>
          <div class='pp-row'><input class='pp-pat' readonly spellcheck='false'>
            <button type='button' class='pp-copy'>Copy</button>
            <button type='button' class='pp-prev'>Preview matches</button>
            <button type='button' class='pp-bulk'>Open in Bulk Apply</button></div>
          <div class='pp-notes'></div><div class='pp-prevout'></div>
        </div>
        <div class='pp-words'></div>
      </div>`;
    document.body.appendChild(panel);
    elCharts = q('.pp-charts');
    elStatus = q('.pp-status');
    q('.pp-tierbox').style.visibility = 'hidden';
    q('.pp-leg').innerHTML = Q_NAMES.map((n, i) => `<span><i style='background:${Q_COLOURS[i]}'></i>${n}</span>`).join('')
      + `<span><svg width='16' height='12'><circle cx='8' cy='6' r='5' fill='none' stroke='#06f' stroke-width='2'/></svg>current word</span>`
      + `<span style='color:#666'>Shift+wheel zoom &middot; drag pans &middot; Shift+drag selects (Ctrl adds) &middot; double-click empty space resets</span>`
      + `<button type='button' class='pp-zoomreset' style='font-size:11px'>Reset zoom</button>`;
    q('.pp-zoomreset').onclick = resetViews;

    q('.pp-close').onclick = hide;
    q('.pp-plot').onclick = () => plot();
    q('.pp-none').onclick = () => { state.sel.clear(); paintSelection(); };
    q('.pp-copy').onclick = () => navigator.clipboard?.writeText(q('.pp-pat').value);
    q('.pp-mkpat').onclick = makePattern;
    q('.pp-prev').onclick = previewPattern;
    q('.pp-bulk').onclick = openInBulkApply;
    panel.querySelectorAll('.pp-pl').forEach(b => { b.onclick = () => toPatternList(b.dataset.mode); });
    q('.pp-pat').addEventListener('click', e => e.target.select());

    panel.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('.pp-slot')) {   // typing makes the slot custom
        q(`.pp-mode[data-s='${t.dataset.s}']`).value = 'custom';
      }
      if (t.matches('.pp-mode')) applyModes(Number(t.dataset.s));
      if (t.matches('.pp-pos')) { applyModes(); schedulePlot(150); return; }
      if (t.matches('.pp-emph')) { elCharts.classList.toggle('emph', t.checked); return; }
      if (t.matches('.pp-group')) q('.pp-tierbox').style.visibility = t.value === 'baset' ? 'visible' : 'hidden';
      if (t.matches('.pp-slot, .pp-mode, .pp-metric, .pp-group, .pp-sort, .pp-ls, .pp-gap, .pp-tier, .pp-thr')) schedulePlot(300);
    });
    wireCharts();
    makeDraggable(panel, q('.pp-head'));
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

  function setStatus(msg, cls = '') {
    elStatus.textContent = msg;
    elStatus.className = 'pp-row pp-status ' + cls;
  }

  // ---- inputs -------------------------------------------------------------------------------

  // The panel's own list choice (same lists as Bulk Apply); defaults to the main window's selected list
  function activeInfo() {
    const f = wordList.filtered;
    const k = q('.pp-ls:checked')?.value ?? 'all';
    return { key: k, name: LISTS.find(l => l[0] === k)[1], list: f[k] };
  }

  function mainListKey() {
    if (radClassCollision.checked) return 'collision';
    if (radClassNear.checked)      return 'near';
    if (radClassKerning.checked)   return 'kerning';
    if (radClassMaybe.checked)     return 'maybe';
    if (radClassPattern.checked)   return 'pattern';
    if (radClassEdited.checked)    return 'edited';
    return 'all';
  }

  function syncListFromMain() {
    const r = q(`.pp-ls[value='${mainListKey()}']`);
    if (r && !r.disabled) r.checked = true;
  }

  function updateListLabels() {
    const f = wordList.filtered;
    for (const [k, label] of LISTS) {
      q(`[data-lbl='${k}']`).textContent = `${label} ${f[k].length}`;
    }
    const pr = q(`.pp-ls[value='pattern']`);
    pr.disabled = f.pattern.length === 0;
    if (pr.disabled && pr.checked) q(`.pp-ls[value='all']`).checked = true;
  }

  function currentNames() {
    const e = wordList.getCurrentEntry();
    if (!e?.hb) return null;
    return e.hb.map(h => wordList.hbs.getGlyphName(h.g));
  }

  // Rebuild the "glyph in current word" list. `prefer` (a matcher) picks the position whose glyph
  // matches the previous target, so moving to another word keeps looking at the same kind of glyph.
  function refreshWordGlyphs(prefer) {
    const sel = q('.pp-pos');
    state.glyphWord = wordList.getCurrentIndex();
    const e = wordList.getCurrentEntry();
    const names = currentNames();
    if (!names) { sel.innerHTML = ''; return; }
    let def = -1;
    if (prefer) {
      def = names.findIndex((n, i) => prefer(n) && e.hasDeltaAt(i));
      if (def < 0) def = names.findIndex(n => prefer(n));
    }
    if (def < 0) def = names.findIndex((n, i) => e.hasDeltaAt(i));
    if (def < 0) def = e.hb.findIndex(h => wordList.hbs.isGlyphMark?.(h.g));
    if (def < 0) def = 0;
    sel.innerHTML = names.map((n, i) => `<option value='${i}'${i === def ? ' selected' : ''}>#${i} ${esc(n)}${e.hasDeltaAt(i) ? ' *' : ''}</option>`).join('');
  }

  // Fill the text of slots whose mode is "= word" / "family" / "any" from the current word.
  // `only` limits it to one slot (when its mode select was changed).
  function applyModes(only) {
    const names = currentNames();
    const gi = Number(q('.pp-pos').value);
    panel.querySelectorAll('.pp-mode').forEach(sel => {
      const s = Number(sel.dataset.s);
      if (only !== undefined && s !== only) return;
      const input = q(`.pp-slot[data-s='${s}']`);
      const n = names?.[gi + s];
      if (sel.value === 'any') input.value = '';
      else if (sel.value === 'exact') input.value = n ?? '';
      else if (sel.value === 'fam') input.value = n ? familyText(n) : '';
    });
  }

  // The displayed word changed: re-take the derived fields from it and re-plot
  function followWord() {
    let prefer = null;
    try { prefer = compileMatcher(q(`.pp-slot[data-s='0']`).value); } catch (e) { /* bad regexp: ignore */ }
    refreshWordGlyphs(prefer);
    applyModes();
    schedulePlot(150);
  }

  function readSpec() {
    const texts = {};
    panel.querySelectorAll('.pp-slot').forEach(i => { texts[i.dataset.s] = i.value; });
    const target = compileMatcher(texts[0]);
    if (!target) throw new Error('Enter a target glyph (a name, or a /regexp/), or use the arrow button under TARGET.');
    const slots = {};
    for (const s of SLOTS) slots[s] = compileMatcher(texts[s]);
    const gap = Math.max(0, parseInt(q('.pp-gap').value, 10) || 0);
    return { texts, target, slots, gap };
  }

  function checkedMetrics() {
    const m = [...panel.querySelectorAll('.pp-metric')].filter(c => c.checked).map(c => c.value);
    return m.length ? m : ['dy'];
  }

  // ---- plotting -----------------------------------------------------------------------------

  function schedulePlot(ms) {
    clearTimeout(state.timer);
    state.timer = setTimeout(plot, ms);
  }

  function plot() {
    clearTimeout(state.timer);
    if (!panel) return;
    let spec;
    try { spec = readSpec(); } catch (e) { setStatus(String(e.message ?? e), 'err'); return; }
    const t0 = performance.now();
    updateListLabels();
    const info = activeInfo();
    const occs = collect(wordList, info.list, spec);
    state.spec = spec;
    state.occs = occs;
    state.occByKey = new Map(occs.map(o => [o.key, o]));
    for (const k of [...state.sel]) if (!state.occByKey.has(k)) state.sel.delete(k);   // keep what still exists
    state.group = q('.pp-group').value;
    state.metrics = checkedMetrics();
    state.built = buildCharts(occs, state.metrics, state.group, q('.pp-sort').value, {
      tier: parseInt(q('.pp-tier').value, 10) || 100,
      outlierShare: (parseFloat(q('.pp-thr').value) || 15) / 100,
    });
    state.tier = parseInt(q('.pp-tier').value, 10) || 100;
    const viewSig = [state.group, q('.pp-sort').value, state.metrics.join(','), state.tier].join('|');
    if (viewSig !== state.viewSig) { state.views = []; state.viewSig = viewSig; }   // new layout: back to full view
    updateListLabels();

    const entry = wordList.getCurrentEntry();
    state.sigWord = wordList.getCurrentIndex();
    state.sig = entry?.delta ? JSON.stringify(entry.saveDelta()) : '';
    state.glyphWord = -1;
    if (!q('.pp-pos').options.length) refreshWordGlyphs();

    renderCharts();
    const words = new Set(occs.map(o => o.wi)).size;
    setStatus(occs.length
      ? `${occs.length} occurrences in ${words} words, ${state.built.order.length} groups (${Math.round(performance.now() - t0)} ms).`
      : 'No occurrences of that glyph/context in the active list.');
    paintSelection();
    markCurrent();
  }

  function niceStep(range) {
    const rough = range / 5;
    const p = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  // Chart geometry. The zoom/pan view of each chart is {k, tx, ty}: positions are scaled about the
  // axis origin and shifted, while bubble and text sizes stay fixed.
  const CH = { colW: 40, L: 58, R: 14, T: 16, B: 100, H: 180 };
  const chartWidth = (order) => Math.max(480, CH.L + order.length * CH.colW + CH.R);
  const viewOf = (ci) => (state.views[ci] ??= { k: 1, tx: 0, ty: 0 });

  // Value range (padded) and the largest bubble of a chart; fixed for the data, independent of the view
  function prepChart(chart) {
    let vmin = Infinity, vmax = -Infinity, maxCount = 1;
    for (const b of chart.bubbles) {
      vmin = Math.min(vmin, b.value); vmax = Math.max(vmax, b.value);
      maxCount = Math.max(maxCount, b.occs.length);
    }
    if (!isFinite(vmin)) { vmin = -1; vmax = 1; }
    const pad = Math.max(10, (vmax - vmin) * 0.1);
    chart.vmin = vmin - pad; chart.vmax = vmax + pad; chart.maxCount = maxCount;
  }

  function bubbleTip(b) {
    if (b.tip) return b.tip;
    const qs = [0, 0, 0, 0, 0];
    b.occs.forEach(o => { qs[o.q]++; });
    const ex = [];
    for (const wi of b.words) { ex.push(wordList.get(wi).getWord()); if (ex.length >= 5) break; }
    b.tip = `${METRICS[b.metric].label} ${b.value}  |  ${b.cat}\n${b.occs.length} occurrences, ${b.words.size} words\n`
      + qs.map((n, i) => n ? `${Q_NAMES[i]} ${n}` : '').filter(Boolean).join(', ') + `\ne.g. ${ex.join('  ')}`;
    return b.tip;
  }

  // The inside of one chart's <svg>, for the chart's current view
  function chartInner(chart, ci, order) {
    const { colW, L, R, T, H } = CH;
    const W = chartWidth(order);
    const v = viewOf(ci);
    const span = chart.vmax - chart.vmin;
    const y = (val) => T + (chart.vmax - val) / span * H * v.k + v.ty;
    const xOf = (i) => L + colW * (i + 0.5) * v.k + v.tx;
    const vTop = chart.vmax - (-v.ty / (H * v.k)) * span;          // value at the top of the plot area
    const vBot = chart.vmax - ((H - v.ty) / (H * v.k)) * span;     // ... and at the bottom
    let s = `<defs><clipPath id='ppclip${ci}'><rect x='${L}' y='${T - 10}' width='${W - L - R}' height='${H + 20}'/></clipPath></defs>`;
    s += `<text class='pp-ml' x='4' y='11'>${esc(METRICS[chart.metric].label)} by ${esc(GROUPS[state.group].label.toLowerCase())}${state.group === 'baset' ? ' (' + state.tier + ')' : ''}${v.k !== 1 ? `  \u00d7${Math.round(v.k * 100) / 100}` : ''}</text>`;
    const step = niceStep(vTop - vBot);
    for (let val = Math.ceil(vBot / step) * step; val <= vTop; val += step) {
      const yy = y(val);
      s += `<line x1='${L - 4}' x2='${W - R}' y1='${yy}' y2='${yy}' stroke='${Math.abs(val) < 1e-9 ? '#888' : '#e4e4e4'}'/>`;
      s += `<text class='pp-tick' x='${L - 7}' y='${yy + 3}' text-anchor='end'>${Math.round(val * 100) / 100}</text>`;
    }
    order.forEach((c, i) => {
      const x = xOf(i);
      if (x < L - 6 || x > W - R + 6) return;
      const off = state.built.colOff.get(c).off;
      const label = (c.length > 16 ? c.slice(0, 15) + '\u2026' : c) + ` ${state.built.cats.get(c).length}`
        + (off && q('.pp-sort').value === 'outlier' ? ` (${off} off)` : '');
      s += `<text class='pp-cat' data-cat='${esc(c)}' transform='translate(${x - 4},${T + H + 12}) rotate(50)'><title>${esc(c)}: select all ${state.built.cats.get(c).length}</title>${esc(label)}</text>`;
    });
    s += `<g clip-path='url(#ppclip${ci})'>`;
    for (const b of chart.bubbles) {
      b.el = null;
      b.cx = xOf(b.ci);
      b.cy = y(b.value);
      b.r = 3 + 14 * Math.sqrt(b.occs.length / chart.maxCount);
      if (b.cx < L - 20 || b.cx > W - R + 20 || b.cy < T - 20 || b.cy > T + H + 20) continue;   // off screen
      s += `<g class='bub${b.minor ? ' minor' : ''}' data-b='${b.id}'><title>${esc(bubbleTip(b))}</title>`
        + `<circle class='pp-ring' cx='${b.cx}' cy='${b.cy}' r='${b.r + 4}'/>`
        + `<circle class='pp-dot' cx='${b.cx}' cy='${b.cy}' r='${b.r}' fill='${Q_COLOURS[b.q]}'/>`
        + (b.minor ? `<text class='pp-vl' x='${b.cx + b.r + 3}' y='${b.cy + 3}'>${b.value}</text>` : '') + `</g>`;
    }
    return s + '</g>';
  }

  function chartSvg(chart, ci, order) {
    const W = chartWidth(order), Ht = CH.T + CH.H + CH.B;
    return `<svg class='pp-svg' data-chart='${ci}' width='${W}' height='${Ht}' viewBox='0 0 ${W} ${Ht}' xmlns='${NS}'>${chartInner(chart, ci, order)}</svg>`;
  }

  function attachEls(root) {
    root.querySelectorAll('[data-b]').forEach(g => { state.bubbles[Number(g.dataset.b)].el = g; });
  }

  function renderCharts() {
    state.bubbles = [];
    const built = state.built;
    for (const c of built.charts) {
      prepChart(c);
      for (const b of c.bubbles) { b.id = state.bubbles.length; state.bubbles.push(b); }
    }
    elCharts.innerHTML = built.charts.map((c, ci) => chartSvg(c, ci, built.order)).join('');
    attachEls(elCharts);
  }

  // Redraw one chart after its view changed (zoom / pan)
  function repaintChart(ci) {
    const svg = elCharts.querySelector(`svg[data-chart='${ci}']`);
    if (!svg || !state.built) return;
    svg.innerHTML = chartInner(state.built.charts[ci], ci, state.built.order);
    attachEls(svg);
    paintBubbles(ci);
    markCurrent();
  }

  function resetViews() {
    state.views = [];
    if (state.built) renderCharts();
    paintBubbles();
    markCurrent();
  }

  // Selection classes on the bubbles (all charts, or just chart `ci`)
  function paintBubbles(ci) {
    const charts = ci === undefined ? state.built?.charts ?? [] : [state.built.charts[ci]];
    for (const c of charts) {
      for (const b of c.bubbles) {
        if (!b.el) continue;
        let n = 0;
        for (const o of b.occs) if (state.sel.has(o.key)) n++;
        b.el.classList.toggle('sel', n === b.occs.length);
        b.el.classList.toggle('psel', n > 0 && n < b.occs.length);
      }
    }
  }

  function paintSelection() {
    paintBubbles();
    updateSelectionPanel();
  }

  function markCurrent() {
    const wi = wordList.getCurrentIndex();
    for (const b of state.bubbles) if (b.el) b.el.classList.toggle('cur', b.words.has(wi));
  }

  // ---- selection ----------------------------------------------------------------------------

  function selectedOccs() {
    const out = [];
    for (const k of state.sel) { const o = state.occByKey.get(k); if (o) out.push(o); }
    return out;
  }

  function selectedWordIndices() {
    const seen = new Set(), out = [];
    for (const o of selectedOccs()) if (!seen.has(o.wi)) { seen.add(o.wi); out.push(o.wi); }
    return out;
  }

  function selectOccs(occs, additive) {
    if (additive) {
      const allIn = occs.every(o => state.sel.has(o.key));
      for (const o of occs) { if (allIn) state.sel.delete(o.key); else state.sel.add(o.key); }
    } else {
      state.sel.clear();
      for (const o of occs) state.sel.add(o.key);
    }
    paintSelection();
  }

  function updateSelectionPanel() {
    const occs = selectedOccs();
    const words = selectedWordIndices();
    let sum = 'nothing selected';
    if (occs.length) {
      sum = `${occs.length} occurrences in ${words.length} words`;
      for (const mk of state.metrics) {
        const vals = [...new Set(occs.map(METRICS[mk].get))].sort((a, b) => a - b);
        sum += ` | ${METRICS[mk].label}: ${vals.length > 6 ? vals.slice(0, 6).join(', ') + ', …' : vals.join(', ')}`;
      }
    }
    q('.pp-sum').textContent = sum;
    panel.querySelectorAll('.pp-pl, .pp-mkpat').forEach(b => { b.disabled = !occs.length; });
    const shown = words.slice(0, 300);
    q('.pp-words').innerHTML = shown.map(wi => `<span class='pp-w' data-wi='${wi}' title='#${wi + 1}'>${esc(wordList.get(wi).getWord())}</span>`).join('')
      + (words.length > shown.length ? ` … +${words.length - shown.length}` : '');
    q('.pp-patbox').style.display = 'none';
  }

  function wireCharts() {
    // As the main SVG: Shift+wheel zooms about the cursor, click-drag pans. Shift+drag draws a selection
    // rectangle (Ctrl adds to the selection). Double-click on empty space resets the zoom.
    elCharts.addEventListener('wheel', (e) => {
      if (!e.shiftKey) return;   // plain wheel scrolls the panel
      const svg = e.target.closest('svg');
      const d = e.deltaY || e.deltaX;
      if (!svg || !d) return;
      e.preventDefault();
      const ci = Number(svg.dataset.chart);
      const v = viewOf(ci);
      const k2 = Math.min(40, Math.max(0.2, v.k * (d < 0 ? 1.1 : 1 / 1.1)));
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const ratio = k2 / v.k;
      v.tx = (mx - CH.L) - (mx - CH.L - v.tx) * ratio;
      v.ty = (my - CH.T) - (my - CH.T - v.ty) * ratio;
      v.k = k2;
      repaintChart(ci);
    }, { passive: false });
    elCharts.addEventListener('click', (e) => {
      if (state.suppressClick) return;   // the click that ends a pan
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      const g = e.target.closest('[data-b]');
      if (g) { selectOccs(state.bubbles[Number(g.dataset.b)].occs, additive); return; }
      const lab = e.target.closest('[data-cat]');
      if (lab) selectOccs(state.built.cats.get(lab.dataset.cat) ?? [], additive);
    });
    elCharts.addEventListener('dblclick', (e) => {
      const g = e.target.closest('[data-b]');
      if (!g) {
        const svg = e.target.closest('svg');
        if (svg && !e.target.closest('[data-cat]')) {
          state.views[Number(svg.dataset.chart)] = undefined;
          repaintChart(Number(svg.dataset.chart));
          if (state.selSnapshot) { state.sel = new Set(state.selSnapshot); state.selSnapshot = null; paintSelection(); }   // the clicks of the double-click cleared it
        }
        return;
      }
      const b = state.bubbles[Number(g.dataset.b)];
      const cur = wordList.getCurrentIndex();
      const ws = [...b.words].filter(w => w !== cur);
      if (!ws.length) return;
      b.jump = ((b.jump ?? -1) + 1) % ws.length;
      jumpTo(ws[b.jump]);
    });
    elCharts.addEventListener('mousedown', (e) => {
      const svg = e.target.closest('svg');
      if (!svg) return;
      const band = e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey);
      if (e.button === 1 || (e.button === 0 && !band)) { startPan(e, svg); return; }
      if (e.button !== 0 || e.target.closest('[data-b],[data-cat]')) return;   // Shift/Ctrl+click on a bubble is handled by 'click'
      e.preventDefault();
      const r0 = svg.getBoundingClientRect();
      const x0 = e.clientX - r0.left, y0 = e.clientY - r0.top;
      const add = e.ctrlKey || e.metaKey;   // Ctrl adds to the selection
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('class', 'pp-band');
      svg.appendChild(rect);
      const move = (m) => {
        const x = m.clientX - r0.left, y = m.clientY - r0.top;
        rect.setAttribute('x', Math.min(x, x0)); rect.setAttribute('y', Math.min(y, y0));
        rect.setAttribute('width', Math.abs(x - x0)); rect.setAttribute('height', Math.abs(y - y0));
      };
      const up = (m) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        rect.remove();
        const x1 = m.clientX - r0.left, y1 = m.clientY - r0.top;
        if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
          if (!add) { state.sel.clear(); paintSelection(); }
          return;
        }
        const xl = Math.min(x0, x1), xh = Math.max(x0, x1), yl = Math.min(y0, y1), yh = Math.max(y0, y1);
        const W = chartWidth(state.built.order);
        const hit = state.built.charts[Number(svg.dataset.chart)].bubbles.filter(b =>
          b.cx >= xl && b.cx <= xh && b.cy >= yl && b.cy <= yh                                  // inside the rectangle ...
          && b.cx >= CH.L && b.cx <= W - CH.R && b.cy >= CH.T && b.cy <= CH.T + CH.H);          // ... and actually visible
        if (!add) state.sel.clear();
        for (const b of hit) for (const o of b.occs) state.sel.add(o.key);
        paintSelection();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // (the words list is rebuilt often, so listen on its container)
    panel.addEventListener('click', (e) => {
      const w = e.target.closest('.pp-w');
      if (w) jumpTo(Number(w.dataset.wi));
    });
  }

  function startPan(e, svg) {
    e.preventDefault();
    const ci = Number(svg.dataset.chart);
    const v = viewOf(ci);
    const x0 = e.clientX, y0 = e.clientY, tx0 = v.tx, ty0 = v.ty;
    let moved = false, pending = false;
    svg.classList.add('dragging');
    const move = (m) => {
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;   // a click without movement is still a click
      moved = true;
      v.tx = tx0 + dx; v.ty = ty0 + dy;
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; repaintChart(ci); }); }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const svgNow = elCharts.querySelector(`svg[data-chart='${ci}']`);
      svgNow?.classList.remove('dragging');
      if (moved) {
        state.suppressClick = true;   // swallow the click that follows the drag
        setTimeout(() => { state.suppressClick = false; }, 0);
        repaintChart(ci);
      } else if (!e.target.closest('[data-b],[data-cat]') && !e.ctrlKey && !e.shiftKey && !e.metaKey && state.sel.size) {
        state.selSnapshot = new Set(state.sel);   // so a double-click (reset zoom) can put it back
        state.sel.clear();
        paintSelection();
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function jumpTo(wi) {
    if (wi === wordList.getCurrentIndex()) return;
    breadCrumbAdd(wordList.getCurrentIndex(true));   // so "back" is one click away
    state.noFollow = true;   // looking at a word from the plot must not change the plot
    try { refreshSVG(null, wi + 1, true); } finally { state.noFollow = false; }
    try { window.localStorage.setItem('index', wi + 1); } catch (e) { /* ignore */ }
  }

  // ---- Pattern List and Bulk Apply ----------------------------------------------------------

  function toPatternList(mode) {
    const idx = selectedWordIndices();
    if (!idx.length) return;
    const wasPattern = radClassPattern.checked;
    setPatternList(idx, mode);
    if (wasPattern) plot();   // the list being plotted just changed
    else setStatus(`${mode === 'subtract' ? 'Removed' : mode === 'merge' ? 'Added' : 'Replaced with'} ${idx.length} words (Pattern List now ${wordList.filtered.pattern.length}).`);
  }

  function makePattern() {
    const sel = selectedOccs();
    if (!sel.length) return;
    const texts = {};
    panel.querySelectorAll('.pp-slot').forEach(i => { texts[i.dataset.s] = i.value; });
    state.pattern = buildPattern(sel, state.metrics, { texts, group: state.group, shared: q('.pp-shared').checked });
    state.pattern.gap = Math.max(0, parseInt(q('.pp-gap').value, 10) || 0);
    q('.pp-pat').value = state.pattern.text;
    q('.pp-notes').textContent = state.pattern.notes.join(' ');
    q('.pp-prevout').textContent = '';
    q('.pp-patbox').style.display = '';
  }

  async function previewPattern() {
    if (!state.pattern) return;
    const sel = new Set(selectedWordIndices());
    const res = await patternMatchExtract(activeInfo().list, state.pattern.text, state.pattern.tokens, state.pattern.gap);
    const matched = new Set(res.map(r => r.index));
    let inSel = 0;
    for (const w of matched) if (sel.has(w)) inSel++;
    const extra = [...matched].filter(w => !sel.has(w));
    let missed = 0;
    for (const w of sel) if (!matched.has(w)) missed++;
    const out = q('.pp-prevout');
    out.innerHTML = `Matches ${matched.size} words in the active list: ${inSel} selected, <b>${extra.length} not selected</b>`
      + (missed ? `, <b>${missed} selected words missed</b>` : '') + '.'
      + (extra.length ? ' Not selected: ' + extra.slice(0, 30).map(wi => `<span class='pp-w' data-wi='${wi}'>${esc(wordList.get(wi).getWord())}</span>`).join('') + (extra.length > 30 ? ' …' : '') : '');
  }

  async function openInBulkApply() {
    if (!state.pattern) return;
    patternMatchShow();
    inpPattern.value = state.pattern.text;
    txtMinMatch.value = state.pattern.tokens;
    txtMaxGap.value = state.pattern.gap;
    inpPatternChanged();
    await patternMatchFind();
  }

  // ---- show / hide / hooks ------------------------------------------------------------------

  function show() {
    const first = !panel;
    if (first) build();
    panel.style.display = 'flex';
    syncListFromMain();
    updateListLabels();
    if (first) {
      refreshWordGlyphs();
      q(`.pp-mode[data-s='0']`).value = 'exact';
      applyModes();
    } else if (q('.pp-follow').checked && wordList.getCurrentIndex() !== state.glyphWord) {
      followWord();
      return;
    }
    plot();
  }

  function hide() { if (panel) panel.style.display = 'none'; }
  function toggle() { if (panel && panel.style.display === 'flex') hide(); else show(); }

  // Called from renderSVG after each redraw: keep the current-word rings, follow the displayed word,
  // and re-plot when its deltas were edited.
  function onRender() {
    if (!panel || panel.style.display !== 'flex') return;
    const wi = wordList.getCurrentIndex();
    if (wi !== state.glyphWord) {
      if (state.noFollow || !q('.pp-follow').checked) {
        state.noFollow = false;
        refreshWordGlyphs();   // list the new word's glyphs, but leave the context alone
      } else {
        followWord();
        return;
      }
    }
    if (wi === state.sigWord) {
      const e = wordList.getCurrentEntry();
      const sig = e?.delta ? JSON.stringify(e.saveDelta()) : '';
      if (sig !== state.sig) { setStatus('Deltas changed: re-plotting…', 'stale'); schedulePlot(500); return; }
    }
    markCurrent();
  }

  return { show, hide, toggle, onRender, plot, _test: { compileMatcher, collect, buildCharts, buildPattern, familyText, fam, form, tierOf, GROUPS } };
})();
