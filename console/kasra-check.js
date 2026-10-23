// "kasra check" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// Uses the GlyphQuery helpers (js/glyph-query.js, loaded by the app); see console/README.md.
//
// Finds words where two kinds of mark are horizontally in the same region but vertically the wrong way round, and
// puts them in the Pattern List. For each pair (a, b) in CHECKS it flags a word when
//   - the x-min..x-max bounding boxes of a and b overlap (the same region),
//   - the two are not off to the side of each other: their x-mids are no further apart than MAX_X_MID, and
//   - the bounding-box y-mid of a is ABOVE the bounding-box y-mid of b.
// As shipped:
//   - a KASRA higher than an sdb / ddb / tdb nukta in the same x-region is flagged (the nukta's y-mid is below the KASRA's);
//   - an sda / dda / tda nukta higher than a FATHA / DAMMA / SHADDA / HAMZA_ABOVE in the same x-region is flagged.
// Add or edit entries in CHECKS to compare other pairs of marks. After every run it prints a funnel (how many words
// have each mark, how many share a region, how many were flagged) and the spread of x-mid distances among the pairs
// that are the wrong way round, so MAX_X_MID can be set from real data; set DEBUG_WORD to examine one word in full.
// Work in progress: to be refined. Hits are left in window.__kasraCheckHits.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const CHECKS = [
    // flag a word when a is in the same x-region as b and a's box y-mid is above b's box y-mid
    { name: 'kasra higher than nukta', a: /^KASRA/,         b: /^(sdb|ddb|tdb)/ },
    //{ name: 'nukta higher than vowel', a: /^(sda|dda|tda)/, b: /^(FATHA|DAMMA|SHADDA|HAMZA_ABOVE)/ },
  ];
  const MIN_OVERLAP = 0.1;        // x overlap needed to count as "the same region", as a fraction of the NARROWER box
                                //   (0 = any overlap, touching included)
  const MAX_X_MID = 100;         // font units: the x-mids of a and b may be no further apart than this, so a mark that is
                                //   merely off to the side of the other (but still overlapping) is left alone. This value is a
                                //   guess: see the distribution printed after a run. null = no limit
  const MARGIN  = 0;            // font units: a's y-mid must be above b's by MORE than this
  const SAME    = 'any';        // which marks may be compared:
                                //   'any'  : any a and b in the word
                                //   'run'  : only marks on the same cursive base run
                                //   'base' : only marks attached to the very same glyph
  const DEBUG_WORD = null;      // e.g. 'word': explain that word only (nothing is changed)
  const LIST    = null;         // null = every word, 'kerning' etc = a named list, 'active' = main window
  const APPLY   = true;         // false = report only, leave the Pattern List alone
  const MODE    = 'replace';    // Pattern List: 'replace' | 'merge' | 'subtract'

  // ---- helpers ----------------------------------------------------------------------------------
  const ymid = (g) => (g.box.y0 + g.box.y1) / 2;
  const xOverlap = (A, B) => {                                    // overlap width and as a fraction of the narrower box
    const ov = Math.min(A.box.x1, B.box.x1) - Math.max(A.box.x0, B.box.x0);
    const narrow = Math.min(A.box.x1 - A.box.x0, B.box.x1 - B.box.x0);
    return { ov, frac: narrow > 0 ? ov / narrow : (ov >= 0 ? 1 : 0) };
  };
  const sameRegion = (A, B) => { const o = xOverlap(A, B); return o.ov >= 0 && o.frac >= MIN_OVERLAP; };
  const xmid = (g) => (g.box.x0 + g.box.x1) / 2;
  const xMidDist = (A, B) => Math.abs(xmid(A) - xmid(B));
  const closeEnough = (A, B) => MAX_X_MID == null || xMidDist(A, B) <= MAX_X_MID;
  const sameGroup = (A, B) => {
    if (SAME === 'any') return true;
    const bA = A.rootBase, bB = B.rootBase;
    if (!bA || !bB) return false;
    return SAME === 'run' ? bA.run === bB.run : bA === bB;
  };
  const row = (C, A, B) => {
    const o = xOverlap(A, B);
    return { check: C.name, a: `#${A.i} ${A.name}`, b: `#${B.i} ${B.name}`, overlap: `${Math.round(o.frac * 100)}%`,
             xMidDist: Math.round(xMidDist(A, B)), aMidY: Math.round(ymid(A)), bMidY: Math.round(ymid(B)),
             diff: Math.round(ymid(A) - ymid(B)),
             hasDelta: A.hasDelta || B.hasDelta };
  };

  // ---- debugging one word -------------------------------------------------------------------------
  if (DEBUG_WORD) {
    const idx = wordList.find(DEBUG_WORD);
    if (idx < 0) { console.warn(`"${DEBUG_WORD}" is not in the word list`); return null; }
    const w = GlyphQuery.placed(idx);
    GlyphQuery.describe(w);
    const rows = [];
    for (const C of CHECKS) {
      const As = w.glyphs.filter(g => g.is(C.a)), Bs = w.glyphs.filter(g => g.is(C.b));
      console.log(`${C.name}: ${As.length} glyphs match a, ${Bs.length} match b`);
      for (const A of As) for (const B of Bs) {
        const r = row(C, A, B);
        r.verdict = !A.box || !B.box ? 'no outline'
          : !sameGroup(A, B) ? `not on the same ${SAME}`
          : !sameRegion(A, B) ? 'not in the same x-region'
          : ymid(A) - ymid(B) <= MARGIN ? 'ok (a is not higher)'
          : !closeEnough(A, B) ? `off to the side (x-mids ${Math.round(xMidDist(A, B))} apart, limit ${MAX_X_MID})`
          : 'FLAGGED';
        rows.push(r);
      }
    }
    console.table(rows);
    return rows;
  }

  // ---- the check ------------------------------------------------------------------------------------
  const funnel = CHECKS.map(C => ({ check: C.name, 'words with a': 0, 'with b': 0, 'with both': 0, 'same x-region': 0,
                                    'wrong way round': 0, flagged: 0 }));
  const xMids = [];                                                // x-mid distance of every wrong-way-round pair, before the limit

  const res = await GlyphQuery.scan({
    title: 'Kasra check', resultVar: '__kasraCheckHits', list: LIST, apply: APPLY, mode: MODE,
    test: (w) => {
      const found = [];
      CHECKS.forEach((C, ci) => {
        const As = w.glyphs.filter(g => g.is(C.a) && g.box), Bs = w.glyphs.filter(g => g.is(C.b) && g.box);
        const F = funnel[ci];
        if (As.length) F['words with a']++;
        if (Bs.length) F['with b']++;
        if (!As.length || !Bs.length) return;
        F['with both']++;
        let region = false, wrong = false, flagged = false;
        for (const A of As) {
          for (const B of Bs) {
            if (A === B || !sameGroup(A, B) || !sameRegion(A, B)) continue;
            region = true;
            if (ymid(A) - ymid(B) <= MARGIN) continue;
            wrong = true;
            xMids.push(xMidDist(A, B));
            if (closeEnough(A, B)) { flagged = true; found.push(row(C, A, B)); }
          }
        }
        if (region) F['same x-region']++;
        if (wrong) F['wrong way round']++;
        if (flagged) F.flagged++;
      });
      if (!found.length) return null;
      const worst = found.reduce((p, q) => q.diff > p.diff ? q : p);
      return { ...worst, checks: [...new Set(found.map(f => f.check))].join('; ') };
    },
  });

  window.__kasraCheckFunnel = funnel;
  console.log(`Funnel (words): "same x-region" = some a and b overlap horizontally; "wrong way round" = a is also higher than b;`
    + ` "flagged" = and their x-mids are no more than MAX_X_MID (${MAX_X_MID}) apart.`);
  console.table(funnel);
  console.log('How far apart the x-mids are for the wrong-way-round pairs (font units) - set MAX_X_MID from this:');
  GlyphQuery.printStats(GlyphQuery.stats('x-mid distance', xMids));
  return res;
})();
