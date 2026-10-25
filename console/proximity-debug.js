// "proximity debug" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// Uses the GlyphQuery helpers (js/glyph-query.js, loaded by the app); see console/README.md.
//
// Explains why the Proximity panel does or does not match particular words. It reads the panel's CURRENT settings (open
// the panel first), then for each word lists every Glyph 1 / Glyph 2 pair and the FIRST condition that fails:
//   no Glyph 1 / no Glyph 2 / relation / not picked / out of range / distance / X / Y   - or PASS
// By default it explains the words the kasra check found (window.__kasraCheckHits), so you can see why the panel
// does not find the same ones - or, if the kasra check has not been run in this page, the first words of the Pattern List,
// or failing that the word on screen. Nothing is changed.
(() => {
  // ---- settings ---------------------------------------------------------------------------------
  const WORDS = null;        // e.g. ['word1', 'word2'] to explain particular words; null = the kasra check's hits
                             //   (window.__kasraCheckHits), else the first words of the Pattern List, else the displayed word
  const MAX_WORDS = 6;       // how many words to explain when taking them from a list

  // ---- the panel's current settings ---------------------------------------------------------------
  const P = document.querySelector('#proximityPanel');
  if (!P) { console.warn('Open the Proximity panel first.'); return null; }
  const el = (c) => P.querySelector('.px-' + c);
  const text = (c) => (el(c)?.value ?? '').trim();
  const num = (c) => (text(c) === '' ? null : Number(text(c)));
  const range = (k) => ({ from: num(`${k}-from`), to: num(`${k}-to`), abs: !!el(`${k}-abs`)?.checked });
  const D = range('dist'), X = range('x'), Y = range('y');
  const g1Text = text('g1'), g2Text = text('g2');
  const m1 = GlyphQuery.matcher(g1Text) ?? (() => true), m2 = GlyphQuery.matcher(g2Text) ?? (() => true);
  const pick = text('pick'), rel = text('rel') || 'run-diff', measure = text('measure') || 'outline';
  const searchRange = D.to !== null ? D.to : Math.max(600, (D.from ?? 0) + 1);
  const limit = D.to !== null ? D.to + 0.001 : searchRange;
  console.log('Proximity settings read from the panel:', { glyph1: g1Text || '(any)', glyph2: g2Text || '(any)', glyph2Is: pick,
    compareIn: rel, measure, distance: D, x: X, y: Y, searchRange });
  if (!el('measure')) console.warn('This panel has no "Measure" choice: reload the page to get the bounding-box measure.');

  // ---- the same definitions the panel uses ------------------------------------------------------------
  const runOf = (g) => (g.mark && g.rootBase) ? g.rootBase.run : g.run;
  const baseOf = (g) => (g.mark && g.rootBase) ? g.rootBase.i : g.i;
  const RELATIONS = {
    'run-diff': (A, B) => runOf(A) !== runOf(B), 'run-same': (A, B) => runOf(A) === runOf(B),
    'base-diff': (A, B) => baseOf(A) !== baseOf(B), 'base-same': (A, B) => baseOf(A) === baseOf(B),
    'any': () => true,
  };
  const related = RELATIONS[rel] ?? RELATIONS['run-diff'];
  const measurePair = (A, B) => {
    if (measure !== 'box') return GlyphQuery.closest(A, B, limit);
    const d = GlyphQuery.boxDistance(A, B);
    if (!(d < limit)) return null;
    const a = A.box, b = B.box;
    return { d, dx: (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2, dy: (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2 };
  };
  const inRange = (c, v) => { const x = c.abs ? Math.abs(v) : v; return (c.from === null || x >= c.from) && (c.to === null || x <= c.to); };
  const fmt = (v) => (v === undefined || v === null) ? '-' : Math.round(v * 10) / 10;

  // ---- the words to explain ------------------------------------------------------------------------
  const kasraHits = window.__kasraCheckHits ?? [];
  let list, source;
  if (WORDS) {
    source = 'WORDS';
    list = WORDS.map(w => ({ word: w, index: wordList.find(w) }));
  } else if (kasraHits.length) {
    source = "the kasra check's hits";
    list = kasraHits.slice(0, MAX_WORDS).map(h => ({ word: h.word, index: h.index - 1 }));
  } else if (wordList.filtered.pattern.length) {
    source = 'the first words of the Pattern List';
    list = wordList.filtered.pattern.slice(0, MAX_WORDS).map(i => ({ word: wordList.get(i).getWord(), index: i }));
  } else {
    source = 'the displayed word';
    const i = wordList.getCurrentIndex();
    list = wordList.get(i) ? [{ word: wordList.get(i).getWord(), index: i }] : [];
  }
  if (!list.length) { console.warn('No words to explain: set WORDS.'); return null; }
  console.log(`Explaining ${list.length} word(s) from ${source}.`);

  const rows = [];
  for (const { word, index } of list) {
    if (index < 0 || !wordList.get(index)) { rows.push({ word, verdict: 'word not in the word list' }); continue; }
    const w = GlyphQuery.placed(index);
    const names = w.glyphs.map(g => g.name).join(' ');
    const g1s = w.glyphs.filter(g => g.outline && m1(g.name, g.mark)), g2s = w.glyphs.filter(g => g.outline && m2(g.name, g.mark));
    if (!g1s.length || !g2s.length) {
      rows.push({ word, verdict: !g1s.length ? 'no Glyph 1 matches' : 'no Glyph 2 matches', glyphsInWord: names });
      continue;
    }
    for (const A of g1s) {
      const others = g2s.filter(B => B !== A && related(A, B));
      let picked;
      if (pick === 'right') picked = others.filter(B => B.i > A.i).slice(0, 1);
      else if (pick === 'left') picked = others.filter(B => B.i < A.i).slice(-1);
      else picked = others;                       // nearest / any: judged below
      for (const B of g2s) {
        if (B === A) continue;
        const c = measurePair(A, B);
        const row = {
          word, glyph1: `#${A.i} ${A.name}`, glyph2: `#${B.i} ${B.name}`,
          baseA: `#${baseOf(A)}`, baseB: `#${baseOf(B)}`, runA: runOf(A), runB: runOf(B),
          d: fmt(c?.d), x: fmt(c?.dx), y: fmt(c?.dy),
        };
        const rels = Object.fromEntries(Object.entries(RELATIONS).map(([k, f]) => [k, f(A, B)]));
        row.sameBase = rels['base-same']; row.sameRun = rels['run-same'];
        if (!related(A, B)) row.verdict = `fails "Compare glyphs in" (${rel}): ${rel.startsWith('base') ? `bases #${baseOf(A)} / #${baseOf(B)}` : `runs ${runOf(A)} / ${runOf(B)}`}`;
        else if (!picked.includes(B) && pick !== 'nearest') row.verdict = `not the Glyph 2 chosen by "${pick}"`;
        else if (!c) row.verdict = `further apart than the search range (${Math.round(searchRange)})`;
        else if (!inRange(D, c.d)) row.verdict = `fails distance (${fmt(c.d)})`;
        else if (!inRange(X, c.dx)) row.verdict = `fails X (${fmt(c.dx)}${X.abs ? ', abs' : ''})`;
        else if (!inRange(Y, c.dy)) row.verdict = `fails Y (${fmt(c.dy)}${Y.abs ? ', abs' : ''})`;
        else row.verdict = pick === 'nearest' ? 'PASS if this is the nearest Glyph 2' : 'PASS';
        rows.push(row);
      }
    }
  }
  console.table(rows);
  const pass = new Set(rows.filter(r => /^PASS/.test(r.verdict)).map(r => r.word));
  console.log(`${pass.size} of ${list.length} words would match with the panel's current settings.`);
  return rows;
})();
