import { Plugin, MarkdownPostProcessorContext, normalizePath } from "obsidian";
import * as alphaTab from "@coderline/alphatab";

interface MusicNotationSettings {
	scale: number;
	enablePlayer: boolean;
}

const DEFAULT_SETTINGS: MusicNotationSettings = {
	scale: 1.0,
	enablePlayer: false,
};

export default class MusicNotationPlugin extends Plugin {
	settings: MusicNotationSettings;
	/** Absolute resource:// URL to the bundled alphaTab font directory. */
	private fontDirectory = "";

	async onload() {
		await this.loadSettings();
		this.resolveFontDirectory();

		// Render fenced ```alphatab blocks (alphaTex source) as staff + tab.
		this.registerMarkdownCodeBlockProcessor(
			"alphatab",
			(source, el, ctx) => this.renderBlock(source, el, ctx)
		);
	}

	/**
	 * alphaTab needs the Bravura SMuFL font to draw glyphs. The font files are
	 * copied into the plugin folder at build/release time (see scripts). We hand
	 * alphaTab a resource path it can fetch inside Obsidian's Electron sandbox.
	 */
	private resolveFontDirectory() {
		const pluginDir = normalizePath(
			`${this.app.vault.configDir}/plugins/${this.manifest.id}/font`
		);
		// getResourcePath turns a vault-relative path into an app:// URL the
		// renderer is allowed to load.
		this.fontDirectory = this.app.vault.adapter.getResourcePath(pluginDir);
	}

	private renderBlock(
		source: string,
		el: HTMLElement,
		_ctx: MarkdownPostProcessorContext
	) {
		const container = el.createDiv({ cls: "music-notation" });

		const settings = new alphaTab.Settings();
		settings.core.engine = "svg";
		settings.core.fontDirectory = this.fontDirectory;
		settings.display.scale = this.settings.scale;
		settings.player.enablePlayer = this.settings.enablePlayer;
		// No web worker: Obsidian's module loader does not expose one cleanly.
		// Render on the main thread; fine for typical song-length scores.
		settings.core.useWorkers = false;

		try {
			const api = new alphaTab.AlphaTabApi(container, settings);
			api.error.on((e) => this.renderError(container, String(e)));
			api.tex(source);
		} catch (e) {
			this.renderError(container, String(e));
		}
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
