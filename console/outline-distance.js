// "outline distance" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// Uses the GlyphQuery helpers (js/glyph-query.js, loaded by the app); see console/README.md.
//
// Measures the shortest distance between glyph OUTLINES (not boxes), with the GPOSE deltas applied, and
// puts words in the Pattern List where
//   - two marks are too close to each other (closer than MARK_MARK_MIN), or
//   - a mark is too far from the base glyph run (further than MARK_BASE_MAX from EVERY base glyph in the
//     word, not just the glyph it is attached to).
// Which glyphs are measured is set by the MARKS and BASES regular expressions; all other glyphs are ignored.
// It always prints the distribution of the distances it measured, so the two thresholds (which are only
// starting guesses) can be set from real data: run it once with APPLY = false.
// Work in progress: to be refined. Hits are left in window.__outlineDistanceHits.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const MARKS         = /^(sdb|ddb|tdb|KASRA)/;   // the marks to measure (null = every mark in the font)
  const BASES         = null;   // glyphs that make up the base run: a regexp, or null = every glyph that is not a mark
  const MARK_MARK_MIN = 35;     // marks closer than this (font units) = too close; null = skip this check
  const MARK_BASE_MAX = 1250;    // marks further than this from every base glyph = too far; null = skip
  const CAP           = 600;    // distances are only measured up to this; anything further counts as CAP
  const LIST          = null;   // null = every word, 'kerning' etc = a named list, 'active' = main window
  const APPLY         = true;   // false = report only (and show the distribution), leave the Pattern List alone
  const MODE          = 'replace';   // Pattern List: 'replace' | 'merge' | 'subtract'

  const cap = Math.max(CAP, (MARK_BASE_MAX ?? 0) + 1);       // must exceed the "too far" threshold
  const markMark = [], markBase = [];

  const res = await GlyphQuery.scan({
    title: 'Outline distances', resultVar: '__outlineDistanceHits', list: LIST, apply: APPLY, mode: MODE,
    test: (w) => {
      const isM = (g) => MARKS ? g.is(MARKS) : g.mark;                       // a mark to measure
      const ms = w.glyphs.filter(g => g.outline && isM(g));
      const bs = w.glyphs.filter(g => g.outline && !isM(g) && (BASES ? g.is(BASES) : !g.mark));   // the base run
      let close = null, far = null;

      const near = new Map(ms.map(g => [g, cap]));                           // marks too close: nearest other mark
      for (let a = 0; a < ms.length; a++) {
        for (let b = a + 1; b < ms.length; b++) {
          const A = ms[a], B = ms[b], limit = Math.max(near.get(A), near.get(B));
          if (GlyphQuery.boxDistance(A, B) >= limit) continue;
          const d = GlyphQuery.distance(A, B, limit);
          if (d < near.get(A)) near.set(A, d);
          if (d < near.get(B)) near.set(B, d);
          if (MARK_MARK_MIN != null && d < MARK_MARK_MIN && (!close || d < close.d)) close = { d, A, B };
        }
      }
      if (ms.length > 1) for (const g of ms) markMark.push(near.get(g));

      if (bs.length) {                                                        // marks too far: nearest base glyph
        for (const M of ms) {
          const cands = bs.map(B => ({ B, gap: GlyphQuery.boxDistance(M, B) })).filter(c => c.gap < cap).sort((p, q) => p.gap - q.gap);
          let best = cap;
          for (const c of cands) {
            if (c.gap >= best) break;
            best = Math.min(best, GlyphQuery.distance(M, c.B, best));
          }
          markBase.push(best);
          if (MARK_BASE_MAX != null && best > MARK_BASE_MAX && (!far || best > far.d)) far = { d: best, M };
        }
      }
      if (!close && !far) return null;
      return {
        tooClose: close ? `#${close.A.i} ${close.A.name} - #${close.B.i} ${close.B.name}: ${close.d.toFixed(1)}` : '',
        tooFar: far ? `#${far.M.i} ${far.M.name}: ${far.d >= cap ? cap + '+' : far.d.toFixed(1)}` : '',
      };
    },
  });

  console.log(`Distances measured (font units, capped at ${cap}). Use these to set the thresholds:`);
  GlyphQuery.printStats(GlyphQuery.stats('nearest other mark, per mark', markMark), GlyphQuery.stats('nearest base glyph, per mark', markBase));
  return res.hits.length;
})();
