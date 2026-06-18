# Music Notation (Obsidian plugin)

Render **staff notation, guitar tab, chords and lyrics in one sheet** — multi-stave,
from a plain-text code block — inside Obsidian.

Powered by [Verovio](https://www.verovio.org). The WASM engine (with its SMuFL music
font) is bundled into the plugin, so rendering is self-contained, offline, and leaves
no watermark.

## Usage

### `music` — friendly DSL (recommended)

A `music` block with a short directive header. `mode: tab` engraves a guitar tab from
an ASCII grid (each column = the declared `unit`), with an `L:` lyric row and a `H:`
chord row (chord symbols, incl. jazz extensions like `Cmaj7#11`, `Cm7b5`, `G/B`). Both
rows align by column — type them above the grid; tokens snap to the nearest note. The
tab reflows to screen width.

````markdown
```music
mode: tab
meter: 4/4
unit: 1/32
tuning: E A D G B e

H: D                               G
L:  Ka-tie  don't   cry
e:  --------------------------------|--------------------------------
B:  7-------7-------7-------7-------|7-------7-----------------------
G:  7-------7-------7-------7-------|7-------7-------6-------6-------
D:  ----7-------7-------7-------7---|----7-------7---7-------7-------
A:  5-------------------------------|5-------------------7-------7---
E:  --------------------------------|----------------5---------------
```
````

Between two frets on a string you can write a **connector** (dashes around it are
fine, e.g. `2-s-3`): `h` hammer-on, `p` pull-off, `s` slide, and `^` tie — e.g.
`7h9`, `9p7`, `2s3`, `7^7`. The h/p/s show as a small letter in the gap between the
two frets; a tie also lets you hold a note across a slot to line lyrics up.
Consecutive eighths (or shorter) are beamed by beat automatically.

A literal **space** is padding — it widens the grid for the eye (room for a long
lyric word or a 10+ fret) but does **not** advance the beat (only `-` and notes do).

Each digit is its own note (a column is a time slot), so `333` = three notes. For a
fret of 10 or more, end it with `)` — which groups the last two digits: `12)3` =
fret twelve then three; `312)` = fret three then twelve.

`mode: chords` is a chord-over-lyric sheet: `H:` chord rows over `L:` lyric rows
(column-aligned). It renders as HTML that **wraps word-by-word with each chord glued
above its word**, so it stays aligned at any width — and chord symbols get nice ♯/♭
and superscript extensions. Chord-only lines (intros) and `[Section]` labels work too.

**Chord diagrams** (both modes): add `chord NAME …` lines in the header and a strip of
fretboard diagrams renders at the top. Frets are low-E→high-e (matching `tuning:`),
`x` = muted, `0` = open — e.g. `chord D = x x 0 2 3 2`, `chord Em = 0 2 2 0 0 0`, or
compact `chord C = x32010`.

`mode: notation` is an **ASCII staff** you draw: rows of `-` are the 5 staff lines,
blank rows between are spaces, and each row is one pitch step (anchored by `clef:` +
`key:`). A note is `x` (natural-in-key), `#`, `b` or `n` at its row+column; `_`
sustains it (duration); `|` = barline; `[Section]` separates staves. `L:` lyrics and
`H:` chords render on the staff. It engraves to real notation (jazz lead sheets,
vocal/piano).

````markdown
```music
mode: notation
clef: treble
key: C
unit: 1/4

----|----
    |    
----|----
    |   x
----|--x-
    | x  
----|x---
   x|    
--x-|----
 x  |    
x   |    
```
````
(a C-major scale: each row is a pitch step; bottom drawn line = E4 in treble.)

**Triplets / tuplets** — bracket a group with `n( … )` (bare `(` = a triplet). Triplet
notes can't land on exact power-of-two columns, so the bracket **quantises** the notes
inside to even tuplet slots: its **interior width = the played length** of the group,
and the notes within (on any row — a melodic triplet across pitches works) snap to that
many equal divisions. The count digit + parens are zero-time annotation.

Pick a fine `unit:` so the length is expressible — at `unit: 1/16` a quaver triplet is
4 columns wide (one crotchet), a crotchet triplet is 8 (one minim) — and you can mix
both in a bar:

````markdown
```music
mode: notation
unit: 1/16

3(----)              quaver triplet (4 cols = 1 crotchet)
    x
   x
  x
```
````
(three pitches snapped to an eighth-note triplet; widen the bracket to 8 for a crotchet
triplet.)

The count is generic: `5( … )` is a quintuplet (5 in the time of 4), `6(…)`, `7(…)` etc.
all work — pick a `unit:` fine enough to draw that many noteheads in the span.

**Transpose (per sheet)** — add `transpose:` to the header of a `chords` or `notation`
block and it shifts everything: write the chart in concert pitch, set `transpose: Bb`
and a trumpet player reads it in their key. Value is an **instrument** (`Bb`, `Eb`,
`F`), **semitones** (`2`, `-3`), or an **interval** (`M2`, `P5`, `-m3`). In `notation`
the staff pitches and chord symbols both move; in `chords` the chord names move.
(Chord *diagrams* and `tab` grids are not transposed — their frets are literal.)

A **Transpose dropdown** also sits above every chords/notation sheet — pick a key
there to re-render the view on the fly (it starts at the block's `transpose:` and
doesn't change the note).

### `music-verovio` — raw escape hatch

Put **MusicXML** or **ABC** inside a fenced `music-verovio` block. The format is
auto-detected (ABC tunes start with an `X:` header; everything else is treated as
MusicXML).

ABC:

````markdown
```music-verovio
X:1
M:4/4
K:D
"D" D E F A | "G" G A B c |
w: Ka-tie don't cry
```
````

MusicXML (excerpt — exact frets, multi-stave, lyrics all expressible):

````markdown
```music-verovio
<score-partwise version="4.0">
  ...
</score-partwise>
```
````

## Status

**Phase 1: the render engine.** Verovio runs inside Obsidian; the code block accepts
raw MusicXML or ABC. The score is themed to the active light/dark colors.

Planned next: a friendly text format that compiles to MusicXML (so you don't hand-write
XML), guitar chord diagrams, and hiding the notation staff on tab charts. See
`notes/.../music-notation-system/` for the design.

## Development

```bash
npm install
npm run dev      # watch build -> main.js
npm run build    # type-check + production bundle
```

Symlink or copy `main.js`, `manifest.json`, `styles.css` into
`<vault>/.obsidian/plugins/music-notation/`. (No font dir needed — Verovio embeds it.)

## License

MIT
