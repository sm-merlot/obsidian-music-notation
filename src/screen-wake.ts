import { ItemView, Notice, Plugin, TAbstractFile, TFile, setIcon } from "obsidian";

// Keep-screen-on toggle for reading music on a stand. Only offered on PDFs and
// on notes that contain a ```music / ```music-verovio block. The toggle is one
// global preference; the screen is held on only while it is ON *and* the open
// file is eligible, so other notes always allow sleep. Uses the Screen Wake
// Lock API (Electron, Android WebView, iOS 18.4+). The browser drops the lock
// whenever the app is hidden, so it is re-requested when we come back.

const ICON_ON = "lightbulb";
const ICON_OFF = "lightbulb-off";
const MUSIC_FENCE = /^\s*(```|~~~)\s*music(-verovio)?\s*$/m;

type FileView = ItemView & { file?: TFile | null };

export class ScreenWake {
	private on = false;
	private sentinel: WakeLockSentinel | null = null;
	private pending: Promise<boolean> | null = null;
	private buttons = new Map<FileView, HTMLElement>();
	/** path → has a music block (filled async from cachedRead). */
	private musicFiles = new Map<string, boolean>();

	constructor(private plugin: Plugin) {}

	load() {
		const { workspace, vault } = this.plugin.app;
		const refresh = () => this.refresh();
		workspace.onLayoutReady(refresh);
		this.plugin.registerEvent(workspace.on("layout-change", refresh));
		this.plugin.registerEvent(workspace.on("active-leaf-change", refresh));
		this.plugin.registerEvent(workspace.on("file-open", refresh));
		this.plugin.registerEvent(
			vault.on("modify", (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") void this.scan(f);
			})
		);
		this.plugin.registerEvent(
			vault.on("rename", (_f: TAbstractFile, oldPath: string) => {
				this.musicFiles.delete(oldPath);
				refresh();
			})
		);
		this.plugin.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") void this.apply();
		});
		this.plugin.addCommand({
			id: "toggle-keep-screen-on",
			name: "Toggle keep screen on (music notes and PDFs)",
			checkCallback: (checking) => {
				if (!this.eligible(this.activeView())) return false;
				if (!checking) void this.toggle();
				return true;
			},
		});
	}

	unload() {
		this.on = false;
		void this.release();
		for (const b of this.buttons.values()) b.remove();
		this.buttons.clear();
	}

	private activeView(): FileView | null {
		const v = this.plugin.app.workspace.getMostRecentLeaf()?.view;
		return v instanceof ItemView ? (v as FileView) : null;
	}

	private eligible(view: FileView | null): boolean {
		const file = view?.file;
		if (!view || !file) return false;
		const type = view.getViewType();
		if (type === "pdf") return true;
		return type === "markdown" && this.musicFiles.get(file.path) === true;
	}

	private async scan(file: TFile) {
		const text = await this.plugin.app.vault.cachedRead(file);
		const has = MUSIC_FENCE.test(text);
		if (this.musicFiles.get(file.path) !== has) {
			this.musicFiles.set(file.path, has);
			this.refresh();
		}
	}

	/** Add buttons to new note/PDF views, show/hide per file, then apply the lock. */
	private refresh() {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as FileView;
			if (!(view instanceof ItemView)) return;
			const type = view.getViewType();
			if (type !== "markdown" && type !== "pdf") return;
			if (!this.buttons.has(view)) {
				this.buttons.set(view, view.addAction(ICON_OFF, "Keep screen on", () => void this.toggle()));
			}
			const file = view.file;
			if (type === "markdown" && file && !this.musicFiles.has(file.path)) void this.scan(file);
		});
		for (const [view, btn] of this.buttons) {
			if (!btn.isConnected) this.buttons.delete(view);
			else this.paint(btn, this.eligible(view));
		}
		void this.apply();
	}

	private paint(btn: HTMLElement, show: boolean) {
		btn.toggle(show);
		setIcon(btn, this.on ? ICON_ON : ICON_OFF);
		btn.setAttribute("aria-label", this.on ? "Screen stays on (tap to allow sleep)" : "Keep screen on");
		btn.toggleClass("is-active", this.on);
	}

	/** Hold the lock only while ON, visible, and looking at an eligible file. */
	private async apply() {
		const want = this.on && document.visibilityState === "visible" && this.eligible(this.activeView());
		if (want) await this.acquire();
		else await this.release();
	}

	private async toggle() {
		if (!this.on && !("wakeLock" in navigator)) {
			new Notice("Keep screen on isn't supported on this device.");
			return;
		}
		this.on = !this.on;
		if (this.on && !(await this.acquire())) {
			this.on = false;
			new Notice("Couldn't keep the screen on.");
		}
		if (!this.on) await this.release();
		for (const [view, btn] of this.buttons) this.paint(btn, this.eligible(view));
		new Notice(this.on ? "Screen will stay on for music notes and PDFs" : "Screen can sleep again");
	}

	private acquire(): Promise<boolean> {
		if (this.sentinel && !this.sentinel.released) return Promise.resolve(true);
		this.pending ??= this.request().finally(() => (this.pending = null));
		return this.pending;
	}

	private async request(): Promise<boolean> {
		try {
			const s = await navigator.wakeLock.request("screen");
			s.addEventListener("release", () => {
				if (this.sentinel === s) this.sentinel = null;
			});
			// turned off (or left the file) while the request was in flight
			if (!this.on || !this.eligible(this.activeView())) {
				await s.release();
				return false;
			}
			this.sentinel = s;
			return true;
		} catch (e) {
			console.warn("music-notation: wake lock request failed", e);
			return false;
		}
	}

	private async release() {
		const s = this.sentinel;
		this.sentinel = null;
		if (s && !s.released) await s.release().catch(() => {});
	}
}
