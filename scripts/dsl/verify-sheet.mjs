// Verify every ```music tab block in a markdown file: compile -> Verovio -> strip.
import fs from "fs";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { DOMParser } from "linkedom";
import { tabSrcToMusicXML, stripNotationStaff } from "../../src/dsl/pipeline.js";

const md = fs.readFileSync(process.argv[2], "utf8");
const blocks = [...md.matchAll(/```music\n([\s\S]*?)```/g)].map((m) => m[1]);

const mod = await createVerovioModule();
const tk = new VerovioToolkit(mod);
let fail = 0;

blocks.forEach((src, i) => {
	let ok = false,
		pages = 0,
		verses = 0,
		tab = false,
		leftover = 0,
		err = "";
	try {
		const xml = tabSrcToMusicXML(src);
		tk.setOptions({ inputFrom: "musicxml", scale: 40, adjustPageHeight: true, pageWidth: 2000, pageHeight: 60000, header: "none", footer: "none", breaks: "auto", spacingStaff: 2 });
		ok = tk.loadData(xml);
		pages = tk.getPageCount();
		const svg = ok ? tk.renderToSVG(1) : "";
		const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
		const el = doc.documentElement;
		verses = el.querySelectorAll("g.verse").length;
		stripNotationStaff(el);
		const out = el.outerHTML;
		tab = /tabGrp|tabDurSym/.test(out);
		el.querySelectorAll("g.measure").forEach((m) => {
			const st = Array.from(m.children).filter((c) => (c.getAttribute("class") || "").split(/\s+/).includes("staff"));
			if (st.length >= 2) leftover += st[0].querySelectorAll("g.notehead, path").length;
		});
	} catch (e) {
		err = String(e);
	}
	const good = ok && pages >= 1 && tab && verses > 0 && leftover === 0;
	if (!good) fail++;
	console.log(`block ${i + 1}: load=${ok} pages=${pages} verses=${verses} tab=${tab} leftover=${leftover} ${good ? "OK" : "FAIL " + err}`);
});
console.log(fail ? `\n${fail} block(s) FAILED` : "\nALL BLOCKS OK");
process.exitCode = fail ? 1 : 0;
