// Verify every ```music tab block in a markdown file: per-section compile ->
// Verovio -> strip (mirrors how the plugin renders).
import fs from "fs";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { DOMParser } from "linkedom";
import { tabSrcToSections, stripNotationStaff } from "../../src/dsl/pipeline.js";

const md = fs.readFileSync(process.argv[2], "utf8");
const blocks = [...md.matchAll(/```music\n([\s\S]*?)```/g)].map((m) => m[1]);

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
let fail = 0;

blocks.forEach((src, i) => {
	let labels = [],
		ok = true,
		verses = 0,
		tab = true,
		leftover = 0,
		err = "";
	try {
		const { sections } = tabSrcToSections(src);
		labels = sections.map((s) => s.label || "—");
		for (const sec of sections) {
			tk.setOptions({ inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none", breaks: "auto", pageMarginLeft: 50, pageMarginRight: 50, spacingStaff: 2 });
			const loaded = tk.loadData(sec.xml);
			ok = ok && loaded && tk.getPageCount() >= 1;
			const svg = new DOMParser().parseFromString(loaded ? tk.renderToSVG(1) : "", "image/svg+xml").documentElement;
			verses += svg.querySelectorAll("g.verse").length;
			stripNotationStaff(svg);
			tab = tab && /tabGrp|tabDurSym/.test(svg.outerHTML);
			svg.querySelectorAll("g.measure").forEach((m) => {
				const st = Array.from(m.children).filter((c) => (c.getAttribute("class") || "").split(/\s+/).includes("staff"));
				if (st.length >= 2) leftover += st[0].querySelectorAll("g.notehead, path").length;
			});
		}
	} catch (e) {
		err = String(e);
		ok = false;
	}
	const good = ok && tab && verses > 0 && leftover === 0;
	if (!good) fail++;
	console.log(`block ${i + 1}: sections=[${labels.join(", ")}] verses=${verses} tab=${tab} leftover=${leftover} ${good ? "OK" : "FAIL " + err}`);
});
console.log(fail ? `\n${fail} block(s) FAILED` : "\nALL BLOCKS OK");
process.exitCode = fail ? 1 : 0;
