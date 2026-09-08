Changes
-------
# 2026-09-07
- Fixed Apply Mined Rules dropping the automatic base-to-mark correction HarfBuzz applies at render time
- Fixed Apply Mined Rules mismatching glyphs that should be ignored (ZWNJ etc.) during matching
+ Added a progress bar (with Abort) to "Find Zero-Delta Words" and "Apply to Pattern List"
- Fixed "Paste from Clipboard" being very slow on large word lists
* ZIP export no longer includes a pointless advance value on each word's last glyph

# 2026-09-06
+ Added "Apply Mined Rules" - load a GPOS Pattern Miner rules file and apply it straight to the Pattern List
+ Added "Download for GPOS Pattern Miner" to the Pattern List menu
* Moved "Find Zero-Delta Words" into the Bulk Apply dialog; now searches whichever Source List is selected
- Fixed "←" (RTL) patterns not matching, due to a corrupted character in the pattern parser

# 2026-09-04
+ Added "g" prefix to delta patterns - filter marks by how far they sit from their base's bounding box

# 2026-09-03
+ Added "@" and "b" prefixes to delta patterns - match absolute position, or position relative to a mark's base

# 2026-09-01
+ Added "!" (NOT) and range filters to delta pattern matching

# 2026-08-31
- Fixed quality stats not refreshing after rejecting a Bulk Apply change
+ Added "Force changes" checkbox to Bulk Apply
- Fixed Bulk Apply resolving the wrong source word's delta

# 2026-08-20
+ Added duplicate glyph sequence finder for the Pattern List
- Fixed Pattern List losing its order when populated or navigated

# 2026-08-13
- Fixed a crash on glyphs with an empty outline
- Sped up collision detection

# 2026-03-12
+ Before/After display

# 2026-03-11
+ Drop down choice of adjustments is now sorted
+ Keyboard shortcuts for "Bulk Apply" (Alt-B), "Find" (Alt-F), and "Apply" (Alt-A)

# 2026-03-05
- Fixed performance of adding words
- Fixed stats update
* Changed to 1-based index
+ Added "Download" of selected list
+ Added touch double tap for loading files (iPad etc)
+ Added drag-drop/right-click/double-tap on the plain word rendering - lets you load an alternative font for viewing

# 2026-02-26
- Fixed typo bug with the 'bar' option in the JSON file (e.g. for Bengali)
- Fixed 'bar' logic


# 2026-02-24
+ Added the yellow "island" circle next to the `ax` field
+ Sifted real KERNING from MAYBE by taking account of the x and y separation of bounding boxes
+ Added hex Unicode values for the word
