# Placement scatter

The **Placement** button (next to *JSON Editor*) opens a floating panel that shows how **one glyph**
(or a family of glyphs) is placed across every word in a list, grouped by context. Use it to see the
whole distribution at once, spot the odd ones out, and send them to the Pattern List.

Drag the title bar to move it; resize from the bottom-right corner.

## Reading the charts

- One strip chart per metric you tick: `dy`, `dx`, `ax`, `abs dy` (HarfBuzz position + delta) and
  `dy vs base` (a mark's absolute dy minus its base's).
- **X = group** (see *Group by*), **Y = the value**. One **bubble per distinct value** in a group;
  bigger = more occurrences.
- **Colour** = the worst traffic-light rating among the words in the bubble
  (green OK, yellow Maybe, orange Kerning, red Near, purple Collision). A small bubble in a red
  colour is a very good candidate.
- A **blue ring** marks the bubble(s) containing the word you are currently looking at.
- Hover a bubble for the count, rating breakdown and example words.
- Words with no delta count as 0, so the "normal" bubble is usually at 0.

| Gesture | Effect |
|---|---|
| Click a bubble / column label | Select it |
| Ctrl/Shift/Cmd + click | Toggle it in the selection |
| Shift + drag | Select everything in a rectangle (add Ctrl to add to the selection) |
| Click empty space | Clear the selection |
| Drag | Pan |
| Shift + scroll | Zoom about the cursor |
| Double-click empty space | Reset that chart's zoom (**Reset zoom** resets all) |
| Double-click a bubble | Jump to one of its words (repeat to cycle); the word you left goes into History |

Zoom resets itself when you change the group, sort or metrics.

## Choosing what is plotted

**List** - the same lists as Bulk Apply (All / Collision / Near / Kerning / Maybe / Pattern / Edited,
with counts). It starts on whichever list is selected in the main window.

**Glyph in current word** - which glyph of the displayed word the *= word* and *family* fields
below are taken from (`*` = it has a delta).

**TARGET and context slots (-3 ... +3)** - the glyph being plotted and the glyphs around it, in
glyph order (nearest first). Each slot has a mode:

| Mode | Meaning |
|---|---|
| `any` | No test |
| `= word` | The exact glyph at that position in the current word |
| `≈ family` | Its family: the name without the trailing number, e.g. `BEi15` becomes `/^BEi\d+$/` |
| `custom` | Whatever you type (set automatically when you type in the box) |

The box accepts a glyph name, a `/regexp/` (`/^[sdt]da/` plots `sda`, `dda` and `tda` together), or a
leading `!` to invert (`!BEi1`).

**follow word** - when you move to another word, the *= word* / *family* slots are re-taken from it
and the chart re-plots (the target keeps looking at the same kind of glyph where it can). `custom`
slots are never changed. Untick it to keep the plot fixed while you step through words. Jumping to a
word *from the chart* never changes the plot.

**Max gap** - glyphs allowed between context glyphs, exactly as Bulk Apply's *Max Gap*. With a gap,
"-1" means the nearest glyph that matched. A blank slot between two filled ones is a wildcard.

The chart re-plots by itself when you change a control or edit the displayed word. After a
Bulk Apply changes other words, press **Plot**.

## Group by, Sort, emphasis

**Group by** chooses the columns:

| Group | Use it to see... |
|---|---|
| Previous / next glyph *family* | Whether placement depends on the neighbouring letter (the usual first look) |
| Previous / next glyph, 2 before | Which specific variant within a family differs |
| Two previous families | Longer context |
| Forms around (i m f) | Initial / medial / final shapes around the glyph |
| **Base height** | The mark's base height (absolute dy of the base), exactly |
| **Base height tier** | The same, rounded to a multiple of the *tier* box (default 100) |
| None | One column: the plain distribution |

**Sort** orders the columns: *by value* (median of the first metric, which shows the staircase),
*by outlierness* (share of the column that is *not* on its most common value, with `(n off)` added
to each label), *by count* or *by name* (numeric for the height groupings).

**Emphasise outliers** fades every bubble that holds more than N% (default 15) of its column, and
prints the value beside the rest. Columns with fewer than 5 occurrences are never treated as outliers.

## Narrowing down to the real outliers

1. **Start wide.** TARGET `= word` (or a `/regexp/` for several glyphs), every context slot `any`,
   list = All or Kerning. Group by *Previous glyph family*, Sort *by outlierness*, tick
   *Emphasise outliers*. The faded view leaves only the labelled minority bubbles, and the
   most inconsistent columns come first.
2. **Look for two kinds of oddity.** A small labelled bubble away from its column's main bubble
   (one word differs from its peers), or a whole column whose main bubble is out of line with its
   neighbours (a family or context that was missed by a bulk edit).
3. **Split the suspect column.** Set slot -1 to `≈ family` and change *Group by* to
   *Previous glyph* to see which variant differs (`BEi3` vs `BEi15`). Then try *Next glyph*,
   *2 before* or *Forms around*. Whichever grouping makes the column collapse to one bubble per
   column is what the placement depends on.
4. **Take height out of the picture.** In Nastaliq the mark's height follows the base's height, so
   a wide spread in `dy` is often normal. Group by *Base height tier* and tick `dy` and
   `dy vs base`: within one tier `dy` should be nearly constant, so what is left is a real outlier.
   If a tier column is mixed, narrow the tier size (e.g. 50) or add a context slot.
5. **Narrow the list instead of the context.** Select suspects, click **Replace** on the Pattern
   List, then switch *List* to **Pattern** and plot again. Repeat to home in; **Add** and
   **Subtract** let you build up or prune the set. The main window's counts follow.
6. **Use the ring.** Double-click a labelled bubble to open one of its words and check it by eye.
   Untick *follow word* while you step through, so the plot stays put.
7. **Allow for marks in between.** If an unrelated mark sits between a base and the glyph you
   care about, raise *Max gap* to 1.

## Sending the selection on

The selection line shows the occurrences, words and values selected; the word list below it is
clickable.

- **Pattern List - Replace / Add / Subtract** acts on the *words* of the selection, with the same
  meaning as Bulk Apply's plain / Ctrl / Shift click.
- **Make pattern** builds a Bulk Apply pattern that reproduces the selection: your context fields,
  plus the context implied by the *Group by* you used, plus a value test (`dy:-40`, `dy:@-130` for
  abs dy, `dy:b-80` for dy vs base) when every selected occurrence shares the value. Tick
  *include context shared by all selected* to add any other slot whose glyph is identical across
  the selection.
- **Preview matches** runs the pattern over the plotted list and reports how many words it hits that
  you did *not* select (and any selected words it misses). Check this before applying.
- **Open in Bulk Apply** fills the Bulk Apply dialog (with the Max Gap) and runs *Find Matches*. To
  correct values, set the right delta on the current word and mark the glyph with `*` as usual.

Limits to know about:

- Base height cannot be tested by a pattern, so a height grouping is not part of a generated
  pattern (a note says so); use Preview matches to see what else it catches.
- If several different values are selected, no value test is added; the pattern then matches the
  context whatever the value.
- "No delta" and an explicit 0 look the same in the chart. A zero selection becomes `dy:!*`
  (no delta), which will not match an explicit 0.
- A non-mark glyph is treated as its own base for the base-height groupings.
- The *Pattern* list option is disabled while the Pattern List is empty.
