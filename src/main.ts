import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
} from "obsidian";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { tabSrcToSections, stripNotationStaff } from "./dsl/pipeline.js";
import { parseChords, chordParts } from "./dsl/chords.js";
import { parseChordDefs, chordLayout } from "./dsl/chord-defs.js";

interface MusicNotationSettings {
	/** Verovio render scale (percent). 40 is a sensible default for notes. */
	scale: number;
	/**
	 * Horizontal note-spacing factor (percent of Verovio defaults). Higher =
	 * more breathing room between notes/lyrics, fewer measures per line.
	 */
	spacing: number;
}

const DEFAULT_SETTINGS: MusicNotationSettings = {
	scale: 40,
	spacing: 110,
};

type InputFormat = "musicxml" | "abc";

/**
 * Decide which format Verovio should parse. MusicXML is XML (starts with "<",
 * after any prolog/comment); ABC tunes start with an "X:" reference-number
 * header line. Default to MusicXML.
 */
function detectFormat(source: string): InputFormat {
	const trimmed = source.trimStart();
	if (/^X:/m.test(trimmed) && !trimmed.startsWith("<")) return "abc";
	return "musicxml";
}

/** Human caption for a tab's tuning + capo, e.g. "Standard tuning · Capo 2". */
function tuningCaption(directives: {
	tuning?: string | null;
	capo?: string | number | null;
}): string {
	const labels = (directives.tuning || "e B G D A E").trim().split(/\s+/);
	const eq = (a: string[]) =>
		a.length === labels.length && a.every((x, i) => x === labels[i]);
	let name: string;
	if (eq(["e", "B", "G", "D", "A", "E"])) name = "Standard tuning";
	else if (eq(["e", "B", "G", "D", "A", "D"])) name = "Drop D";
	else name = labels.slice().reverse().join(" "); // low → high
	// capo is free text, always prefixed "Capo " when set (e.g. "Capo 2",
	// "Capo none", "Capo 2, orig none"). Omitted only if the directive is absent.
	const raw = (directives.capo == null ? "" : String(directives.capo)).trim();
	return name + (raw ? ` · Capo ${raw}` : "");
}

/** DSL mode from an explicit `mode:` directive, else inferred from the body. */
function dslMode(source: string): "tab" | "chords" | "notation" {
	const m = source.match(/^\s*mode\s*:\s*(tab|chords|notation)\s*$/im);
	if (m) return m[1].toLowerCase() as "tab" | "chords" | "notation";
	if (/^\s*[eEABDGL]\s*[|:]/m.test(source)) return "tab";
	if (/^\s*[XK]:/m.test(source)) return "notation";
	return "tab";
}

