// Grid commands + their keyboard shortcuts, defined once so the Obsidian
// commands, the in-block CodeMirror keymap and the "Show shortcuts" sheet all
// agree. The keys are bound in a CM6 keymap that only fires while the cursor is
// inside a ```music block, so they never steal Obsidian's own hotkeys elsewhere.
import { App, Modal, Platform } from "obsidian";
import { EditorView, KeyBinding } from "@codemirror/view";
import { addBarOrSystem, addContinuation, insertColumn, removeColumn, removeBar, formatBlock, Edit, Pos } from "./grid-ops";
import { inMusicBlock } from "./grid-edit";

export interface GridCommand {
	id: string;
	name: string;
	/** CodeMirror key spec (Mod = Cmd on macOS, Ctrl elsewhere). */
	key: string;
	fn: (lines: string[], pos: Pos) => Edit | null;
	fail: string;
}

export const GRID_COMMANDS: GridCommand[] = [
	{ id: "music-add-bar", name: "Add bar (or new stave on a blank line)", key: "Mod-Alt-b", fn: addBarOrSystem, fail: "Place the cursor in a music block first" },
	{ id: "music-remove-bar", name: "Remove bar at cursor", key: "Mod-Alt-Shift-b", fn: removeBar, fail: "Place the cursor in a music grid bar first" },
	{ id: "music-add-continuation", name: "Continue staves on a new line (===)", key: "Mod-Alt-n", fn: addContinuation, fail: "Place the cursor in a music staff first" },
	{ id: "music-insert-column", name: "Insert padding column (whole stave)", key: "Mod-Alt-c", fn: insertColumn, fail: "Place the cursor in a music staff first" },
	{ id: "music-remove-column", name: "Remove padding column (whole stave)", key: "Mod-Alt-Shift-c", fn: removeColumn, fail: "Cursor must be on a blank padding column" },
	{ id: "music-format", name: "Format (align barlines)", key: "Mod-Alt-a", fn: formatBlock, fail: "Place the cursor in a music block first" },
];

export const HELP_KEY = "Mod-Alt-k";

/** Built-in editing keys (grid-edit.ts) for the shortcuts sheet. */
const EDIT_KEYS: Array<[string, string]> = [
	["Type", "Overwrites the char under the cursor (appends at end of row)"],
	["Backspace", "Turns the char to the left back into fill (- or space)"],
	["Delete", "Turns the char under the cursor back into fill"],
	["Shift-Backspace / Shift-Delete", "Really delete one char (pulls this row left)"],
	["Shift-Space", "Insert one fill char (pushes this row right)"],
	["Insert", "Toggle insert mode (INS bar shows); typing pushes the row"],
	["Enter", "New blank ledger row below; Enter again for a new stave"],
];

/** Apply a grid op to a CodeMirror view (same as the Obsidian-editor path). */
export function applyToView(view: EditorView, cmd: GridCommand, notice: (msg: string) => void): boolean {
	const { state } = view;
	const doc = state.doc;
	const head = state.selection.main.head;
	const ln = doc.lineAt(head);
	const lines = doc.toString().split("\n");
	const e = cmd.fn(lines, { line: ln.number - 1, ch: head - ln.from });
	if (!e) {
		notice(cmd.fail);
		return true; // in a music block: swallow the key even if the op declined
	}
	const from = doc.line(e.start + 1).from;
	const to = doc.line(e.end + 1).to;
	const insert = e.newInner.join("\n");
	// cursor: offset within the replaced text
	const out = e.newInner;
	let anchor = from;
	for (let i = 0; i < e.cursor.line - e.start && i < out.length; i++) anchor += out[i].length + 1;
	anchor += Math.min(e.cursor.ch, out[e.cursor.line - e.start]?.length ?? 0);
	view.dispatch({ changes: { from, to, insert }, selection: { anchor }, scrollIntoView: true, userEvent: "music.grid" });
	return true;
}

export function gridCommandKeys(notice: (msg: string) => void, showHelp: () => void): KeyBinding[] {
	const inBlock = (view: EditorView) => inMusicBlock(view.state, view.state.selection.main.head);
	return [
		...GRID_COMMANDS.map((cmd) => ({
			key: cmd.key,
			run: (view: EditorView) => inBlock(view) && applyToView(view, cmd, notice),
		})),
		{
			key: HELP_KEY,
			run: (view: EditorView) => {
				if (!inBlock(view)) return false;
				showHelp();
				return true;
			},
		},
	];
}

/** Human label for a CM key spec, e.g. "Mod-Alt-Shift-b" -> "⌘⌥⇧B" / "Ctrl+Alt+Shift+B". */
export function keyLabel(spec: string): string {
	const parts = spec.split("-");
	const key = parts.pop() ?? "";
	const mac = Platform.isMacOS;
	const map: Record<string, string> = mac
		? { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃" }
		: { Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Ctrl: "Ctrl" };
	const k = key.length === 1 ? key.toUpperCase() : key;
	return mac ? parts.map((p) => map[p] ?? p).join("") + k : [...parts.map((p) => map[p] ?? p), k].join("+");
}

export class ShortcutsModal extends Modal {
	constructor(app: App) {
		super(app);
	}
	onOpen() {
		const { contentEl } = this;
		this.setTitle("Music block shortcuts");
		contentEl.createEl("p", {
			text: "These work while the cursor is inside a ```music block. The commands are also in the command palette, where you can rebind them under Settings → Hotkeys.",
			cls: "setting-item-description",
		});
		const table = (rows: Array<[string, string]>) => {
			const t = contentEl.createEl("table", { cls: "music-shortcuts" });
			for (const [k, d] of rows) {
				const tr = t.createEl("tr");
				tr.createEl("td").createEl("kbd", { text: k });
				tr.createEl("td", { text: d });
			}
		};
		contentEl.createEl("h4", { text: "Commands" });
		table([...GRID_COMMANDS.map((c) => [keyLabel(c.key), c.name] as [string, string]), [keyLabel(HELP_KEY), "Show this list"]]);
		contentEl.createEl("h4", { text: "Editing" });
		table(EDIT_KEYS);
	}
	onClose() {
		this.contentEl.empty();
	}
}
