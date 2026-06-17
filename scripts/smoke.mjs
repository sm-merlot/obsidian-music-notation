// Headless smoke test: exercises the same Verovio code path the plugin uses
// (verovio/wasm module factory + verovio/esm toolkit) on both input formats.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes>
      <divisions>1</divisions><key><fifths>2</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>TAB</sign><line>5</line></clef>
      <staff-details number="2"><staff-lines>6</staff-lines></staff-details>
    </attributes>
    <harmony><root><root-step>D</root-step></root><kind>major</kind></harmony>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><lyric><syllabic>begin</syllabic><text>Ka</text></lyric></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><lyric><syllabic>end</syllabic><text>tie</text></lyric></note>
    <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <backup><duration>4</duration></backup>
    <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff><notations><technical><string>5</string><fret>5</fret></technical></notations></note>
    <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff><notations><technical><string>4</string><fret>7</fret></technical></notations></note>
  </measure></part>
</score-partwise>`;

const ABC = `X:1
M:4/4
K:D
"D" D E F A | "G" G A B c |
w: Ka-tie don't cry now`;

function assert(cond, msg) {
	if (!cond) {
		console.error("FAIL:", msg);
		process.exitCode = 1;
	} else {
		console.log("PASS:", msg);
	}
}

const module = await createVerovioModule();
const tk = new VerovioToolkit(module);
console.log("verovio toolkit ready");

for (const [name, data, fmt] of [
	["musicxml", MUSICXML, "musicxml"],
	["abc", ABC, "abc"],
]) {
	tk.setOptions({
		inputFrom: fmt,
		scale: 40,
		adjustPageHeight: true,
		pageWidth: 2000,
		header: "none",
		footer: "none",
		breaks: "auto",
		svgViewBox: true,
	});
	const loaded = tk.loadData(data);
	const pages = tk.getPageCount();
	const svg = loaded && pages > 0 ? tk.renderToSVG(1) : "";
	assert(loaded, `${name}: loadData returned true`);
	assert(pages > 0, `${name}: page count ${pages} > 0`);
	assert(svg.includes("<svg"), `${name}: SVG produced (${svg.length} bytes)`);
	assert(/class="note"/.test(svg), `${name}: SVG contains rendered notes`);
}

console.log(process.exitCode ? "SMOKE FAILED" : "SMOKE OK");
