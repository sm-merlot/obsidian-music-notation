# Music Notation (Obsidian plugin)

Write and render **staff notation, guitar tab, chords and lyrics in one sheet** —
multi-track, from a plain-text code block — inside Obsidian.

Powered by [alphaTab](https://github.com/CoderLine/alphaTab). Fills the gap that no
existing Obsidian plugin renders [alphaTex](https://alphatab.net/docs/alphatex/introduction)
text from a code block (existing alphaTab plugins are file-based `.gp` viewers).

## Usage

Put alphaTex inside a fenced `alphatab` block:

````markdown
```alphatab
\title "Song"
\tempo 80
.
:8 (5.5 7.3 7.2) 7.4 (7.3 7.2) 7.4 | (2.5 4.3 3.2) 4.4 (4.3 3.2) 4.4 |
```
````

Multi-track (one staff per part):

````markdown
```alphatab
\track "Guitar"
:4 0.3 2.3 3.3 0.2 |
\track "Bass"
\clef F4
:4 0.4 0.4 2.4 2.4 |
```
````

## Status

Early scaffold. Core flow: code-block processor → `alphaTab.AlphaTabApi.tex()` → SVG render.

Open items:
- Bundle Bravura SMuFL font into the plugin folder and verify `core.fontDirectory`
  resolves in Obsidian's Electron sandbox.
- Main-thread layout (`useWorkers = false`) — confirm performance on long scores.
- Optional playback (soundfont) — off by default.
- Mobile support — unverified.

## Development

```bash
npm install
npm run dev      # watch build -> main.js
npm run build    # type-check + production bundle
```

Symlink or copy `main.js`, `manifest.json`, `styles.css` (and the `font/` dir) into
`<vault>/.obsidian/plugins/music-notation/`.

## License

MIT
