// End-to-end headless test: DSL tab -> per-section MusicXML -> Verovio -> strip.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { DOMParser } from "linkedom";
import { tabSrcToSections, stripNotationStaff } from "../../src/dsl/pipeline.js";

const SRC = `mode: tab
meter: 4/4
unit: 1/32
tuning: e B G D A E

[Verse]
L: Ka-tie  don't   cry     I       know            you're  try-ing your    har-    dest
B: 7-------7-------7-------7-------|7-------7-----------------------|3-------3-------3-------3-------|--------------------------------
G: 7-------7-------7-------7-------|7-------7-------6-------6-------|4-------4-------4-------4-------|6-------6-------6-------6-------
D: ----7-------7-------7-------7---|----7-------7---7-------7-------|----4-------4-------4-------4---|7-------7-------7-------7-------
A: 5-------------------------------|5-------------------7-------7---|2-------------------------------|----7-------7-------7-------7---
E: --------------------------------|----------------5---------------|--------------------------------|5-------------------------------

[Chorus]
L: Lets not pre-tend
B: 7-------7-------7-------7-------|7-------7-----------------------
G: 7-------7-------7-------7-------|7-------7-------6-------6-------
D: ----7-------7-------7-------7---|----7-------7---7-------7-------
A: 5-------------------------------|5-------------------7-------7---
E: --------------------------------|----------------5---------------`;

const { sections } = tabSrcToSections(SRC);
const labels = sections.map((s) => s.label);

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
let fail = 0;

console.log("section labels:", JSON.stringify(labels));
if (labels.join(",") !== "Verse,Chorus") {
	console.log("FAIL: expected [Verse, Chorus]");
	fail++;
}

const VLINE = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s+L\s*(-?[\d.]+)\s+(-?[\d.]+)/;
sections.forEach((sec) => {
	tk.setOptions({ inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none", breaks: "auto", pageMarginLeft: 50, pageMarginRight: 50, spacingStaff: 2 });
	const ok = tk.loadData(sec.xml);
	const svg = new DOMParser().parseFromString(ok ? tk.renderToSVG(1) : "", "image/svg+xml").documentElement;
	const verses = svg.querySelectorAll("g.verse").length;
	stripNotationStaff(svg);
	const out = svg.outerHTML;
	let leftover = 0;
	let tabTop = Infinity;
	const m0 = svg.querySelectorAll("g.measure")[0];
	(m0 ? Array.from(m0.children).filter((c) => (c.getAttribute("class") || "").split(/\s+/).includes("staff"))[1] : null)
		?.querySelectorAll("path").forEach((p) => { const x = (p.getAttribute("d") || "").match(VLINE); if (x && Math.abs(+x[2] - +x[4]) < 1) tabTop = Math.min(tabTop, +x[2]); });
	let overhang = 0;
	const checkV = (p) => { const x = (p.getAttribute("d") || "").match(VLINE); if (!x) return; const lo = Math.min(+x[2], +x[4]); if (lo < tabTop - 1) overhang = Math.max(overhang, tabTop - lo); };
	svg.querySelectorAll("g.barLine path").forEach(checkV);
	svg.querySelectorAll("g.system").forEach((s) => Array.from(s.children).forEach((c) => { if (c.tagName === "path") checkV(c); }));
	svg.querySelectorAll("g.measure").forEach((m) => {
		const st = Array.from(m.children).filter((c) => (c.getAttribute("class") || "").split(/\s+/).includes("staff"));
		if (st.length >= 2) leftover += st[0].querySelectorAll("g.notehead, path").length;
	});
	const mnum = svg.querySelectorAll("g.mNum").length;
	const tab = /tabGrp|tabDurSym/.test(out);
	const good = ok && verses > 0 && tab && leftover === 0 && overhang < 2 && mnum === 0;
	if (!good) fail++;
	console.log(`  [${sec.label}] load=${ok} verses=${verses} tab=${tab} leftover=${leftover} barlineOverhang=${overhang} mNum=${mnum} ${good ? "OK" : "FAIL"}`);
});

console.log(fail ? "\nPIPELINE FAIL" : "\nPIPELINE OK");
process.exitCode = fail ? 1 : 0;
