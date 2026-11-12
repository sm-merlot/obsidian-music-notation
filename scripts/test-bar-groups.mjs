// Bar grouping (`bars: 4/8`): forced line breaks every N bars, pick-up bar not
// counted. Renders through Verovio and counts bars per system.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { parseNotation } from "../src/dsl/parse-notation.js";
import { notationToMusicXML } from "../src/dsl/notation-to-musicxml.js";
import { tabSrcToSections } from "../src/dsl/pipeline.js";
import { parseBarGroups, barsDirective, hasPickup, applyBarGroups, minBarsPerLine, chooseGroup } from "../src/dsl/bar-groups.js";

let fail = 0;
const check = (name, ok, extra = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};

check("parse 4/8", JSON.stringify(parseBarGroups("4/8")) === "[8,4]");
check("parse auto", parseBarGroups("auto").length === 0);
check("parse 4", JSON.stringify(parseBarGroups(" 4 ")) === "[4]");
check("directive", barsDirective("mode: tab\nbars: 3/6\n") === "3/6");

// unit 1/4 in 4/4 -> 4 columns per bar; notes on the F4 row (x)
const notation = (bars, pickup) => {
	const widths = [pickup ? 1 : 4, ...Array(bars - 1).fill(4)];
	const row = (f) => widths.map((w) => f(w)).join("|");
	const dash = row((w) => "-".repeat(w));
	const gap = row((w) => " ".repeat(w));
	const notes = row((w) => "x" + " ".repeat(w - 1));
	return `mode: notation\nclef: treble\nunit: 1/4\n\n${dash}\n${gap}\n${dash}\n${gap}\n${dash}\n${gap}\n${dash}\n${notes}\n${dash}\n`;
};

const vm = await createVerovioModule();
const tk = new VerovioToolkit(vm);
const perSystem = (svg) =>
	svg.split(/<g\b[^>]*class="system"/).slice(1).map((s) => (s.match(/<g\b[^>]*class="measure\b/g) || []).length);

function render(xml, px, groups) {
	const opts = { inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: Math.round((px * 100) / 40), pageHeight: 60000, breaks: "auto", header: "none", footer: "none", pageMarginLeft: 50, pageMarginRight: 50 };
	tk.setOptions(opts);
	tk.loadData(xml);
	const pickup = hasPickup(xml);
	const fit = minBarsPerLine(tk.renderToSVG(1), pickup);
	const size = chooseGroup(groups, fit);
	if (size) {
		tk.setOptions({ breaks: "encoded" });
		tk.loadData(applyBarGroups(xml, size, pickup));
	}
	return { size, fit, counts: perSystem(tk.renderToSVG(1)) };
}

for (const pickup of [false, true]) {
	const xml = notationToMusicXML(parseNotation(notation(18, pickup)));
	check(`hasPickup=${pickup}`, hasPickup(xml) === pickup);
	for (const px of [300, 700, 2000]) {
		const r = render(xml, px, [8, 4]);
		const body = r.counts.slice(0, -1).map((c, i) => (i === 0 && pickup ? c - 1 : c));
		const ok = r.size === 0 || body.every((c) => c === r.size);
		check(`notation pickup=${pickup} px=${px}`, ok, `fit=${r.fit} size=${r.size} systems=${JSON.stringify(r.counts)}`);
	}
}

// tab: 12 plain bars
const bar = "--0-----";
const tab = `mode: tab\n\n` + ["e", "B", "G", "D", "A", "E"].map((s) => `${s}|${Array(12).fill(bar).join("|")}|`).join("\n") + "\n";
const { sections } = tabSrcToSections(tab);
for (const px of [400, 1600]) {
	const r = render(sections[0].xml, px, [8, 4]);
	const ok = r.size === 0 || r.counts.slice(0, -1).every((c) => c === r.size);
	check(`tab px=${px}`, ok, `fit=${r.fit} size=${r.size} systems=${JSON.stringify(r.counts)}`);
}
// tab with a 2-column pick-up bar (unit 1/8 -> full bar = 8 columns)
const tabP = `mode: tab\n\n` + ["e", "B", "G", "D", "A", "E"].map((s) => `${s}|-0|${Array(12).fill(bar).join("|")}|`).join("\n") + "\n";
const xp = tabSrcToSections(tabP).sections[0].xml;
check("tab pickup marked", hasPickup(xp));
check("tab leading-gap bar not a pickup", !hasPickup(sections[0].xml));
const rp = render(xp, 1600, [8, 4]);
check("tab pickup grouped", rp.size === 8 && rp.counts[0] === 9, JSON.stringify(rp.counts));
process.exit(fail ? 1 : 0);
