import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
		// Verovio's WASM module factory has a node-only branch that does
		// `await import("node:module")` etc. That branch is dead in the Obsidian
		// (browser/electron) runtime, but esbuild still resolves the specifiers at
		// build time — keep the node: builtins external so bundling succeeds.
		...builtins.map((b) => `node:${b}`),
	],
	// Verovio's single-file WASM module reads `import.meta.url` (only inside its
	// node branch, which never runs here). cjs output has no import.meta, so feed
	// it a harmless constant to keep esbuild from warning/erroring.
	define: {
		"import.meta.url": '"file:///"',
	},
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
