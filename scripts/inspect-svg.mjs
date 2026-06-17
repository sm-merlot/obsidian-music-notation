import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { convert } from "./alphatex2musicxml.mjs";

const ALPHATEX = `\\staff{tabs}
.
:8 (5.5 7.3 7.2){ch "D" lyrics "Ka-"} 7.4{lyrics "tie"} (7.3 7.2){lyrics "don't"} 7.4{lyrics "cry"} (7.3 7.2) 7.4{lyrics "I"} (7.3 7.2) 7.4{lyrics "know"} |`;

const xml = convert(ALPHATEX);
const module = await createVerovioModule();
const tk = new VerovioToolkit(module);
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
tk.loadData(xml);
const svg = tk.renderToSVG(1);

console.log("=== unique fill= values ===");
console.log([...new Set([...svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]))]);
console.log("=== unique stroke= values ===");
console.log([...new Set([...svg.matchAll(/stroke="([^"]*)"/g)].map((m) => m[1]))]);
console.log("=== fill: in style attrs ===");
console.log([...new Set([...svg.matchAll(/fill:\s*([^;"]*)/g)].map((m) => m[1]))]);
console.log("=== stroke: in style attrs ===");
console.log([...new Set([...svg.matchAll(/stroke:\s*([^;"]*)/g)].map((m) => m[1]))]);

for (const cls of ["staff", "barLine", "beam", "stem", "ledgerLines", "ledgerLine"]) {
	const re = new RegExp(`<g[^>]*class="${cls}"[^>]*>([\\s\\S]{0,260})`);
	const m = svg.match(re);
	console.log(`\n=== class="${cls}" ===\n` + (m ? m[0].slice(0, 320) : "(none)"));
}
