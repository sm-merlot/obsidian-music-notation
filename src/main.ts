import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import * as alphaTab from "@coderline/alphatab";
import { BRAVURA_WOFF2_BASE64 } from "./bravura-font";

interface MusicNotationSettings {
	scale: number;
	enablePlayer: boolean;
}

const DEFAULT_SETTINGS: MusicNotationSettings = {
	scale: 1.0,
	enablePlayer: false,
};

const FONT_DATA_URL = `data:font/woff2;base64,${BRAVURA_WOFF2_BASE64}`;

export default class MusicNotationPlugin extends Plugin {
	settings: MusicNotationSettings;
	private fontReady: Promise<void> | null = null;

	async onload() {
		await this.loadSettings();
		this.registerMarkdownCodeBlockProcessor(
			"alphatab",
			(source, el, ctx) => this.renderBlock(source, el, ctx)
		);
	}

	/**
	 * alphaTab draws notation from the Bravura SMuFL font. We embed it as base64
	 * and register it under alphaTab's expected family name ("alphaTab") via the
	 * FontFace API — no file fetch, so it works inside Obsidian's sandbox and the
	 * plugin ships as just main.js + manifest.json + styles.css (BRAT-friendly).
	 */
	private ensureFont(): Promise<void> {
		if (this.fontReady) return this.fontReady;
		const face = new FontFace("alphaTab", `url(${FONT_DATA_URL})`);
		this.fontReady = face.load().then((loaded) => {
			(document.fonts as unknown as Set<FontFace>).add(loaded);
		});
		return this.fontReady;
	}

	private async renderBlock(
		source: string,
		el: HTMLElement,
		_ctx: MarkdownPostProcessorContext
	) {
		const container = el.createDiv({ cls: "music-notation" });
		try {
			await this.ensureFont();

			const settings = new alphaTab.Settings();
			settings.core.engine = "svg";
			settings.core.useWorkers = false;
			// Font is already registered via FontFace; tell alphaTab not to fetch.
			settings.core.fontDirectory = null;
			settings.core.smuflFontSources = new Map([
				[alphaTab.FontFileFormat.Woff2, FONT_DATA_URL],
			]);
			settings.display.scale = this.settings.scale;
			settings.player.enablePlayer = this.settings.enablePlayer;

			// alphaTab draws black by default — invisible in dark themes. Paint
			// glyphs and staff lines with the active theme's text color.
			this.applyThemeColors(settings, container);

			const api = new alphaTab.AlphaTabApi(container, settings);
			api.error.on((e) => this.renderError(container, String(e)));
			api.tex(source);
		} catch (e) {
			this.renderError(container, String(e));
		}
	}

	/**
	 * Set alphaTab's glyph/line colors to the current theme text color so the
	 * score is legible in light and dark themes alike. Reads the computed color
	 * the container inherits (Obsidian's --text-normal).
	 */
	private applyThemeColors(settings: alphaTab.Settings, container: HTMLElement) {
		const rgb = getComputedStyle(container).color.match(/\d+(\.\d+)?/g);
		if (!rgb || rgb.length < 3) return;
		const color = new alphaTab.model.Color(
			Number(rgb[0]),
			Number(rgb[1]),
			Number(rgb[2]),
			255
		);
		const r = settings.display.resources;
		r.mainGlyphColor = color;
		r.secondaryGlyphColor = color;
		r.scoreInfoColor = color;
		r.staffLineColor = color;
		r.barSeparatorColor = color;
		r.barNumberColor = color;
	}

	private renderError(container: HTMLElement, message: string) {
		container.empty();
		container.createEl("pre", {
			cls: "music-notation-error",
			text: `alphaTab error:\n${message}`,
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
