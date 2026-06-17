// End-to-end headless test: DSL tab -> MusicXML -> Verovio SVG -> strip notation.
// Run in a pod with linkedom installed (for the DOM strip step).
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { DOMParser } from "linkedom";
import { tabSrcToMusicXML, stripNotationStaff } from "../../src/dsl/pipeline.js";

const SRC = `mode: tab
meter: 4/4
unit: 1/32
tuning: e B G D A E

[Verse]
L: Ka-tie  don't   cry     I       know            you're  try-ing your    har-    dest
e: --------------------------------|--------------------------------|--------------------------------|--------------------------------
B: 7-------7-------7-------7-------|7-------7-----------------------|3-------3-------3-------3-------|--------------------------------
G: 7-------7-------7-------7-------|7-------7-------6-------6-------|4-------4-------4-------4-------|6-------6-------6-------6-------
D: ----7-------7-------7-------7---|----7-------7---7-------7-------|----4-------4-------4-------4---|7-------7-------7-------7-------
A: 5-------------------------------|5-------------------7-------7---|2-------------------------------|----7-------7-------7-------7---
E: --------------------------------|----------------5---------------|--------------------------------|5-------------------------------`;

const xml = tabSrcToMusicXML(SRC);

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
	breaks: "auto",
	spacingStaff: 2,
});
const ok = tk.loadData(xml);
const svgStr = ok ? tk.renderToSVG(1) : "";

const doc = new DOMParser().parseFromString(svgStr, "image/svg+xml");
const svg = doc.documentElement;

const count = (sel) => svg.querySelectorAll(sel).length;
const words = ["Ka", "tie", "don't", "cry", "know", "har", "dest"];
const beforeNotes = count("g.note");
const beforeStaves = count("g.staff");
const beforeVerse = count("g.verse");

stripNotationStaff(svg);
const out = svg.outerHTML;

const lyricsKept = words.filter((w) => out.includes(w));
// after strip, the first staff in each measure should have no noteheads/paths
let staff1Notes = 0;
let staff1Paths = 0;
svg.querySelectorAll("g.measure").forEach((m) => {
	const staves = Array.from(m.children).filter((c) =>
		(c.getAttribute("class") || "").split(/\s+/).includes("staff")
	);
	if (staves.length < 2) return;
	staff1Notes += staves[0].querySelectorAll("g.notehead").length;
	staff1Paths += staves[0].querySelectorAll("path").length;
});

console.log("loaded:", ok, "pages:", tk.getPageCount());
console.log("before  -> staves:", beforeStaves, "notes:", beforeNotes, "verses:", beforeVerse);
console.log("lyrics kept after strip:", lyricsKept.join(",") || "(none)");
console.log("tab markup present:", /tabGrp|tabDurSym/.test(out));
console.log("staff1 leftover noteheads:", staff1Notes, "paths:", staff1Paths);
const pass =
	ok &&
	lyricsKept.length >= 4 &&
	/tabGrp|tabDurSym/.test(out) &&
	staff1Notes === 0 &&
	staff1Paths === 0;
console.log(pass ? "PIPELINE OK" : "PIPELINE FAIL");
process.exitCode = pass ? 0 : 1;
