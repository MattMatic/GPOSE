// "nukta division" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// Uses the GlyphQuery helpers (js/glyph-query.js, loaded by the app); see console/README.md.
//
// Finds nuktas (sdb / ddb / tdb, and KASRA) that have been visually separated from their own cursive base
// run: a nukta whose base belongs to a DIFFERENT run from a REf / DALf / VAO glyph, yet sits under the
// start of that glyph - the glyph's x-min lies left of a chosen point (MID, default the mid-point) of the
// nukta's x-range, and the nukta has been pushed below the glyph's y-min - and where nothing stops the
// nukta moving left (free space to its left; the REf / DALf / VAO glyphs themselves never count as stops).
// A target with a KASRA attached to it is ignored. Hits go in the Pattern List (APPLY / MODE below).
// Work in progress: to be refined. Hits are left in window.__nuktaDivisionHits.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const TARGET  = /^(REf|DALf|VAO)/;        // glyphs whose left edge (x-min) is tested
  const MARKS   = /^(sdb|ddb|tdb|KASRA)/;   // the nuktas: marks to the LEFT that the target is compared with
  const SKIP_IF_ATTACHED = /^KASRA/;        // ignore a target that has a mark matching this attached to it
                                            //   (null = don't skip anything)
  const MID     = 0.75;                      // target x-min must be LEFT of this point of the nukta's x-range:
                                            //   0 = the nukta's left edge, 0.5 = its mid-point, 1 = its right edge
  const FROM    = 0;                        // ... and not left of this point (0 = must start within the nukta,
                                            //   -Infinity = no lower limit)
  const BELOW   = 'entire';                 // 'entire': the nukta's whole box is below the target's y-min
                                            // 'partial': only the nukta's y-min is below the target's y-min
                                            // 'off': ignore the vertical position
  const DIFFERENT_RUN = true;               // the nukta's base must be in a different cursive run from the target
  const REQUIRE_ATTACHED = true;            // skip a nukta that has no recorded attachment (its run is unknown)
  const FREE_LEFT = 150;                     // the nukta must be able to move at least this far left (font units)
                                            //   before touching something; null = don't test
  const LOOK_LEFT = 600;                    // only glyphs within this distance to its left are looked at, so a
                                            //   bigger gap is reported as ">600" (a larger value is slower)
  const BLOCKS  = null;                     // glyphs that can stop it: a regexp, or null = every glyph with an
                                            //   outline except the nukta itself and the TARGET glyphs
  const TOL     = 0;                        // font units of slack on the x / y comparisons
  const LIST    = null;                     // null = every word, 'kerning' etc = a named list, 'active' = main window
  const APPLY   = true;                     // false = report only, leave the Pattern List alone
  const MODE    = 'replace';                // Pattern List: 'replace' | 'merge' | 'subtract'

  return GlyphQuery.scan({
    title: 'Nukta division', resultVar: '__nuktaDivisionHits', list: LIST, apply: APPLY, mode: MODE,
    test: (w) => {
      for (const T of w.glyphs) {
        if (!T.is(TARGET) || !T.box) continue;
        if (SKIP_IF_ATTACHED && T.marks.some(m => m.is(SKIP_IF_ATTACHED))) continue;
        for (let m = T.i - 1; m >= 0; m--) {                               // lower index = further left
          const N = w.glyphs[m], nb = N.box;
          if (!N.is(MARKS) || !nb) continue;
          const wd = nb.x1 - nb.x0;
          const lo = Number.isFinite(FROM) ? nb.x0 + FROM * wd : -Infinity;
          const hi = nb.x0 + MID * wd;                                     // e.g. the nukta's mid-point
          if (T.box.x0 < lo - TOL || T.box.x0 > hi + TOL) continue;        // target x-min left of that point
          if (BELOW !== 'off' && !(BELOW === 'entire' ? nb.y1 <= T.box.y0 + TOL : nb.y0 < T.box.y0 + TOL)) continue;   // nukta below the target

          const base = N.rootBase;                                         // the nukta belongs to a different cursive run
          if (DIFFERENT_RUN) {
            if (!base) { if (REQUIRE_ATTACHED) continue; }
            else if (base.run === T.run) continue;
          }

          let clear = null;                                                // nothing stops the nukta moving left
          if (FREE_LEFT != null) {
            const stops = w.glyphs.filter(G => BLOCKS ? G.is(BLOCKS) : !G.is(TARGET));
            const c = GlyphQuery.clearance(N, stops, { dir: -1, look: Math.max(LOOK_LEFT, FREE_LEFT), stopAt: FREE_LEFT });
            if (c.d <= FREE_LEFT) continue;                                // stopped by a neighbour: it stays
            clear = c.d;
          }
          return {
            target: `#${T.i} ${T.name}`, nukta: `#${N.i} ${N.name}`,
            nuktaBase: base ? `#${base.i} ${base.name}` : '-', runs: base ? `${base.run} vs ${T.run}` : '-',
            targetAt: wd ? `${Math.round((T.box.x0 - nb.x0) / wd * 100)}%` : '-',     // where x-min sits across the nukta
            freeLeft: clear === null ? '-' : (clear === Infinity ? `>${Math.max(FREE_LEFT, LOOK_LEFT)}` : Math.round(clear)),
            nuktaHasDelta: N.hasDelta,
          };
        }
      }
      return null;
    },
  });
})();
