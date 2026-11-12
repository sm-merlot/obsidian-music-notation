// Ties across barlines in mode: notation. A `_` sustain that runs past `|`
// splits the note at each barline into tied notes (MusicXML <tie>/<tied>).
// Checks the parsed model, the emitted MusicXML and that Verovio draws ties.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseNotation } from "../src/dsl/parse-notation.js";
import { notationToMusicXML, stripTieContAccids, TIE_CONT_PREFIX } from "../src/dsl/notation-to-musicxml.js";

let fail = 0;
const check = (name, ok, extra = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};

// unit 1/4, 4/4: bar = 4 columns. Treble: row 3 = C5, row 5 = A4, row 7 = F4.
const staff = (r3, r5, r7) => `mode: notation
clef: treble
key: C
unit: 1/4

----|----|----
    |    |
----|----|----
${r3}
----|----|----
${r5}
----|----|----
${r7}
----|----|----
`;
const sig = (ev) =>
	ev.rest ? `r${ev.durFrac}` : ev.notes.map((n) => `${n.step}${n.alter === 1 ? "#" : ""}${n.octave}${n.tieStop ? "<" : ""}${n.tieStart ? ">" : ""}`).join("+") + `:${ev.durFrac}`;
const run = (src) => {
	const model = parseNotation(src);
	return { model, got: model.parts[0].bars.map((b) => b.events.map(sig).join(" ")) };
};
const expect = (name, got, want) => check(name, got.join(" | ") === want.join(" | "), got.join(" | "));

// 1) chord (two rows, same column) held into bar 2; the C# accidental is not redrawn
const chord = run(staff("#___|__  |    ", "x___|__  |    ", "    |    |    "));
expect("chord tied across one barline", chord.got, ["C#5>+A4>:1", "C#5<+A4<:0.5 r0.5", "r1"]);

// 2) one note held across two barlines, then a fresh note
const multi = run(staff("    |    |    ", "    |    |    ", "x___|____|__ x"));
expect("note tied across two barlines", multi.got, ["F4>:1", "F4<>:1", "F4<:0.5 r0.25 F4:0.25"]);

// 3) plain sustain stopping at the barline: unchanged, no ties
const plain = run(staff("    |    |    ", "    |    |    ", "x___|x_  |    "));
expect("no `_` after `|` -> no ties", plain.got, ["F4:1", "F4:0.5 r0.5", "r1"]);

// 4) opening barline + tie
const open = run(`mode: notation
clef: treble
unit: 1/4

|----|----|
|    |    |
|----|----|
|    |    |
|----|----|
|    |    |
|----|----|
|  x_|_   |
|----|----|
`);
expect("opening barline + tie", open.got, ["r0.5 F4>:0.5", "F4<:0.25 r0.75"]);

const xmlOf = (m) => notationToMusicXML(m);
const count = (x, re) => (x.match(re) || []).length;
for (const [name, m, n] of [["chord", chord.model, 2], ["multi", multi.model, 2]]) {
	const xml = xmlOf(m);
	const st = count(xml, /<tie type="start"\/>/g), sp = count(xml, /<tie type="stop"\/>/g), td = count(xml, /<tied type="start"\/>/g);
	check(`${name}: MusicXML ${n} tie start/stop pairs`, st === n && sp === n && td === n, `start=${st} stop=${sp} tied=${td}`);
}
// the continuation repeats the typed accidental (so Verovio can close the tie)
// and is tagged for the renderer to strip that glyph via an MEI round-trip
check("chord: C# continuation tagged + accidental repeated", count(xmlOf(chord.model), new RegExp(`<note id="${TIE_CONT_PREFIX}`, "g")) === 1 && count(xmlOf(chord.model), /<accidental>sharp<\/accidental>/g) === 2);
check("multi: un-accidentalled tie not tagged", !xmlOf(multi.model).includes(TIE_CONT_PREFIX));
check("plain: no ties emitted", !/<tie/.test(xmlOf(plain.model)));

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
tk.setOptions({ inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none" });
// mirrors main.ts renderSvg: load MusicXML, then (if tagged) strip + reload MEI
const render = (xml) => {
	tk.setOptions({ inputFrom: "musicxml", transpose: "", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none" });
	let ok = tk.loadData(xml);
	if (ok && xml.includes(`id="${TIE_CONT_PREFIX}`)) {
		tk.setOptions({ inputFrom: "mei", transpose: "" });
		ok = tk.loadData(stripTieContAccids(tk.getMEI()));
	}
	const mei = ok ? tk.getMEI() : "";
	return { ok, mei, svg: ok ? tk.renderToSVG(1) : "" };
};
const sharpKey = run(staff("    |    |    ", "#___|____|_   ", "    |    |    "));
for (const [name, m, n, sharps] of [["chord", chord.model, 2, 1], ["multi", multi.model, 2, 0], ["sharp over 2 barlines", sharpKey.model, 2, 1]]) {
	const { ok, mei, svg } = render(xmlOf(m));
	const t = count(svg, /class="tie"/g);
	const open = count(mei, /<tie [^>]*\/>/g) - count(mei, /<tie [^>]*endid=/g);
	const drawn = count(svg, /<use[^>]*#E262/g);
	check(`${name}: Verovio draws ${n} closed ties, ${sharps} sharp glyph(s)`, ok && t === n && open === 0 && drawn === sharps, `ties=${t} open=${open} sharps=${drawn}`);
}

console.log(fail ? "\nTIES FAIL" : "\nTIES OK");
process.exitCode = fail ? 1 : 0;
