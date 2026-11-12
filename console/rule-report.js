// "rule report" - GPOSE console snippet. Run AFTER console/rule-measure.js: it reads window.__ruleMeasure (nothing is
// measured again, so it is instant) and prints
//   - the dot glyph sizes (for the dot unit DU)
//   - the distance tables: dOwn, dOtherBase, dSameMark, dOtherMark (edited and unedited marks, per glyph group)
//   - the list of marks that lie OUTSIDE the x-extent of their own letter (hOwn > 0), worst first
//   - the list of marks with LESS clearance than FLOOR to any other ink (other letters, marks on other letters, marks on
//     the same letter, or their own base), tightest first, and how many there are per glyph group
// Change the settings and run it as often as you like.
(() => {
  // ---- settings ---------------------------------------------------------------------------------
  const TOP        = 14;                 // glyph groups shown in the tables (the most common)
  const MEASURES   = ['dOwn', 'dOtherBase', 'dSameMark', 'dOtherMark'];
  const FLOOR      = 30;                 // clearance floor (font units) seen in the data; 30 = about 0.17 of a single dot (DU ~ 180)
  const TIGHT      = 80;                 // tight marks shown (tightest first); 0 = skip the list
  const ONLY_EDITED = null;              // tight list: true = edited marks only, false = unedited only, null = both
  const OUTSIDE    = 80;                 // marks outside their letter's x-extent shown (worst first); 0 = skip the list
  const MIN_OUTSIDE = 1;                 // ... only those at least this far outside (font units)
  const GROUP      = null;               // e.g. 'sda' to look at one glyph group only (applies to the list); null = all
  const COPY       = true;               // try to copy the text of everything printed to the clipboard

  const R = globalThis.__ruleMeasure;
  if (!R) { console.warn('Run console/rule-measure.js first.'); return; }
  const { rows, dims, settings } = R, CAP = settings.CAP;
  const report = [];
  const tsv = (data) => data.length ? [Object.keys(data[0]).join('\t'), ...data.map(r => Object.values(r).join('\t'))] : [];
  const say = (title, data) => { console.log(title); if (data) { console.table(data); report.push(`## ${title}`, ...tsv(data)); } };

  const dotNames = Object.keys(dims).filter(n => /^(sdb|ddb|tdb|sda|dda|tda)(\.|$)/.test(n) && dims[n]).sort();
  say('Dot glyph sizes (w, h, area in font units; DU is taken from the single dot)', dotNames.map(n => ({ glyph: n, ...dims[n] })));

  const counts = {};
  for (const r of rows) counts[r.grp] = (counts[r.grp] || 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, TOP);
  for (const key of MEASURES) {
    const out = [];
    for (const g of top) {
      for (const ed of [false, true]) {
        const v = rows.filter(r => r.grp === g && r.edited === ed).map(r => r[key]);
        if (!v.length) continue;
        const zero = v.filter(x => x === 0).length, capped = v.filter(x => x >= CAP).length;
        out.push({ ...GlyphQuery.stats(`${g} ${ed ? 'edited' : 'unedited'}`, v),
                   'zero%': Math.round(1000 * zero / v.length) / 10, 'capped%': Math.round(1000 * capped / v.length) / 10 });
      }
    }
    say(`${key} (font units; zero% = touching, capped% = beyond ${CAP})`, out);
  }

  if (TIGHT || FLOOR) {
    const clr = (r) => {                                        // the smallest clearance and what it is to
      const c = [[r.dOwn, 'own base'], [r.dOtherBase, 'other letter'], [r.dSameMark, 'mark on same letter'], [r.dOtherMark, 'mark on other letter']];
      return c.reduce((a, b) => (b[0] < a[0] ? b : a));
    };
    const tight = rows.map(r => ({ r, c: clr(r) })).filter(x => x.c[0] < FLOOR && (ONLY_EDITED === null || x.r.edited === ONLY_EDITED))
                      .sort((a, b) => a.c[0] - b.c[0]);
    const by = {};
    for (const { r } of tight) { const o = (by[r.grp] ||= { grp: r.grp, tight: 0, edited: 0, of: counts[r.grp] }); o.tight++; if (r.edited) o.edited++; }
    say(`Marks with less than ${FLOOR} units of clearance to other ink: ${tight.length} of ${rows.length}`,
        Object.values(by).sort((a, b) => b.tight - a.tight));
    if (TIGHT) say(`The ${Math.min(TIGHT, tight.length)} tightest`,
        tight.slice(0, TIGHT).map(({ r, c }) => ({ index: r.wi + 1, word: r.word, mark: `#${r.i} ${r.name}`, on: r.on, clearance: c[0], to: c[1], edited: r.edited ? 'yes' : 'no' })));
  }
  if (OUTSIDE) {
    const out = rows.filter(r => r.hOwn >= MIN_OUTSIDE && (!GROUP || r.grp === GROUP)).sort((a, b) => b.hOwn - a.hOwn);
    const total = rows.filter(r => r.hOwn >= MIN_OUTSIDE && (!GROUP || r.grp === GROUP)).length;
    say(`Marks outside the x-extent of their own letter (hOwn >= ${MIN_OUTSIDE}): ${total} of ${rows.length}. Showing the worst ${Math.min(OUTSIDE, total)}.`,
        out.slice(0, OUTSIDE).map(r => ({ index: r.wi + 1, word: r.word, mark: `#${r.i} ${r.name}`, on: r.on, hOwn: r.hOwn,
                                          nearestOther: r.nearest, edited: r.edited ? 'yes' : 'no' })));
  }
  if (COPY) { try { if (typeof copy === 'function') { copy(report.join('\n')); console.log('Copied to the clipboard.'); } } catch (e) { /* not available */ } }
})();
