import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownPostProcessorContext,
} from "obsidian";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

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
	spacing: 140,
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

export default class MusicNotationPlugin extends Plugin {
	settings: MusicNotationSettings;
	/** Verovio toolkit is created once (WASM init is expensive) and reused. */
	private toolkit: Promise<VerovioToolkit> | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MusicNotationSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor(
			"music-verovio",
			(source, el, ctx) => this.renderBlock(source, el, ctx)
		);
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
		_ctx: MarkdownPostProcessorContext
	) {
		const container = el.createDiv({ cls: "music-notation" });
		try {
			const tk = await this.getToolkit();

			// pageWidth is in Verovio units; derive from the rendered block width
			// so the score fills the note column. Fall back to a sensible width
			// before layout (clientWidth can be 0 on first paint).
			const px = container.clientWidth || el.clientWidth || 800;
			const f = this.settings.spacing / 100;
			tk.setOptions({
				inputFrom: detectFormat(source),
				scale: this.settings.scale,
				adjustPageHeight: true,
				pageWidth: Math.round((px * 100) / this.settings.scale),
				// Spread notes/lyrics horizontally. Verovio defaults: linear 0.25,
				// non-linear 0.6 (both capped at 1). Scale by the user's factor.
				spacingLinear: Math.min(1, 0.25 * f),
				spacingNonLinear: Math.min(1, 0.6 * f),
				// Very tall page so Verovio wraps into systems but never paginates
				// — we only render page 1, so everything must fit on it.
				pageHeight: 60000,
				pageMarginLeft: 0,
				pageMarginRight: 0,
				pageMarginTop: 0,
				pageMarginBottom: 0,
				header: "none",
				footer: "none",
				breaks: "auto",
				svgViewBox: true,
			});

			if (!tk.loadData(source) || tk.getPageCount() < 1) {
				this.renderError(
					container,
					tk.getLog() || "Verovio could not parse this input."
				);
				return;
			}

			const svg = tk.renderToSVG(1);
			const doc = new DOMParser().parseFromString(
				svg,
				"image/svg+xml"
			);
			const svgEl = doc.documentElement;
			if (svgEl.nodeName.toLowerCase() !== "svg") {
				this.renderError(container, "Verovio returned no SVG.");
				return;
			}
			container.appendChild(svgEl);
		} catch (e) {
			this.renderError(container, String(e));
		}
	}

	private renderError(container: HTMLElement, message: string) {
		container.empty();
		container.createEl("pre", {
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
					.setLimits(100, 250, 10)
					.setValue(this.plugin.settings.spacing)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.spacing = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
