// Convert a song sheet's alphatab blocks to music-verovio (MusicXML) blocks,
// render-verifying each with Verovio before writing the new file.
import fs from "fs";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { convert } from "./alphatex2musicxml.mjs";

const SHEET = process.argv[2];
if (!SHEET) {
	console.error("usage: node convert-sheet.mjs <path.md>");
	process.exit(1);
}

const src = fs.readFileSync(SHEET, "utf8");
const module = await createVerovioModule();
const tk = new VerovioToolkit(module);

let blockIdx = 0;
let failed = false;

const out = src.replace(
	/```alphatab\n([\s\S]*?)```/g,
	(_m, body) => {
		blockIdx++;
		const xml = convert(body);
		tk.setOptions({
			inputFrom: "musicxml",
			scale: 40,
			adjustPageHeight: true,
			pageWidth: 2000,
			pageHeight: 60000,
			header: "none",
			footer: "none",
			breaks: "auto",
			svgViewBox: true,
		});
		const ok = tk.loadData(xml);
		const pages = tk.getPageCount();
		const svg = ok && pages > 0 ? tk.renderToSVG(1) : "";
		const notes = (svg.match(/class="note"/g) || []).length;
		// A tall page must hold the whole block on page 1 (we only render page 1).
		const good = ok && pages === 1 && svg.includes("<svg");
		console.log(
			`block ${blockIdx}: load=${ok} pages=${pages} notes=${notes} ${
				good ? "OK" : "FAIL"
			}`
		);
		if (!good) {
			failed = true;
			console.error(tk.getLog());
		}
		return "```music-verovio\n" + xml + "\n```";
	}
);

if (failed) {
	console.error("\nSome blocks failed to render — sheet NOT written.");
	process.exit(1);
}

fs.writeFileSync(SHEET, out);
console.log(`\nWrote ${SHEET} (${blockIdx} blocks converted).`);
