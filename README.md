# GPOSE
GPOS Editor: Client-based web tool to edit position data to establish a reference for font engineers

# Live
https://mattmatic.github.io/GPOSE

# Concept
This tool provides a consistent method for evaluating a font against a large word list.

A "Font Force Field" JSON file specifies how near and far each glyph is allowed to be.
This tool sifts the words into several 'bins' to allow a linguist to move the individual
glyphs into the correct place.

Pattern matching algorithms make bulk search-and-replace very simple.

The end result is a large JSON file that specifies which glyphs should move and by how much.

This work flow is significantly faster than finding an error, engineering the change into the font,
and then testing and refining the font... change... by... change. This approach allows a very fast
way of defining how the words should be rendered.

# Further work
The JSON `GPOSE` file can be used as a human reference.

However, the goal is to use automated algorithms to distil the GPOSE file into GPOS contextual
substitution rules that can be emitted as a .fea for inclusion in the font build.
