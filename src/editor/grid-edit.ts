// CodeMirror 6 editing helpers for `music` code blocks. ASCII grids are a fixed
// coordinate system, so the editor should stop fighting alignment:
//   - OVERTYPE on grid rows: typing a char replaces the one under the cursor
//     (so a fret overwrites the `-` instead of shoving the row right). At the end
//     of a line it appends as normal, so you can still extend a row.
//   - revert "." -> " " inside the grid (kills the macOS double-space->". ").
//   - plain Enter (no auto-indent / list continuation) inside the block.
// All scoped to ```music blocks only; `music-verovio` (raw XML/ABC) is left alone.
import { EditorState, Prec, Text, Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { gridStart, fillChar } from "./grid-ops";

/** Inner line ranges (1-based, inclusive) of every ```music fenced block. */
function musicBlocks(doc: Text): Array<{ start: number; end: number }> {
	const out: Array<{ start: number; end: number }> = [];
	let openLine = 0;
	let ch = "";
	let len = 0;
	for (let i = 1; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		const fm = text.match(/^\s*([`~]{3,})(.*)$/);
		if (!fm) continue;
		const marker = fm[1];
		const info = fm[2].trim();
		if (!openLine) {
			if (info === "music") {
				openLine = i;
				ch = marker[0];
				len = marker.length;
			}
		} else if (marker[0] === ch && marker.length >= len && info === "") {
			out.push({ start: openLine + 1, end: i - 1 });
			openLine = 0;
		}
	}
	if (openLine) out.push({ start: openLine + 1, end: doc.lines }); // still being typed
	return out;
}

function lineInMusic(state: EditorState, pos: number): boolean {
	const n = state.doc.lineAt(pos).number;
	return musicBlocks(state.doc).some((b) => n >= b.start && n <= b.end);
}

// Rewrite plain single-cursor typing inside a grid row: drop "." (-> space) and
// overtype the char under the cursor.
const gridInput = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || !tr.isUserEvent("input")) return tr;
	if (tr.startState.selection.ranges.length !== 1) return tr;

	const doc = tr.startState.doc;
	let handled = true;
	let changed = false;
	let newChange: { from: number; to: number; insert: string } | null = null;

	tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
		const insText = ins.toString();
		// only a pure single-char-ish insertion (no replacement, no newline)
		if (fromA !== toA || insText === "" || insText.includes("\n")) {
			handled = false;
			return;
		}
		const line = doc.lineAt(fromA);
		const start = gridStart(line.text);
		if (start < 0 || !lineInMusic(tr.startState, fromA)) {
			handled = false;
			return;
		}
		const text = insText.replace(/\./g, " "); // double-space->". " revert
		let to = fromA;
		// overtype: replace the char(s) under the cursor, but only within the grid
		// content and never past the end of the line (so appending still works)
		if (fromA - line.from >= start && fromA < line.to) {
			to = Math.min(line.to, fromA + text.length);
		}
		if (text === insText && to === fromA) {
			handled = false; // nothing to change; let it through untouched
			return;
		}
		newChange = { from: fromA, to, insert: text };
		changed = true;
	});

	if (!handled || !changed || !newChange) return tr;
	const c = newChange as { from: number; to: number; insert: string };
	return {
		changes: c,
		selection: { anchor: c.from + c.insert.length },
		scrollIntoView: true,
		userEvent: "input.type",
	};
});

const gridKeys = Prec.highest(
	keymap.of([
		// Enter inside a music block = a bare newline (no auto-indent / list continue).
		{
			key: "Enter",
			run: (view) => {
				const { state } = view;
				const sel = state.selection.main;
				if (state.selection.ranges.length !== 1 || !sel.empty) return false;
				if (!lineInMusic(state, sel.head)) return false;
				view.dispatch(state.update(state.replaceSelection("\n"), { scrollIntoView: true, userEvent: "input" }));
				return true;
			},
		},
		// Backspace mirrors overtype: inside a grid row, turn the char to the left
		// into `-` and step left (so columns stay aligned). At the very end of the
		// row, or in the label, fall back to a normal delete.
		{
			key: "Backspace",
			run: (view) => {
				const { state } = view;
				const sel = state.selection.main;
				if (state.selection.ranges.length !== 1 || !sel.empty) return false;
				const pos = sel.head;
				if (!lineInMusic(state, pos)) return false;
				const line = state.doc.lineAt(pos);
				if (pos === line.from) return false; // line start -> default (join lines)
				const start = gridStart(line.text);
				const col = pos - line.from;
				if (start >= 0 && col > start && pos < line.to) {
					// grid content: restore the row's own fill (`-` on string/staff rows,
					// space on note rows), stepping over an existing fill / barline
					const fill = fillChar(line.text);
					const prev = state.doc.sliceString(pos - 1, pos);
					if (prev === fill || prev === "|") {
						view.dispatch(state.update({ selection: { anchor: pos - 1 }, scrollIntoView: true }));
					} else {
						view.dispatch(state.update({ changes: { from: pos - 1, to: pos, insert: fill }, selection: { anchor: pos - 1 }, scrollIntoView: true, userEvent: "delete.backward" }));
					}
					return true;
				}
				// anywhere else in the block (gutter, EOL, H:/L:, directives): delete a
				// single character, never a soft-tab's worth of spaces
				view.dispatch(state.update({ changes: { from: pos - 1, to: pos }, selection: { anchor: pos - 1 }, scrollIntoView: true, userEvent: "delete.backward" }));
				return true;
			},
		},
	])
);

export function musicGridExtension(): Extension {
	return [gridInput, gridKeys];
}
