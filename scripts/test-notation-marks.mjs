// A: (articulations, effects), D: (dynamics, hairpins) and T: (text) rows in
// mode: notation. Checks the parsed model, the MusicXML and that Verovio
// draws them.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseNotation } from "../src/dsl/parse-notation.js";
import { notationToMusicXML } from "../src/dsl/notation-to-musicxml.js";

let fail = 0;
const check = (name, ok, extra = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};

// unit 1/8, 4/4. Treble rows top→bottom: F5 line, E5, D5 line, C5, B4 line,
// A4, G4 line, F4, E4 line.
const src = `mode: notation
clef: treble
key: C
unit: 1/8

T: |hit this HARD
H: |C7       F7
   |--------|--------|
   |        |        |
   |--------|--------|
   |x_      |        |
   |--------|--------|
   |  x_    |        |
   |----x_--|x_______|
   |      x_|        |
   |--------|--------|
A: |>.  fall|U
A: |  ^
D: |mf<-----|-    pp
`;
const model = parseNotation(src);
const evs = model.parts[0].bars.flatMap((b) => b.events);
const notes = evs.filter((e) => !e.rest);
check("4 + 1 notes", notes.length === 5, String(notes.length));
check("accent + staccato on 1", JSON.stringify(notes[0].marks?.arts) === '["accent","staccato"]', JSON.stringify(notes[0].marks));
check("marcato on 2", notes[1].marks?.arts?.[0] === "strong-accent", JSON.stringify(notes[1].marks));
check("fall on 3", notes[2].marks?.effects?.[0] === "falloff", JSON.stringify(notes[2].marks));
check("fermata on 5", notes[4].marks?.arts?.[0] === "fermata", JSON.stringify(notes[4].marks));
check("mf on 1", notes[0].dynamic === "mf");
check("crescendo from 2", notes[1].wedgeStart === "crescendo", JSON.stringify(notes[1]));
check("crescendo ends in bar 2", notes[4].wedgeStop === true);
check("text on 1", notes[0].words?.[0] === "hit this HARD", JSON.stringify(notes[0].words));
const xml = notationToMusicXML(model);
for (const tag of ["<accent/>", "<staccato/>", "<strong-accent/>", "<falloff/>", "<fermata", "<dynamics><mf/>", '<wedge type="crescendo"/>', '<wedge type="stop"/>', "<words>hit this HARD</words>"])
	check(`xml has ${tag}`, xml.includes(tag));

const VerovioModule = await createVerovioModule();
const tk = new VerovioToolkit(VerovioModule);
tk.setOptions({ adjustPageHeight: true, pageWidth: 1200 });
check("verovio loads it", tk.loadData(xml));
const svg = tk.renderToSVG(1);
for (const cls of ["artic", "dynam", "hairpin", "dir", "fermata"])
	check(`svg draws ${cls}`, svg.includes(`class="${cls}`), "");

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
