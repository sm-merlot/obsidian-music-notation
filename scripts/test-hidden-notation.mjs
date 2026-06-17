// Goal: tab staff + lyrics, no visible notation staff.
// Approach: 2 staves — staff 1 (G clef) carries lyrics on INVISIBLE notes
// (print-object="no"); staff 2 is the TAB. Then we'd strip staff 1's lines in
// the SVG. Here we just probe what Verovio emits so we can plan the strip.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const v1 = (step, alter, oct, lyric) =>
	`<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${oct}</octave></pitch>` +
	`<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>` +
	`<lyric><syllabic>single</syllabic><text>${lyric}</text></lyric></note>`;
const v1hidden = (step, alter, oct, lyric) =>
	`<note print-object="no"><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${oct}</octave></pitch>` +
	`<duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>` +
	`<lyric><syllabic>single</syllabic><text>${lyric}</text></lyric></note>`;
const v2 = (step, oct, str, fret) =>
	`<note><pitch><step>${step}</step><octave>${oct}</octave></pitch>` +
	`<duration>2</duration><voice>2</voice><type>quarter</type><staff>2</staff>` +
	`<notations><technical><string>${str}</string><fret>${fret}</fret></technical></notations></note>`;

function build(hidden) {
	const n1 = hidden ? v1hidden : v1;
	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
 <part id="P1"><measure number="1">
  <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
   <staves>2</staves>
   <clef number="1"><sign>G</sign><line>2</line></clef>
   <clef number="2"><sign>TAB</sign><line>5</line></clef>
   <staff-details number="2"><staff-lines>6</staff-lines></staff-details>
  </attributes>
  ${n1("D", 0, 4, "Ka")}${n1("E", 0, 4, "tie")}${n1("F", 1, 4, "dont")}${n1("A", 0, 4, "cry")}
  <backup><duration>8</duration></backup>
  ${v2("D", 3, 5, 5)}${v2("A", 3, 4, 7)}${v2("D", 4, 3, 7)}${v2("G", 3, 4, 5)}
 </measure></part>
</score-partwise>`;
}

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
for (const hidden of [false, true]) {
	tk.setOptions({ inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none" });
	tk.loadData(build(hidden));
	const svg = tk.renderToSVG(1);
	const staves = (svg.match(/class="staff"/g) || []).length;
	const words = ["Ka", "tie", "dont", "cry"].filter((w) => svg.includes(w));
	const notes = (svg.match(/class="note"/g) || []).length;
	console.log(`\n--- print-object="no": ${hidden} ---`);
	console.log("staff groups:", staves, "| visible notes:", notes, "| lyric words:", words.join(",") || "(none)");
}
