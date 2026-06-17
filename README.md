# Music Notation (Obsidian plugin)

Render **staff notation, guitar tab, chords and lyrics in one sheet** — multi-stave,
from a plain-text code block — inside Obsidian.

Powered by [Verovio](https://www.verovio.org). The WASM engine (with its SMuFL music
font) is bundled into the plugin, so rendering is self-contained, offline, and leaves
no watermark.

## Usage

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
