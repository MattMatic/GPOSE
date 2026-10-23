# Console snippets and GlyphQuery

The `*.js` files in this folder are **paste-into-the-DevTools-console** snippets that put words in the
Pattern List according to where glyphs are placed. They all sit on `GlyphQuery` (`js/glyph-query.js`),
which the app loads, so a new snippet is mostly its settings and one test function.

| Snippet | Finds |
|---|---|
| `nukta-division.js` | nuktas separated from their own cursive run, under the start of a REf/DALf/VAO, with free space to their left |
| `kasra-check.js` | two kinds of mark in the same x-region but vertically the wrong way round (KASRA higher than an sdb/ddb/tdb; an sda/dda/tda higher than a FATHA/DAMMA/SHADDA/HAMZA_ABOVE), by bounding-box y-mid |
| `outline-distance.js` | marks too close to each other, or too far from the base run (outline distance, with a distribution to set thresholds from) |

## Writing a snippet

```js
(async () => {
  const LIST = null, APPLY = true, MODE = 'replace';           // settings first, so they are easy to change
  return GlyphQuery.scan({
    title: 'My check', resultVar: '__myCheckHits', list: LIST, apply: APPLY, mode: MODE,
    test: (w) => {                                              // w is a PlacedWord
      for (const m of w.find(/^sdb/)) {
        if (m.box && m.box.y0 < -300) return { glyph: `#${m.i} ${m.name}`, y0: Math.round(m.box.y0) };   // a hit: one table row
      }
      return null;                                              // no hit
    },
  });
})();
```

`scan` shows the progress panel (Abort works), prints a summary and a table, keeps the result in
`GlyphQuery.last` (and `window[resultVar]`), and puts the matching words in the Pattern List
(`apply`, `mode`: `'replace'` | `'merge'` | `'subtract'`). `index` and `word` columns are added for you.

## API

All positions are **font units, y up**, in the word's left-to-right visual glyph order, with the GPOSE deltas
applied (what the main SVG draws).

**`GlyphQuery.scan({ title, test, list, apply, mode, show, resultVar })`** - returns `{ hits, words, searched, ms }`.
`list`: `null` = every word, a name (`'kerning'`, `'near'`, `'pattern'`, ...), `'active'` = the main window's list,
or an array of word indices.

**`GlyphQuery.placed(entryOrIndex)`** - a `PlacedWord`:

| Member | Meaning |
|---|---|
| `.glyphs` | array of `PlacedGlyph` in order |
| `.text`, `.index`, `.entry` | the word, its index, the word-list entry |
| `.find(re)` | glyphs whose name matches |
| `.run(i)` | cursive run id of glyph `i` (an unjoined glyph is a run of its own) |

**`PlacedGlyph`** (one per glyph in the word):

| Member | Meaning |
|---|---|
| `.i`, `.g`, `.name` | glyph index in the word, glyph id, glyph name |
| `.px`, `.py` | placed position (pen position + offset) |
| `.mark` | true if the font classes it as a mark |
| `.outline` | flattened outline (`null` if none) |
| `.box` | placed bounding box `{x0, x1, y0, y1}` of the outline (`null` if none) |
| `.base` | the glyph this mark is attached to; `.rootBase` follows mark-to-mark chains |
| `.marks` | the marks attached to this glyph |
| `.run` | this glyph's cursive run id |
| `.hasDelta` | the word has a GPOSE delta at this glyph |
| `.is(re)` | name matches the regexp |

**Relations between placed glyphs**

| Call | Result |
|---|---|
| `GlyphQuery.distance(a, b, limit)` | shortest outline-to-outline distance; 0 if they cross, touch or nest; `limit` caps the work (returned if farther) |
| `GlyphQuery.boxDistance(a, b)` | gap between bounding boxes (cheap pre-filter) |
| `GlyphQuery.overlaps(a, b)` | outlines cross, touch or nest |
| `GlyphQuery.clearance(n, others, { dir, axis, look, stopAt })` | how far `n` can slide before touching one of `others`: left (`dir: -1`) / right (`+1`) along x, or with `axis: 'y'` down (`-1`) / up (`+1`); `{ d, by }` (`d = Infinity` if free). Only glyphs in `n`'s lane (its height for x, its width for y) within `look` units are considered |

**Nearest points** - `GlyphQuery.closest(a, b, limit)` returns `{ d, a: {x,y}, b: {x,y}, dx, dy, touching, nested }` for the nearest points of two glyph outlines (`dx`, `dy` = point on b minus point on a, signed, y up), or `null` if they are further apart than `limit`. Crossing, touching and nested outlines have `d = 0` and `dx = dy = 0` (`nested` is `'a'` or `'b'` when one is inside the other). `GlyphQuery.matcher('name' | '/re/' | '!name')` is the Bulk Apply style glyph-name test used by the Proximity panel.

**Inspecting** - `GlyphQuery.describe(word)` prints a table of every glyph in a word (placed position, box, base it is attached to, cursive run, delta). `word` can be the text, an index, or nothing for the displayed word. Use it first when a snippet finds nothing you expect.

**Statistics** - `GlyphQuery.stats(name, numbers)` gives a percentile row; `GlyphQuery.printStats(row, ...)` prints a table.
Use it to choose thresholds from real data (see `outline-distance.js`).

`GlyphQuery.reset()` clears the per-glyph caches (outlines, names); call it after loading a different font.

## The Proximity panel

The **Proximity** button opens a floating panel built on `GlyphQuery.closest` (`js/proximity-panel.js`): two glyph patterns, then
ignore / less than / greater than tests (all must hold) on the nearest distance and the signed X and Y offset between the nearest
points. It scans the list selected in the main window and Replace / Add / Subtract put the matching words in the Pattern List.
Glyph 1 is the anchor and "Glyph 2 is" picks which match it is compared with: the first to its right (default), the first to its left,
the nearest by outline distance, or any (every pair). Pairs further apart than the search range count as far away. See the notes at the top of the file.

## Notes for the snippets

- Test cheap conditions first (names, boxes, indexes), then outline geometry; `scan` runs `test` for every word.
- Outlines come from the glyph's flattened field (whole numbers), so distances are accurate to about a unit.
- A test returns the **first** matching combination for a word; return an object (one row) or `null`.

## Toward a UI (draft spec)

The three snippets are the same shape: pick glyphs, relate them, filter by position and distance, put the words
in the Pattern List. That suggests one declarative rule a UI could edit, save as JSON and run with the same
machinery:

```jsonc
{
  "name": "nukta division",
  "scope": "active",                         // list to search
  "subject": { "glyph": "/^(sdb|ddb|tdb|KASRA)/" },       // the glyph a hit is reported on
  "others":  { "glyph": "/^(REf|DALf|VAO)/", "side": "right" },   // the glyph it is related to (optional)
  "where": [                                  // all must hold, cheapest first
    { "test": "x-position", "of": "others.xmin", "left-of": 0.5, "of-subject-width": true, "from": 0 },
    { "test": "y-position", "subject": "below", "mode": "entire" },
    { "test": "run", "subject-base": "different-from", "others": true },
    { "test": "free-space", "dir": "left", "min": 30, "blockers": "all except others", "look": 600 },
    { "test": "distance", "between": "subject-others", "max": 15 },
    { "test": "attached", "others": "no", "glyph": "/^KASRA/" }
  ],
  "action": { "patternList": "replace" }
}
```

What the UI needs beyond the rule editor:

- **Glyph selectors** as regexp fields with live "matches N glyphs" feedback (as the Placement panel's slots).
- **Distribution view** for distance and position measures (percentiles / histogram) so thresholds are set from
  data, not guessed; `GlyphQuery.stats` already produces the numbers.
- **Live count and preview** of how many words match, with the participating glyphs highlighted in the SVG
  (rows should therefore carry glyph indices, as the snippet rows do: `#3 sdb`).
- **Step-through** of hits (the Pattern List does this), and merge / subtract against the existing Pattern List.
- **Save / load** of rules as JSON, and "copy as snippet" for the console.
- **Performance guard:** an Abort button (the progress panel has one), a list selector to narrow the search,
  and ordering tests so cheap ones run first.

Open questions for the spec: which tests are pair tests (need an "others" glyph) and which are single-glyph
tests; whether a rule may have several "others"; and whether "free space" blockers should be a glyph regexp,
a glyph class or both.
