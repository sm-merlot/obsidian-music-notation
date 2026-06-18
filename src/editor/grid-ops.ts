// Pure, line-array operations behind the music editing COMMANDS (add bar, add
// system/stave, format/align). Kept free of CodeMirror/Obsidian so they can be
// unit-tested headlessly; main.ts adapts them to the Obsidian Editor.

const DIRECTIVE = /^\s*(mode|meter|unit|tuning|capo|title|transpose|clef|key)\s*:/i;
const GRID = /^[\s\-|()0-9xX#bn_^hps]*$/;
const GRID_TOKEN = /[-|0-9xX#bn]/;

/** Column where grid content starts (after an optional `e:`/`F#:` label), or -1. */
export function gridStart(text: string): number {
	if (DIRECTIVE.test(text)) return -1;
	if (/^\s*[HhLl]\s*:/.test(text)) return -1;
	if (/^\s*\[.*\]\s*$/.test(text)) return -1;
	const lab = text.match(/^(\s*[A-Ga-g][#b]?\s*:\s*)(.*)$/);
	const start = lab ? lab[1].length : 0;
	const content = text.slice(start);
	if (content === "" || !GRID.test(content) || !GRID_TOKEN.test(content)) return -1;
	return start;
}

/** Fill char for a grid row: `-` for dash rows (strings/staff), space for note rows. */
export function fillChar(text: string): string {
	const s = gridStart(text);
	const c = s >= 0 ? text.slice(s) : text;
	const dash = (c.match(/-/g) || []).length;
	const space = (c.match(/ /g) || []).length;
	return dash >= space ? "-" : " ";
}

export interface Block {
	fenceOpen: number;
	start: number; // first inner line (0-based)
	end: number; // last inner line
	fenceClose: number; // -1 if unterminated
}

/** Inner ranges of every ```music fenced block (0-based line indices). */
export function findBlocks(lines: string[]): Block[] {
	const out: Block[] = [];
	let open = -1;
	let ch = "";
	let len = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^\s*([`~]{3,})(.*)$/);
		if (!m) continue;
		if (open < 0) {
			if (m[2].trim() === "music") {
				open = i;
				ch = m[1][0];
				len = m[1].length;
			}
		} else if (m[1][0] === ch && m[1].length >= len && m[2].trim() === "") {
			out.push({ fenceOpen: open, start: open + 1, end: i - 1, fenceClose: i });
			open = -1;
		}
	}
	if (open >= 0) out.push({ fenceOpen: open, start: open + 1, end: lines.length - 1, fenceClose: -1 });
	return out;
}

export function blockAt(lines: string[], line: number): Block | null {
	return findBlocks(lines).find((b) => line >= b.start && line <= (b.fenceClose < 0 ? b.end : b.fenceClose)) || null;
}

interface Dir {
	mode: string | null;
	beats: number;
	beatType: number;
	unitNum: number;
	unitDenom: number;
	tuning: string[];
}

function directives(lines: string[], b: Block): Dir {
	const d: Dir = { mode: null, beats: 4, beatType: 4, unitNum: 1, unitDenom: 16, tuning: ["E", "A", "D", "G", "B", "e"] };
	for (let i = b.start; i <= b.end; i++) {
		const m = lines[i].match(/^\s*(mode|meter|unit|tuning)\s*:\s*(.+?)\s*$/i);
		if (!m) continue;
		const v = m[2].trim();
		switch (m[1].toLowerCase()) {
			case "mode":
				d.mode = v;
				break;
			case "meter": {
				const [a, c] = v.split("/").map(Number);
				if (a && c) {
					d.beats = a;
					d.beatType = c;
				}
				break;
			}
			case "unit": {
				const [a, c] = v.split("/").map(Number);
				if (a && c) {
					d.unitNum = a;
					d.unitDenom = c;
				}
				break;
			}
			case "tuning":
				d.tuning = v.split(/\s+/);
				break;
		}
	}
	return d;
}

/** Columns of one bar = number of `unit`s that fill a measure. */
export function unitsPerBar(d: Dir): number {
	return Math.max(1, Math.round((d.beats / d.beatType) * (d.unitDenom / d.unitNum)));
}

/** Grid-row line indices of the system containing `line` (H:/L: rows attach but
 *  aren't returned; blank/section/directive lines bound the system). */
function systemGridRows(lines: string[], b: Block, line: number): number[] {
	const inSystem = (t: string) => gridStart(t) >= 0 || /^\s*[HhLl]\s*:/.test(t);
	if (!inSystem(lines[line])) {
		// not on a system row — fall back to the last grid row above in the block
		let j = line;
		while (j >= b.start && !(gridStart(lines[j]) >= 0)) j--;
		if (j < b.start) return [];
		line = j;
	}
	let top = line;
	let bot = line;
	while (top - 1 >= b.start && inSystem(lines[top - 1])) top--;
	while (bot + 1 <= b.end && inSystem(lines[bot + 1])) bot++;
	const rows: number[] = [];
	for (let i = top; i <= bot; i++) if (gridStart(lines[i]) >= 0) rows.push(i);
	return rows;
}

export interface Pos {
	line: number;
	ch: number;
}

export interface Edit {
	start: number; // inner block range to replace (0-based, inclusive)
	end: number;
	newInner: string[];
	cursor: { line: number; ch: number };
}

/** Append a fresh empty bar (`|` + a measure of fill) to every grid row in the
 *  current system, after padding them to equal width so barlines line up. */
export function addBar(lines: string[], pos: Pos): Edit | null {
	const cur = pos.line;
	const b = blockAt(lines, cur);
	if (!b) return null;
	const rows = systemGridRows(lines, b, cur);
	if (!rows.length) return null;
	const d = directives(lines, b);
	const w = unitsPerBar(d);
	const inner = lines.slice(b.start, b.end + 1);
	const maxLen = Math.max(...rows.map((r) => lines[r].length));
	const cursorLine = rows.includes(cur) ? cur : rows[0];
	for (const r of rows) {
		const i = r - b.start;
		const padded = inner[i] + fillChar(lines[r]).repeat(maxLen - lines[r].length);
		inner[i] = padded + "|" + fillChar(lines[r]).repeat(w);
	}
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: cursorLine, ch: maxLen + 1 } };
}

/** Add a new blank system (stave) below the current one. Tab only (derives the
 *  string rows from `tuning`, drawn high→low). */
export function addSystem(lines: string[], pos: Pos): Edit | null {
	const cur = pos.line;
	const b = blockAt(lines, cur);
	if (!b) return null;
	const d = directives(lines, b);
	const isTab = d.mode === "tab" || (d.mode === null && systemGridRows(lines, b, cur).some((r) => /^\s*[A-Ga-g][#b]?\s*:/.test(lines[r])));
	if (!isTab) return null;
	const w = unitsPerBar(d);
	const rows = systemGridRows(lines, b, cur);
	const insertAfter = rows.length ? Math.max(...rows) : b.end; // doc line
	const labels = [...d.tuning].reverse(); // tuning is low→high; tab rows are high→low
	const stave = labels.map((l) => `${l}:  ` + "-".repeat(w));
	const block = ["", ...stave];
	const inner = lines.slice(b.start, b.end + 1);
	const at = insertAfter - b.start + 1;
	inner.splice(at, 0, ...block);
	// cursor at start of the new top stave row's content
	const topRowDocLine = b.start + at + 1; // +1 to skip the blank line
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: topRowDocLine, ch: 4 } };
}

/** Align every system in the block: pad each row's bars to the per-column max so
 *  barlines `|` line up across all rows. */
export function formatBlock(lines: string[], pos: Pos): Edit | null {
	const b = blockAt(lines, pos.line);
	if (!b) return null;
	const inner = lines.slice(b.start, b.end + 1);
	// group consecutive grid rows into systems
	let i = 0;
	while (i < inner.length) {
		if (gridStart(inner[i]) < 0) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < inner.length && gridStart(inner[j + 1]) >= 0) j++;
		alignRows(inner, range(i, j));
		i = j + 1;
	}
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: pos.line, ch: 0 } };
}

/** Remove the bar the cursor sits in from every grid row of the system. */
export function removeBar(lines: string[], pos: Pos): Edit | null {
	const b = blockAt(lines, pos.line);
	if (!b) return null;
	const rows = systemGridRows(lines, b, pos.line);
	if (!rows.length) return null;
	const inner = lines.slice(b.start, b.end + 1);
	const idxs = rows.map((r) => r - b.start);
	alignRows(inner, idxs); // equalise bar counts first
	// which bar is the cursor in? count `|` before the cursor on its row
	const curIdx = pos.line - b.start;
	const onRow = idxs.includes(curIdx) ? curIdx : idxs[0];
	const s = gridStart(inner[onRow]);
	const ch = pos.line - b.start === onRow ? Math.max(pos.ch, s) : s;
	const before = inner[onRow].slice(s, ch);
	const barIndex = (before.match(/\|/g) || []).length;
	let newCh = s;
	for (const i of idxs) {
		const s2 = gridStart(inner[i]);
		const bars = inner[i].slice(s2).split("|");
		if (bars.length <= 1) continue;
		bars.splice(Math.min(barIndex, bars.length - 1), 1);
		inner[i] = inner[i].slice(0, s2) + bars.join("|");
		if (i === onRow) {
			// cursor at the start of the bar that shifted into this slot
			const keep = bars.slice(0, Math.min(barIndex, bars.length)).join("|");
			newCh = s2 + keep.length + (barIndex > 0 && barIndex <= bars.length ? 1 : 0);
		}
	}
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: pos.line, ch: newCh } };
}

function range(a: number, b: number): number[] {
	const out = [];
	for (let i = a; i <= b; i++) out.push(i);
	return out;
}

/** Pad each row's bars to the per-column max so barlines line up across rows. */
function alignRows(inner: string[], idxs: number[]) {
	const rows = idxs.map((i) => {
		const s = gridStart(inner[i]);
		return { i, label: inner[i].slice(0, s), bars: inner[i].slice(s).split("|"), fill: fillChar(inner[i]) };
	});
	const nb = Math.max(...rows.map((r) => r.bars.length));
	const widths: number[] = [];
	for (let k = 0; k < nb; k++) widths[k] = Math.max(0, ...rows.map((r) => (r.bars[k] !== undefined ? r.bars[k].length : 0)));
	for (const r of rows) {
		const out: string[] = [];
		for (let k = 0; k < nb; k++) {
			const seg = r.bars[k] !== undefined ? r.bars[k] : "";
			out.push(seg + r.fill.repeat(widths[k] - seg.length));
		}
		inner[r.i] = r.label + out.join("|");
	}
}
