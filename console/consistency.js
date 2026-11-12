// "consistency" - GPOSE console snippet (paste into the browser DevTools console on the GPOSE page).
// SELF-CONTAINED: the whole check is in this file (section "engine"), so changing it never needs a reload or a
// rebuild of the app. It only needs the app's globals: wordList, hbs, GlyphQuery, PlacementCore, progressPanel,
// setPatternList. (js/consistency-check.js in the project is an older copy and is not used by this snippet.)
//
// Finds placements that disagree with how the same glyph is placed in the same context across the word list.
// Every glyph counts, edited or not: the value compared is the final placement (HarfBuzz + GPOSE delta).
//   - marks: dx and dy from the glyph they are attached to, judged separately
//   - bases: advance (ax)
// A group of placements that still disagrees with itself is split by a second context (REFINE), so a rule you applied
// to a narrow case is found, and the words in that case that were not corrected show up as outliers.
// ONLY = 'missed' lists placements nobody edited (possible missed corrections); 'edited' = edited ones (possible wrong).
// Flagged words go to the Pattern List, best first. Results: window.__consistency (.rows .groups .subjects .rules);
// window.__cc.peers(n) shows the values behind word-row n; window.__cc.explain(index) shows the raw numbers for one word.
(async () => {
  // ---- settings ---------------------------------------------------------------------------------
  const LIST       = null;      // null = every word, 'kerning' etc = a named list, 'active' = main window
  const MARKS      = true;      // check marks
  const BASES      = false;     // check base glyph advances (noisy: see notes)
  const SUBJECTS   = null;      // regexp on glyph names, e.g. /^(sdb|ddb|tdb)/ ; null = all
  const ONLY       = 'missed';  // 'missed' | 'edited' | null (both)
  const MIN_USUAL_EDITED = 0.5; // with ONLY = 'missed': the usual value must be mostly set by your edits (else it is HarfBuzz/Gulzar's own choice)
  const REFINE     = true;      // split groups that still disagree with themselves by a second context
  const TOLERANCE  = 10;        // marks: values within this many units count as the same
  const MIN_DIFF   = 60;        // marks: ignore differences smaller than this (x and y are judged separately)
  const BASE_TOL   = 30;        // bases: tolerance
  const BASE_MIN_DIFF = 150;    // bases: minimum difference
  const MIN_CONSENSUS = 0.6;    // only judge groups where the usual value covers at least this share
  const MIN_GROUP  = 10;        // smaller groups are not judged
  const MAX_SHARE  = 0.15;      // flag a value held by at most this share of its group
  const TIER       = 100;       // height band size (font units)
  const BY_GROUP   = true;      // print one row per finding (subject + context + value) instead of one per word
  const SHOW       = 60;        // rows printed
  const LIMIT      = 2000;      // most words sent to the Pattern List (best first); 0 = all
  const APPLY      = true;      // false = report only, leave the Pattern List alone
  const MODE       = 'replace'; // Pattern List: 'replace' | 'merge' | 'subtract'

  // ---- engine -----------------------------------------------------------------------------------
  const ConsistencyCheck = (() => {
    const DEFAULTS = {
      list: null,          // null = every word, 'kerning' etc = a named list, 'active' = the main window's list, or indices
      marks: true,         // check marks (offset from the glyph they are attached to)
      bases: true,         // check base glyphs (advance)
      subjects: null,      // regexp on the glyph name: only check these glyphs (null = all)
      tolerance: 10,       // marks: values within this many units of each other count as the same
      baseTolerance: 30,   // bases (advances): the same, for advances
      minConsensus: 0.6,   // only judge a group whose usual value is held by at least this share of it
      only: null,          // null = all, 'missed' = only placements nobody edited, 'edited' = only edited ones
      limit: 2000,         // most words put in the Pattern List (best scores first); all rows stay in the results
      minGroup: 10,        // groups with fewer occurrences are not judged
      minDiff: 60,         // marks: ignore differences smaller than this (a mark's x and y are judged separately)
      baseMinDiff: 150,    // bases: the same, for advances
      minUsualEdited: 0.5, // with only: 'missed', judge a group only if its usual value was mostly set by edits (else HarfBuzz/Gulzar chose it)
      minExplained: 3,     // refine: a smaller group counts as explained if it has at least this many words, all one value,
      maxCategories: 6,    //   and the context has at most this many values (a feature like 'has a KASRA', not a glyph identity)
      refine: true,        // split a group that still disagrees with itself by a second context (one or two glyphs further out)
      axes: true,          // judge a mark's dx and dy separately (a mark can be at the right height but too far left)
      byGroup: true,       // print one row per context and value (the words behind it are in .rows) instead of one row per word
      maxShare: 0.15,      // flag a value held by at most this share of its group
      tier: 100,           // height band size, font units
      costSmall: 0.25,     // context choice: cost of each occurrence left in a group too small to judge
      costGroup: 0.5,      // context choice: cost of each group
      rulesShare: 0.8,     // a group whose usual value comes from edits at least this often is listed as a rule candidate
      show: 60,            // rows printed
      apply: true,         // put the flagged words in the Pattern List
      mode: 'replace',     // Pattern List: 'replace' | 'merge' | 'subtract'
      quiet: false,
    };

    // Context variants. For a mark the neighbours are its base's neighbours and the height is its base's height;
    // for a base the left neighbour is the next glyph in the cursive run or the next run (to its left), which is
    // what its advance depends on. The first variant is the plainest; ties go to the earlier one.
    const MARK_CONTEXTS = [
      { id: 'base only',             key: () => '' },
      { id: 'left family',           key: (c) => c.lf },
      { id: 'left glyph',            key: (c) => c.l },
      { id: 'right family',          key: (c) => c.rf },
      { id: 'base height',           key: (c) => c.t },
      { id: 'left family + height',  key: (c) => `${c.lf} ${c.t}` },
      { id: 'left + right family',   key: (c) => `${c.lf} | ${c.rf}` },
    ];
    const BASE_CONTEXTS = [
      { id: 'glyph only',                 key: () => '' },
      { id: 'left family',                key: (c) => c.lf },
      { id: 'left glyph',                 key: (c) => c.l },
      { id: 'left family + left height',  key: (c) => `${c.lf} ${c.lt}` },
      { id: 'left glyph + left height',   key: (c) => `${c.l} ${c.lt}` },
    ];
    // Second-level contexts: only used to split a group the first level could not explain
    const MARK_EXTRA = [
      { id: 'right glyph',             key: (c) => c.r },
      { id: 'left + right glyph',      key: (c) => `${c.l} | ${c.r}` },
      { id: 'left2 + left family',     key: (c) => `${c.l2f} < ${c.lf}` },
      { id: 'right + right2 family',   key: (c) => `${c.rf} > ${c.r2f}` },
      { id: 'left2 family',            key: (c) => c.l2f },
      { id: 'right2 family',           key: (c) => c.r2f },
      { id: 'left glyph + right family', key: (c) => `${c.l} | ${c.rf}` },
      { id: 'left family + right glyph', key: (c) => `${c.lf} | ${c.r}` },
      { id: 'right marks',             key: (c) => c.rm },
      { id: 'left marks',              key: (c) => c.lm },
      { id: 'left + right marks',      key: (c) => `${c.lm} | ${c.rm}` },
      { id: 'left family + right marks', key: (c) => `${c.lf} | ${c.rm}` },
      { id: 'right family + right marks', key: (c) => `${c.rf} | ${c.rm}` },
      { id: 'marks on the same base',  key: (c) => c.sm },
      { id: 'marks on this mark',      key: (c) => c.km },
      { id: 'left family + marks on this mark',  key: (c) => `${c.lf} | ${c.km}` },
      { id: 'right family + marks on this mark', key: (c) => `${c.rf} | ${c.km}` },
    ];
    const BASE_EXTRA = [
      { id: 'right family',            key: (c) => c.rf },
      { id: 'left + right family',     key: (c) => `${c.lf} | ${c.rf}` },
      { id: 'left2 + left family',     key: (c) => `${c.l2f} < ${c.lf}` },
      { id: 'right glyph',             key: (c) => c.r },
      { id: 'right marks',             key: (c) => c.rm },
      { id: 'left + right marks',      key: (c) => `${c.lm} | ${c.rm}` },
    ];
    const MARK_ALL = [...MARK_CONTEXTS, ...MARK_EXTRA], BASE_ALL = [...BASE_CONTEXTS, ...BASE_EXTRA];
    const NCTX = Math.max(MARK_ALL.length, BASE_ALL.length);

    // ---- compact storage -------------------------------------------------------------------------------------------

    class Grow {   // amortised-doubling Int32Array
      constructor(n = 1 << 16) { this.a = new Int32Array(n); this.n = 0; }
      push(v) {
        if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; }
        this.a[this.n++] = v;
      }
      get(i) { return this.a[i]; }
    }
    class Intern {   // string <-> small integer
      constructor() { this.ids = new Map(); this.strs = []; }
      id(s) {
        let i = this.ids.get(s);
        if (i === undefined) { i = this.strs.length; this.strs.push(s); this.ids.set(s, i); }
        return i;
      }
    }

    const cheb = (a1, b1, a2, b2) => Math.max(Math.abs(a1 - a2), Math.abs(b1 - b2));
    const vkey = (a, b) => `${a},${b}`;

    // ---- occurrence extraction (pure: tested with stubs) -------------------------------------------------------------

    /**
     * The checkable occurrences in one placed word (PlacementCore.placeWord result).
     * Returns [{ gi, ri, kind: 'mark'|'base', subject, a, b, ctx: { l, lf, r, rf, t, lt }, edit }]
     *   a, b   the value: mark (dx, dy) from its ref; base (ax, 0)
     *   edit   0 none, 1 this glyph has a delta, 2 its ref (base) has one, 3 both
     */
    function occurrencesOf(word, opts) {
      const { fam, tierOf } = PlacementCore;
      const gs = word.glyphs;
      const out = [];
      const nm = (j) => (j >= 0 ? gs[j].name : '^');
      const marksOn = [];                                              // glyph index -> names of the marks attached to it
      for (const r of gs) if (r.mark && r.ref >= 0) (marksOn[r.ref] || (marksOn[r.ref] = [])).push(r.name);
      const mk = (j) => (j >= 0 && marksOn[j] ? marksOn[j].slice().sort().join('+') : '-');
      for (const r of gs) {
        if (r.ignorable) continue;
        if (opts.subjects && !opts.subjects.test(r.name)) continue;
        if (r.mark) {
          if (!opts.marks || r.ref < 0) continue;
          const ref = gs[r.ref];
          const anchor = ref.mark ? gs[ref.ref] ?? ref : ref;          // a mark on a mark: neighbours of the root base
          const lf = fam(nm(anchor.left)), rf = fam(nm(anchor.right));
          const subject = `${r.name} @ ${ref.name}${r.attached ? '' : ' (not attached)'}`;
          const dx = Math.round(r.x - ref.x), dy = Math.round(r.y - ref.y);
          const side = (j, k) => (j >= 0 ? gs[j][k] : -1);
          const ctx = { l: nm(anchor.left), lf, r: nm(anchor.right), rf, t: String(tierOf(anchor.y, opts.tier)), lt: '',
                        l2f: fam(nm(side(anchor.left, 'left'))), r2f: fam(nm(side(anchor.right, 'right'))),
                        lm: mk(anchor.left), rm: mk(anchor.right), sm: mk(anchor.i), km: mk(r.i) };
          const edit = (r.hasDelta ? 1 : 0) | (ref.hasDelta ? 2 : 0);
          if (opts.axes) {
            out.push({ gi: r.i, ri: ref.i, kind: 'markx', subject: `${subject} [x]`, a: dx, b: 0, ctx, edit });
            out.push({ gi: r.i, ri: ref.i, kind: 'marky', subject: `${subject} [y]`, a: dy, b: 0, ctx, edit });
          } else {
            out.push({ gi: r.i, ri: ref.i, kind: 'mark', subject, a: dx, b: dy, ctx, edit });
          }
        } else {
          if (!opts.bases || r.left < 0) continue;                    // the leftmost base: its advance changes nothing
          const L = gs[r.left];
          out.push({
            gi: r.i, ri: -1, kind: 'base', subject: r.name,
            a: Math.round(r.ax), b: 0,
            ctx: { l: L.name, lf: fam(L.name), r: nm(r.right), rf: fam(nm(r.right)), t: '', lt: String(tierOf(L.y, opts.tier)),
                   l2f: fam(nm(L.left)), r2f: fam(nm(r.right >= 0 ? gs[r.right].right : -1)),
                   lm: mk(r.left), rm: mk(r.right), sm: mk(r.i), km: '-' },
            edit: r.delta.ax ? 1 : 0,
          });
        }
      }
      return out;
    }

    // ---- grouping and judging (pure) -------------------------------------------------------------------------------

    /**
     * Summarise one group: values: Map vkey -> { a, b, n, edited }.
     * Returns { n, mode: {a,b}, support(a,b), modeSupport, modeEdited }
     */
    function judgeGroup(values, tol) {
      const vs = [...values.values()];
      let n = 0;
      for (const v of vs) n += v.n;
      const support = (a, b) => {
        let s = 0;
        for (const u of vs) if (cheb(a, b, u.a, u.b) <= tol) s += u.n;
        return s;
      };
      let best = null, bestS = -1;
      for (const v of vs) {
        const s = support(v.a, v.b);
        // ties: the more common exact value, then the one nearer zero (no movement)
        if (s > bestS || (s === bestS && (v.n > best.n || (v.n === best.n && Math.abs(v.a) + Math.abs(v.b) < Math.abs(best.a) + Math.abs(best.b))))) {
          best = v; bestS = s;
        }
      }
      let modeEdited = 0;
      for (const u of vs) if (cheb(best.a, best.b, u.a, u.b) <= tol) modeEdited += u.edited;
      return { n, mode: { a: best.a, b: best.b }, modeSupport: bestS, modeEdited, support };
    }

    /** Cost of explaining a subject's occurrences with one context variant (lower is better). */
    function variantCost(groups, o, tol = o.tolerance) {
      let off = 0, small = 0;
      for (const values of groups.values()) {
        let n = 0;
        for (const v of values.values()) n += v.n;
        if (n < o.minGroup) { small += n; continue; }
        const j = judgeGroup(values, tol);
        off += n - j.modeSupport;
      }
      return off + o.costSmall * small + o.costGroup * groups.size;
    }

    // ---- the run ----------------------------------------------------------------------------------------------------

    async function run(settings = {}) {
      const o = { ...DEFAULTS, ...settings };
      const t0 = performance.now();
      const info = PlacementCore.glyphInfo(hbs);
      const indices = GlyphQuery.listIndices(o.list);
      const subj = new Intern(), ctx = new Intern();
      // one row per occurrence
      const S = new Grow(), WI = new Grow(), GI = new Grow(), RI = new Grow(), A = new Grow(), B = new Grow(), E = new Grow();
      const C = Array.from({ length: NCTX }, () => new Grow());
      const kindOf = [];                                      // subject id -> 'mark' | 'base'
      const pp = globalThis.progressPanel;
      if (pp) await pp.start(indices.length, 'Consistency: reading words', true);
      let searched = 0, unshaped = 0, aborted = false;
      try {
        for (let k = 0; k < indices.length; k++) {
          if (pp) { await pp.setProgress(k); if (pp.aborted()) { aborted = true; break; } }
          const wi = indices[k];
          const word = PlacementCore.placeWord(wordList.get(wi), info);
          if (!word) { unshaped++; continue; }
          searched++;
          for (const oc of occurrencesOf(word, o)) {
            const sid = subj.id(oc.subject);
            kindOf[sid] = oc.kind;
            const variants = oc.kind !== 'base' ? MARK_ALL : BASE_ALL;
            S.push(sid); WI.push(wi); GI.push(oc.gi); RI.push(oc.ri); A.push(oc.a); B.push(oc.b); E.push(oc.edit);
            for (let v = 0; v < NCTX; v++) C[v].push(v < variants.length ? ctx.id(variants[v].key(oc.ctx)) : -1);
          }
        }
      } finally {
        if (pp) await pp.done();
      }
      const total = S.n;

      // Bucket the occurrences by subject (counting sort)
      const nSubj = subj.strs.length;
      const start = new Int32Array(nSubj + 1);
      for (let i = 0; i < total; i++) start[S.get(i) + 1]++;
      for (let s = 0; s < nSubj; s++) start[s + 1] += start[s];
      const order = new Int32Array(total);
      const fill = start.slice(0, nSubj);
      for (let i = 0; i < total; i++) order[fill[S.get(i)]++] = i;

      // A group that still disagrees with itself: try each second-level context and keep the one that explains it best
      const refine = (values, v1, c1, tol, variants) => {
        let n = 0;
        for (const e of values.values()) n += e.n;
        const label1 = `${variants[v1].id}: ${ctx.strs[c1] || '-'}`;
        const whole = [{ label: label1, sel: [[v1, c1]], values }];
        if (!o.refine || n < 2 * o.minGroup) return whole;
        const off0 = n - judgeGroup(values, tol).modeSupport;
        if (off0 < Math.max(3, o.minGroup / 2)) return whole;
        const occs = [];
        for (const e of values.values()) for (const i of e.occ) occs.push(i);
        let best = null, bestCost = off0 + o.costGroup - Math.max(3, 0.25 * off0);
        for (let v2 = 1; v2 < variants.length; v2++) {
          if (v2 === v1) continue;
          const sub = new Map();
          for (const i of occs) {
            const c2 = C[v2].get(i);
            let vals = sub.get(c2);
            if (!vals) sub.set(c2, vals = new Map());
            const a = A.get(i), b = B.get(i), key = vkey(a, b);
            let e = vals.get(key);
            if (!e) vals.set(key, e = { a, b, n: 0, edited: 0, occ: [] });
            e.n++; if (E.get(i)) e.edited++;
            e.occ.push(i);
          }
          let off = 0, small = 0;
          for (const vals of sub.values()) {
            let m = 0;
            for (const e of vals.values()) m += e.n;
            const jj = judgeGroup(vals, tol);
            if (m < o.minGroup) {
              if (m >= o.minExplained && sub.size <= o.maxCategories && jj.modeSupport === m) continue;   // small, uniform, few categories: explained
              small += m; continue;
            }
            off += m - jj.modeSupport;
          }
          const cost = off + 0.5 * small + o.costGroup * sub.size;
          if (cost < bestCost) { bestCost = cost; best = { v2, sub }; }
        }
        if (!best) return whole;
        return [...best.sub].map(([c2, vals]) => ({
          label: `${label1} > ${variants[best.v2].id}: ${ctx.strs[c2] || '-'}`, sel: [[v1, c1], [best.v2, c2]], values: vals,
        }));
      };

      const groupsOf = (s, v) => {     // ctx id -> Map vkey -> { a, b, n, edited, occ: [] }
        const g = new Map();
        for (let k = start[s]; k < start[s + 1]; k++) {
          const i = order[k];
          const c = C[v].get(i);
          let values = g.get(c);
          if (!values) g.set(c, values = new Map());
          const a = A.get(i), b = B.get(i), key = vkey(a, b);
          let e = values.get(key);
          if (!e) values.set(key, e = { a, b, n: 0, edited: 0, occ: [] });
          e.n++; if (E.get(i)) e.edited++;
          e.occ.push(i);
        }
        return g;
      };

      if (pp) await pp.start(nSubj, 'Consistency: judging', true);
      const flags = [], subjects = [], rules = [];
      try {
        for (let s = 0; s < nSubj; s++) {
          if (pp) { await pp.setProgress(s); if (pp.aborted()) { aborted = true; break; } }
          const variants = kindOf[s] !== 'base' ? MARK_ALL : BASE_ALL;
          const nLevel1 = kindOf[s] !== 'base' ? MARK_CONTEXTS.length : BASE_CONTEXTS.length;
          let bestV = 0, bestCost = Infinity, bestGroups = null;
          for (let v = 0; v < nLevel1; v++) {
            const groups = groupsOf(s, v);
            const tol = kindOf[s] !== 'base' ? o.tolerance : o.baseTolerance;
            const cost = variantCost(groups, o, tol);
            if (cost < bestCost) { bestCost = cost; bestV = v; bestGroups = groups; }
          }
          const tol = kindOf[s] !== 'base' ? o.tolerance : o.baseTolerance;
          let judged = 0, offTotal = 0, flagged = 0;
          const leaves = [];
          for (const [c, values] of bestGroups) leaves.push(...refine(values, bestV, c, tol, variants));
          for (const leaf of leaves) {
            const values = leaf.values;
            let n = 0;
            for (const e of values.values()) n += e.n;
            if (n < o.minGroup) continue;
            judged++;
            const j = judgeGroup(values, tol);
            offTotal += n - j.modeSupport;
            let groupEdited = 0;
            for (const e of values.values()) groupEdited += e.edited;
            if (j.modeEdited >= o.rulesShare * j.modeSupport && j.modeEdited > 0) {
              rules.push({ subject: subj.strs[s], context: leaf.label, n,
                           usual: show(kindOf[s], j.mode.a, j.mode.b), editedShare: Math.round(100 * j.modeEdited / j.modeSupport) });
            }
            if (j.modeSupport < o.minConsensus * n) continue;     // no usual value: nothing to be an outlier from
            const usualEdited = Math.round(100 * j.modeEdited / j.modeSupport);
            if (o.only === 'missed' && j.modeEdited < o.minUsualEdited * j.modeSupport) continue;   // usual value is HarfBuzz's own: unedited outliers are Gulzar's contextual choices
            // spread: how far the group's other values sit from the usual one (typical, by occurrence)
            const devs = [];
            for (const e of values.values()) devs.push([cheb(e.a, e.b, j.mode.a, j.mode.b), e.n]);
            devs.sort((x, y) => x[0] - y[0]);
            let half = n / 2, mad = 0;
            for (const [d, c] of devs) { half -= c; if (half <= 0) { mad = d; break; } }
            for (const e of values.values()) {
              const diff = cheb(e.a, e.b, j.mode.a, j.mode.b);
              if (diff <= tol || diff < (kindOf[s] === 'base' ? o.baseMinDiff : o.minDiff)) continue;
              const share = j.support(e.a, e.b) / n;
              if (share > o.maxShare) continue;
              // distance in units of the group's own spread, group size, and how dominant the usual value is
              const z = diff / (tol + mad);                         // not capped: big outliers must rank above small ones
              const score = Math.round(10 * z * (1 - share) * Math.min(1, Math.log2(n) / 6) * (j.modeSupport / n));
              for (const i of e.occ) {
                if (o.only === 'missed' && E.get(i)) continue;     // only words nobody edited
                if (o.only === 'edited' && !E.get(i)) continue;    // only edited words
                flagged++;
                flags.push({ i, s, label: leaf.label, sel: leaf.sel, n, share, diff, score, mode: j.mode,
                             peersEdited: Math.round(100 * groupEdited / n), usualEdited });
              }
            }
          }
          subjects.push({ subject: subj.strs[s], kind: kindOf[s], occurrences: start[s + 1] - start[s],
                          context: variants[bestV].id, groups: leaves.length, judged, off: offTotal, flagged });
        }
      } finally {
        if (pp) await pp.done();
      }

      flags.sort((x, y) => y.score - x.score || y.diff - x.diff || WI.get(x.i) - WI.get(y.i));
      const rows = flags.map((f, k) => {
        const i = f.i, wi = WI.get(i), gi = GI.get(i), ri = RI.get(i), e = E.get(i);
        const kind = kindOf[f.s];
        const entry = wordList.get(wi);
        const names = entry?.hb;
        const gname = names ? info.nameOf(names[gi].g) : '?';
        return {
          flag: k + 1, index: wi + 1, word: entry?.getWord?.() ?? '',
          glyph: `#${gi} ${gname}`, on: ri >= 0 && names ? `#${ri} ${info.nameOf(names[ri].g)}` : '',
          context: f.label,
          value: show(kind, A.get(i), B.get(i)), usual: show(kind, f.mode.a, f.mode.b), diff: f.diff,
          group: f.n, share: `${Math.round(100 * f.share)}%`,
          edit: ['none', 'this glyph', 'base', 'both'][e], peersEdited: `${f.peersEdited}%`, usualEdited: `${f.usualEdited}%`, score: f.score,
        };
      });
      // One row per (subject, context, value): the words that share an outlier are one finding, not many
      const groupsOut = new Map();
      flags.forEach((f, k) => {
        const r = rows[k], key = `${f.s}|${f.label}|${r.value}`;
        let g = groupsOut.get(key);
        if (!g) groupsOut.set(key, g = { subject: subj.strs[f.s], context: r.context, value: r.value, usual: r.usual, diff: r.diff,
                                        group: r.group, words: 0, never: 0, usualEdited: r.usualEdited, score: 0, _sum: 0, examples: [] });
        g.words++; g._sum += f.score; if (r.edit === 'none') g.never++;
        if (g.examples.length < 3) g.examples.push(`${r.index} ${r.word}`);
      });
      const groupRows = [...groupsOut.values()].map(g => {
        g.score = Math.round((g._sum / g.words) * Math.log2(1 + g.words)); delete g._sum;
        g.examples = g.examples.join(' | '); return g;
      }).sort((x, y) => y.score - x.score);
      rules.sort((x, y) => y.n - x.n);
      subjects.sort((x, y) => y.flagged - x.flagged || y.occurrences - x.occurrences);

      const ms = Math.round(performance.now() - t0);
      const allWords = [...new Set(rows.map(r => r.index - 1))];
      const words = o.limit > 0 ? allWords.slice(0, o.limit) : allWords;
      const result = { rows, groups: groupRows, subjects, rules, words, searched, unshaped, occurrences: total, aborted, ms, settings: o,
                       _data: { flags, S, WI, GI, A, B, E, C, start, order, subj, ctx, kindOf } };
      api.last = result;
      globalThis.__consistency = result;

      if (!o.quiet) {
        const nNone = rows.filter(r => r.edit === 'none').length;
        console.log(`Consistency: ${rows.length} placements flagged in ${allWords.length} words ` +
                    `(${nNone} never edited: possibly missed; ${rows.length - nNone} edited: possibly wrong). ` +
                    `${searched} words, ${total} glyph occurrences, ${nSubj} glyph subjects, ${ms} ms` +
                    (unshaped ? `, ${unshaped} words not shaped` : '') + (aborted ? ' - ABORTED, results incomplete' : '') + '.');
        console.log(`${groupRows.length} distinct findings (subject + context + value).`);
        console.table((o.byGroup ? groupRows : rows).slice(0, o.show));
        console.log(`Full results in window.__consistency (.rows, .subjects, .rules). __cc.peers(n) shows the group behind flag n; __cc.explain(index) shows the raw numbers for a word. ` +
                    `${rules.length} groups whose usual value comes mostly from edits are in .rules (candidates for a font rule).`);
      }
      if (o.apply && words.length && typeof setPatternList === 'function') {
        setPatternList(words, o.mode);
        if (!o.quiet) console.log(`Pattern List ${o.mode === 'replace' ? 'replaced with' : o.mode === 'merge' ? 'merged with' : 'minus'} ${words.length} of ${allWords.length} words, highest score first. Select "Pattern" in the main list to step through them.`);
      }
      return result;
    }

    function show(kind, a, b) { return kind === 'mark' ? `${a},${b}` : String(a); }   // markx / marky / base: one number

    /** Every value in the group behind flag n (1-based), with counts and up to 3 example words each. */
    function peers(n, result = api.last) {
      const f = result?._data?.flags?.[n - 1];
      if (!f) { console.warn(`No flag ${n}.`); return null; }
      const d = result._data;
      const values = new Map();
      for (let k = d.start[f.s]; k < d.start[f.s + 1]; k++) {
        const i = d.order[k];
        if (!f.sel.every(([v, c]) => d.C[v].get(i) === c)) continue;
        const a = d.A.get(i), b = d.B.get(i), key = vkey(a, b);
        let e = values.get(key);
        if (!e) values.set(key, e = { value: show(d.kindOf[f.s], a, b), count: 0, edited: 0, examples: [] });
        e.count++; if (d.E.get(i)) e.edited++;
        if (e.examples.length < 3) e.examples.push(`${d.WI.get(i) + 1} ${wordList.get(d.WI.get(i))?.getWord?.() ?? ''}`);
      }
      const rows = [...values.values()].sort((x, y) => y.count - x.count);
      const row = result.rows[n - 1];
      console.log(`Flag ${n}: ${row.glyph} in "${row.word}" (word ${row.index}), ${d.subj.strs[f.s]}, ${row.context}. ` +
                  `This word: ${row.value}; usual: ${row.usual}.`);
      console.table(rows.map(r => ({ ...r, examples: r.examples.join(' | ') })));
      return rows;
    }

    /** Why a mark has the number it has: raw HarfBuzz offsets, the base's, the GPOSE delta, and the result. n = the word's list number (the "index" column). */
    function explain(n) {
      const entry = wordList.get(n - 1);
      if (!entry?.hb) { console.warn(`No shaped word ${n}.`); return null; }
      const info = PlacementCore.glyphInfo(hbs), pw = PlacementCore.placeWord(entry, info);
      const rows = [];
      for (const r of pw.glyphs) {
        if (!r.mark || r.ref < 0) continue;
        const ref = pw.glyphs[r.ref], hbm = entry.hb[r.i], hbb = entry.hb[r.ref];
        rows.push({ mark: `#${r.i} ${r.name}`, on: `#${r.ref} ${ref.name}`, 'HB dx,dy (mark)': `${hbm.dx},${hbm.dy}`,
                    'HB dx,dy (base)': `${hbb.dx},${hbb.dy}`, 'GPOSE delta': `${r.delta.dx},${r.delta.dy}`,
                    'value x,y (mark - base, with delta)': `${Math.round(r.x - ref.x)},${Math.round(r.y - ref.y)}` });
      }
      console.log(`Word ${n}: ${entry.getWord?.() ?? ''}`);
      console.table(rows);
      return rows;
    }

    const api = { run, peers, explain, DEFAULTS, MARK_CONTEXTS, BASE_CONTEXTS, MARK_EXTRA, BASE_EXTRA, last: null,
                  _test: { occurrencesOf, judgeGroup, variantCost } };
    return api;
  })();

  globalThis.__cc = ConsistencyCheck;
  return ConsistencyCheck.run({
    list: LIST, marks: MARKS, bases: BASES, subjects: SUBJECTS, only: ONLY, refine: REFINE, minUsualEdited: MIN_USUAL_EDITED,
    tolerance: TOLERANCE, minDiff: MIN_DIFF, baseTolerance: BASE_TOL, baseMinDiff: BASE_MIN_DIFF,
    minConsensus: MIN_CONSENSUS, minGroup: MIN_GROUP, maxShare: MAX_SHARE, tier: TIER,
    byGroup: BY_GROUP, show: SHOW, limit: LIMIT, apply: APPLY, mode: MODE,
  });
})();