export default class MusicNotationPlugin extends Plugin {
	settings: MusicNotationSettings;
	/** Verovio toolkit is created once (WASM init is expensive) and reused. */
	private toolkit: Promise<VerovioToolkit> | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MusicNotationSettingTab(this.app, this));
		// `music` = the friendly DSL (tab / notation). `music-verovio` = raw
		// MusicXML/ABC straight to the engine (escape hatch / debugging).
		this.registerMarkdownCodeBlockProcessor("music", (source, el, ctx) =>
			this.renderBlock(source, el, ctx, true)
		);
		this.registerMarkdownCodeBlockProcessor(
			"music-verovio",
			(source, el, ctx) => this.renderBlock(source, el, ctx, false)
		);
	}

	/**
	 * Turn block source into what Verovio should load. Raw blocks pass through;
	 * DSL blocks are compiled by mode (tab → 2-staff MusicXML that needs the
	 * notation staff stripped from the SVG; notation → ABC/MusicXML as-is).
	 */
	private prepare(source: string, dsl: boolean): {
		inputFrom: InputFormat;
		data: string;
		strip: boolean;
	} {
		if (!dsl) {
			return { inputFrom: detectFormat(source), data: source, strip: false };
		}
		const mode = dslMode(source);
		// tab is handled separately (per-section) in renderBlock.
		if (mode === "notation") {
			const body = source
				.replace(/^\s*(mode|title|meter|unit|tuning|capo)\s*:.*$/gim, "")
				.trim();
			return { inputFrom: detectFormat(body), data: body, strip: false };
		}
		throw new Error(`'${mode}' mode is not implemented yet.`);
	}

	/**
	 * Lazily boot Verovio. The WASM module (with the Gootville SMuFL font) is
	 * bundled into main.js, so there is no file fetch — it works inside
	 * Obsidian's sandbox and offline. One toolkit serves every block.
	 */
	private getToolkit(): Promise<VerovioToolkit> {
		if (!this.toolkit) {
			this.toolkit = createVerovioModule().then(
				(module) => new VerovioToolkit(module)
			);
		}
		return this.toolkit;
	}

	private async renderBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		dsl: boolean
	) {
		const container = el.createDiv({ cls: "music-notation" });
		const target = container.createDiv({ cls: "music-notation-render" });

		let tk: VerovioToolkit;
		try {
			tk = await this.getToolkit();
		} catch (e) {
			this.renderError(target, String(e));
			return;
		}

		const render = () => {
			try {
				const px = this.fitWidth(container, el);
				target.empty();
				if (dsl) this.drawChordChart(source, target);
				if (dsl && dslMode(source) === "chords") {
					this.renderChords(source, target);
				} else if (dsl && dslMode(source) === "tab") {
					// Render each section as its own SVG so it starts on a new
					// line and wraps independently. Labels are themed headings.
					const { directives, sections } = tabSrcToSections(source);
					target.createDiv({
						cls: "music-notation-tuning",
						text: tuningCaption(directives),
					});
					for (const sec of sections) {
						if (sec.label) {
							target.createDiv({
								cls: "music-notation-section",
								text: sec.label,
							});
						}
						target.appendChild(
							this.renderSvg(tk, sec.xml, "musicxml", px, true, sec.connections)
						);
					}
				} else {
					const { inputFrom, data, strip } = this.prepare(source, dsl);
					target.appendChild(this.renderSvg(tk, data, inputFrom, px, strip));
				}
			} catch (e) {
				this.renderError(target, String(e));
			}
		};

		render();

		// Re-render when the block's width changes so bars reflow to fill the
		// available space (stave size stays fixed; more/fewer bars per row —
		// like wrapping text). Debounced; ignores height-only changes.
		let lastW = container.clientWidth;
		let timer = 0;
		const ro = new ResizeObserver(() => {
			const w = container.clientWidth;
			if (!w || Math.abs(w - lastW) < 4) return;
			lastW = w;
			window.clearTimeout(timer);
			timer = window.setTimeout(render, 120);
		});
		ro.observe(container);
		const child = new MarkdownRenderChild(container);
		child.register(() => {
			ro.disconnect();
			window.clearTimeout(timer);
		});
		ctx.addChild(child);
	}

	/** Render one MusicXML/ABC string to a themed SVG element (stripped for tab). */
	private renderSvg(
		tk: VerovioToolkit,
		data: string,
		inputFrom: InputFormat,
		px: number,
		strip: boolean,
		connections?: unknown
	): SVGElement {
		const f = this.settings.spacing / 100;
		tk.setOptions({
			inputFrom,
			scale: this.settings.scale,
			adjustPageHeight: true,
			pageWidth: Math.round((px * 100) / this.settings.scale),
			// Spread notes/lyrics horizontally. Verovio defaults: linear 0.25,
			// non-linear 0.6 (both capped at 1). Scale by the factor.
			spacingLinear: Math.min(1, 0.25 * f),
			spacingNonLinear: Math.min(1, 0.6 * f),
			// Tab carries lyrics on a hidden staff that gets stripped; pull the
			// staves tight so the leftover band is small.
			spacingStaff: strip ? 2 : 12,
			// Very tall page so Verovio wraps into systems but never paginates —
			// we only render page 1, so it must all fit.
			pageHeight: 60000,
			// Side padding so systems (and their end barlines) don't sit flush
			// against the edges and get clipped.
			pageMarginLeft: 50,
			pageMarginRight: 50,
			pageMarginTop: 0,
			pageMarginBottom: 0,
			header: "none",
			footer: "none",
			breaks: "auto",
			svgViewBox: true,
		});
		if (!tk.loadData(data) || tk.getPageCount() < 1) {
			throw new Error(tk.getLog() || "Verovio could not parse this input.");
		}
		const svgEl = new DOMParser().parseFromString(
			tk.renderToSVG(1),
			"image/svg+xml"
		).documentElement as unknown as SVGElement;
		if (svgEl.nodeName.toLowerCase() !== "svg") {
			throw new Error("Verovio returned no SVG.");
		}
		if (strip) stripNotationStaff(svgEl, connections);
		return svgEl;
	}

	/**
	 * Render a strip of chord-diagram boxes from `chord NAME …` definitions.
	 * Shared by tab and chords modes; drawn as small self-contained SVGs.
	 */
	private drawChordChart(source: string, target: HTMLElement) {
		const defs = parseChordDefs(source);
		if (!defs.length) return;
		const NS = "http://www.w3.org/2000/svg";
		const strip = target.createDiv({ cls: "music-notation-chordbox" });
		for (const d of defs) {
			const cell = strip.createDiv({ cls: "cb-cell" });
			cell.createDiv({ cls: "cb-name", text: d.name });
			const { base, dots, markers } = chordLayout(d.strings);
			const xs = (s: number) => 18 + s * 18; // 6 strings, low E (s=0) left
			const nutY = 24;
			const dy = 24;
			const fretY = (f: number) => nutY + f * dy; // 4 fret rows
			const svg = document.createElementNS(NS, "svg");
			svg.setAttribute("viewBox", "0 0 120 132");
			svg.setAttribute("class", "cb-svg");
			const el = (tag: string, attrs: Record<string, string | number>) => {
				const e = document.createElementNS(NS, tag);
				for (const k in attrs) e.setAttribute(k, String(attrs[k]));
				svg.appendChild(e);
				return e;
			};
			// 6 strings (vertical)
			for (let s = 0; s < 6; s++)
				el("line", { x1: xs(s), y1: nutY, x2: xs(s), y2: fretY(4), stroke: "currentColor", "stroke-width": 2 });
			// 5 fret lines (horizontal); nut thick when at the top of the neck
			for (let f = 0; f <= 4; f++)
				el("line", { x1: xs(0), y1: fretY(f), x2: xs(5), y2: fretY(f), stroke: "currentColor", "stroke-width": f === 0 && base === 1 ? 6 : 2 });
			if (base > 1)
				el("text", { x: xs(5) + 9, y: fretY(1) - 6, "font-size": 16, fill: "currentColor" }).textContent = `${base}fr`;
			// fingered dots
			for (const dot of dots)
				el("circle", { cx: xs(dot.string), cy: nutY + (dot.fret - 0.5) * dy, r: 7, fill: "currentColor" });
			// open / muted markers above the nut
			for (const mk of markers) {
				if (mk.type === "o")
					el("circle", { cx: xs(mk.string), cy: 12, r: 5, fill: "none", stroke: "currentColor", "stroke-width": 2 });
				else
					el("text", { x: xs(mk.string), y: 17, "font-size": 16, "text-anchor": "middle", fill: "currentColor" }).textContent = "×";
			}
			cell.appendChild(svg);
		}
	}

	/**
	 * Chord-over-lyric mode: render as HTML that wraps word-by-word, each chord
	 * glued above its word (so it stays aligned on any width). No engraving.
	 */
	private renderChords(source: string, target: HTMLElement) {
		const parsed = parseChords(source) as {
			directives: { capo?: string };
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			blocks: any[];
		};
		const { directives, blocks } = parsed;
		if (directives.capo) {
			target.createDiv({
				cls: "music-notation-tuning",
				text: `Capo ${directives.capo}`,
			});
		}
		// one chord name → root span + superscript extension
		const chordName = (parent: HTMLElement, name: string) => {
			const { root, ext } = chordParts(name);
			const cs = parent.createSpan({ cls: "cl-chord-name" });
			cs.createSpan({ cls: "cl-root", text: root });
			if (ext) cs.createEl("sup", { cls: "cl-ext", text: ext });
		};
		// chord stack above a word (one or more chords)
		const chordsAbove = (word: HTMLElement, names: string[]) => {
			const c = word.createSpan({ cls: "cl-chord" });
			names.forEach((n, i) => {
				if (i) c.appendText(" ");
				chordName(c, n);
			});
		};
		for (const b of blocks) {
			if (b.type === "section") {
				target.createDiv({ cls: "music-notation-section", text: b.label });
			} else if (b.type === "blank") {
				target.createDiv({ cls: "cl-gap" });
			} else if (b.type === "chordline") {
				const line = target.createDiv({ cls: "cl-line cl-chordline" });
				for (const name of b.chords) {
					const w = line.createSpan({ cls: "cl-word cl-lead" });
					chordsAbove(w, [name]);
				}
			} else if (b.type === "line") {
				const line = target.createDiv({ cls: "cl-line" });
				if (b.lead && b.lead.length) {
					const w = line.createSpan({ cls: "cl-word cl-lead" });
					chordsAbove(w, b.lead);
				}
				for (const wd of b.words) {
					const w = line.createSpan({ cls: "cl-word" });
					chordsAbove(w, wd.chords); // always reserve the chord lane
					w.createSpan({ cls: "cl-text", text: wd.text });
				}
			}
		}
	}

	/**
	 * Width the score should fill: the block's natural content width. We do NOT
	 * break out of Obsidian's "Readable line length" — past attempts clipped
	 * against ancestor overflow. To use the full window width, turn that setting
	 * off (Settings → Editor) and the block fills the pane automatically.
	 */
	private fitWidth(container: HTMLElement, el: HTMLElement): number {
		return container.clientWidth || el.clientWidth || 800;
	}

	private renderError(target: HTMLElement, message: string) {
		target.empty();
		target.createEl("pre", {
			cls: "music-notation-error",
			text: `Music notation error:\n${message}`,
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class MusicNotationSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MusicNotationPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Stave size")
			.setDesc(
				"Comfortable reading size for the music. Stays fixed — bars wrap onto new lines to fill the available width (reopen notes to apply)."
			)
			.addSlider((s) =>
				s
					.setLimits(20, 100, 5)
					.setValue(this.plugin.settings.scale)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.scale = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Note spacing (advanced)")
			.setDesc(
				"Escape hatch for horizontal spacing. Spacing is handled automatically; raise this only if notes/lyrics feel cramped."
			)
			.addSlider((s) =>
				s
					.setLimits(80, 250, 10)
					.setValue(this.plugin.settings.spacing)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.spacing = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
