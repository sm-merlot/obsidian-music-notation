import { ItemView, Notice, Plugin, setIcon } from "obsidian";

// Keep-screen-on toggle for reading music on a stand. One global on/off state;
// a header button on every note and PDF shows and flips it. Uses the Screen
// Wake Lock API (Electron, Android WebView, iOS 18.4+). The browser drops the
// lock whenever the app is hidden, so it is re-requested when we come back.

const VIEW_TYPES = new Set(["markdown", "pdf"]);
const ICON_ON = "lightbulb";
const ICON_OFF = "lightbulb-off";

export class ScreenWake {
	private on = false;
	private sentinel: WakeLockSentinel | null = null;
	private buttons = new Set<HTMLElement>();
	private decorated = new WeakSet<ItemView>();

	constructor(private plugin: Plugin) {}

	load() {
		const { workspace } = this.plugin.app;
		workspace.onLayoutReady(() => this.decorate());
		this.plugin.registerEvent(workspace.on("layout-change", () => this.decorate()));
		this.plugin.registerEvent(workspace.on("active-leaf-change", () => this.decorate()));
		this.plugin.registerDomEvent(document, "visibilitychange", () => {
			if (this.on && document.visibilityState === "visible") void this.acquire();
		});
		this.plugin.addCommand({
			id: "toggle-keep-screen-on",
			name: "Toggle keep screen on",
			callback: () => void this.toggle(),
		});
	}

	unload() {
		this.on = false;
		void this.release();
		for (const b of this.buttons) b.remove();
		this.buttons.clear();
	}

	private decorate() {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof ItemView) || !VIEW_TYPES.has(view.getViewType())) return;
			if (this.decorated.has(view)) return;
			this.decorated.add(view);
			const btn = view.addAction(ICON_OFF, "Keep screen on", () => void this.toggle());
			this.buttons.add(btn);
			this.paint(btn);
		});
		for (const b of this.buttons) if (!b.isConnected) this.buttons.delete(b);
	}

	private paint(btn: HTMLElement) {
		setIcon(btn, this.on ? ICON_ON : ICON_OFF);
		btn.setAttribute("aria-label", this.on ? "Screen stays on (tap to allow sleep)" : "Keep screen on");
		btn.toggleClass("is-active", this.on);
	}

	private async toggle() {
		if (this.on) {
			this.on = false;
			await this.release();
		} else {
			if (!("wakeLock" in navigator)) {
				new Notice("Keep screen on isn't supported on this device.");
				return;
			}
			this.on = true;
			if (!(await this.acquire())) {
				this.on = false;
				new Notice("Couldn't keep the screen on.");
			}
		}
		for (const b of this.buttons) this.paint(b);
		new Notice(this.on ? "Screen will stay on" : "Screen can sleep again");
	}

	private async acquire(): Promise<boolean> {
		if (this.sentinel && !this.sentinel.released) return true;
		try {
			this.sentinel = await navigator.wakeLock.request("screen");
			this.sentinel.addEventListener("release", () => {
				this.sentinel = null;
			});
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
