// Does Verovio 6.2 render lyrics attached to notes on a *bare TAB staff*?
// FINDINGS said no (hand-written XML). Re-test with well-formed MusicXML before
// committing the tab-mode architecture.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const tuning = [
	["E", 2, 1],
	["A", 2, 2],
	["D", 3, 3],
	["G", 3, 4],
	["B", 3, 5],
	["E", 4, 6],
].map(
	([s, o, l]) =>
		`<staff-tuning line="${l}"><tuning-step>${s}</tuning-step><tuning-octave>${o}</tuning-octave></staff-tuning>`
).join("");

const note = (step, oct, str, fret, lyric) =>
	`<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>2</duration><type>quarter</type>` +
	`<notations><technical><string>${str}</string><fret>${fret}</fret></technical></notations>` +
	(lyric ? `<lyric><syllabic>single</syllabic><text>${lyric}</text></lyric>` : "") +
	`</note>`;

// Bare TAB staff, 4 quarter notes, each with a lyric syllable.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
 <part id="P1"><measure number="1">
  <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
   <clef><sign>TAB</sign><line>5</line></clef>
   <staff-details><staff-lines>6</staff-lines>${tuning}</staff-details>
  </attributes>
  ${note("D", 3, 5, 5, "Ka")}
  ${note("A", 3, 4, 7, "tie")}
  ${note("D", 4, 3, 7, "dont")}
  ${note("G", 3, 4, 5, "cry")}
 </measure></part>
</score-partwise>`;

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
tk.setOptions({
	inputFrom: "musicxml",
	scale: 40,
	adjustPageHeight: true,
	pageWidth: 2000,
	pageHeight: 60000,
	header: "none",
	footer: "none",
});
const ok = tk.loadData(xml);
const svg = ok ? tk.renderToSVG(1) : "";
const hasTab = /<g[^>]*class="(tabGrp|tabNote|tabDurSym)"/.test(svg) || /TAB|tab/.test(svg);
const verses = (svg.match(/class="(verse|lyric|syl)"/g) || []).length;
const words = ["Ka", "tie", "dont", "cry"].filter((w) => svg.includes(`>${w}<`) || svg.includes(w));
console.log("loaded:", ok, "pages:", tk.getPageCount());
console.log("has tab markup:", hasTab);
console.log("lyric/verse/syl elements:", verses);
console.log("lyric words found in SVG:", words);
console.log("LYRICS ON TAB:", verses > 0 && words.length > 0 ? "YES" : "NO");
console.log("log:", tk.getLog());
