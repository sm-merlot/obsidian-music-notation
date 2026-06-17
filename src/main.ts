import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownPostProcessorContext,
} from "obsidian";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import { tabSrcToSections, stripNotationStaff } from "./dsl/pipeline.js";

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
	private rafId = 0;
	private saveTimer = 0;

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
		_ctx: MarkdownPostProcessorContext,
		dsl: boolean
	) {
		const container = el.createDiv({ cls: "music-notation" });
		const controls = container.createDiv({ cls: "music-notation-controls" });
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
				if (dsl && dslMode(source) === "tab") {
					// Render each section as its own SVG so it starts on a new
					// line and wraps independently. Labels are themed headings.
					const { sections } = tabSrcToSections(source);
					for (const sec of sections) {
						if (sec.label) {
							target.createDiv({
								cls: "music-notation-section",
								text: sec.label,
							});
						}
						target.appendChild(this.renderSvg(tk, sec.xml, "musicxml", px, true));
					}
				} else {
					const { inputFrom, data, strip } = this.prepare(source, dsl);
					target.appendChild(this.renderSvg(tk, data, inputFrom, px, strip));
				}
			} catch (e) {
				this.renderError(target, String(e));
			}
		};

		this.buildControls(controls, render);
		render();
	}

	/** Render one MusicXML/ABC string to a themed SVG element (stripped for tab). */
	private renderSvg(
		tk: VerovioToolkit,
		data: string,
		inputFrom: InputFormat,
		px: number,
		strip: boolean
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
		if (strip) stripNotationStaff(svgEl);
		return svgEl;
	}

	/**
	 * In-document sliders that adjust this block's size and spacing live. They
	 * seed from (and write back to) the global defaults so the last-used values
	 * stick across reloads. Changes re-render only this block.
	 */
	private buildControls(bar: HTMLElement, render: () => void) {
		const add = (
			label: string,
			key: "scale" | "spacing",
			min: number,
			max: number,
			step: number
		) => {
			const wrap = bar.createDiv({ cls: "music-notation-control" });
			wrap.createSpan({
				cls: "music-notation-control-label",
				text: label,
			});
			const input = wrap.createEl("input", { type: "range" });
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(this.settings[key]);
			const val = wrap.createSpan({
				cls: "music-notation-control-val",
				text: `${this.settings[key]}%`,
			});
			input.addEventListener("input", () => {
				this.settings[key] = Number(input.value);
				val.setText(`${input.value}%`);
				this.scheduleSave();
				this.scheduleRender(render);
			});
		};
		add("Size", "scale", 20, 100, 5);
		add("Spacing", "spacing", 80, 250, 10);
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

	private scheduleRender(render: () => void) {
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.rafId = requestAnimationFrame(() => {
			this.rafId = 0;
			render();
		});
	}

	private scheduleSave() {
		clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => this.saveSettings(), 400);
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
			.setName("Render scale")
			.setDesc(
				"Size of the engraved music, as a percentage. Lower is smaller."
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
			.setName("Note spacing")
			.setDesc(
				"Horizontal breathing room between notes and lyrics, as a percentage. Higher spreads the music out."
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
