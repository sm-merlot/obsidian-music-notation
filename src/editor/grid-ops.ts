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
	clefs: string[];
}

function directives(lines: string[], b: Block): Dir {
	const d: Dir = { mode: null, beats: 4, beatType: 4, unitNum: 1, unitDenom: 16, tuning: ["E", "A", "D", "G", "B", "e"], clefs: ["treble"] };
	for (let i = b.start; i <= b.end; i++) {
		const m = lines[i].match(/^\s*(mode|meter|unit|tuning|clef)\s*:\s*(.+?)\s*$/i);
		if (!m) continue;
		const v = m[2].trim();
		switch (m[1].toLowerCase()) {
			case "mode":
				d.mode = v;
				break;
			case "clef":
				d.clefs = v.split(/[\s,]+/).filter(Boolean);
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

const isHL = (t: string) => /^\s*[HhLl]\s*:/.test(t);

/** Full line span [top, bot] of the system containing `line` (staff + H:/L: rows
 *  + interior single blanks), or null. Crosses a SINGLE blank (interior pitch
 *  step) but stops at 2+ blanks (a stave separator), a section, or the fence. */
function systemSpan(lines: string[], b: Block, line: number): [number, number] | null {
	const inSystem = (t: string) => gridStart(t) >= 0 || isHL(t);
	if (!inSystem(lines[line])) {
		let j = line;
		while (j >= b.start && !(gridStart(lines[j]) >= 0)) j--;
		if (j < b.start) return null;
		line = j;
	}
	// In notation a single blank line is an interior pitch step (cross it); in tab
	// any blank line separates staves (stop at it).
	const notation = directives(lines, b).mode === "notation";
	const isBlank = (i: number) => (lines[i] || "").trim() === "";
	let top = line;
	let bot = line;
	while (top - 1 >= b.start) {
		if (inSystem(lines[top - 1])) { top--; continue; }
		if (notation && isBlank(top - 1) && top - 2 >= b.start && inSystem(lines[top - 2])) { top -= 2; continue; }
		break;
	}
	while (bot + 1 <= b.end) {
		if (inSystem(lines[bot + 1])) { bot++; continue; }
		if (notation && isBlank(bot + 1) && bot + 2 <= b.end && inSystem(lines[bot + 2])) { bot += 2; continue; }
		break;
	}
	return [top, bot];
}

/** Grid-row (staff/note) line indices of the system containing `line`. */
function systemGridRows(lines: string[], b: Block, line: number): number[] {
	const span = systemSpan(lines, b, line);
	if (!span) return [];
	const rows: number[] = [];
	for (let i = span[0]; i <= span[1]; i++) if (gridStart(lines[i]) >= 0) rows.push(i);
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

const isSep = (t: string) =>
	/^\s*=+\s*$/.test(t) || /^\s*\[.*\]\s*$/.test(t) || /^\s*(mode|clef|key|meter|unit|tuning|capo|title|transpose)\s*:/i.test(t);

/** Full line span [top, bot] of the "set of staves" around `line` — bounded by a
 *  `===` continuation line, a section, a directive, or the fence (NOT by blank
 *  lines, so it spans every stave of a multi-staff system). */
function chunkSpan(lines: string[], b: Block, line: number): [number, number] {
	let top = line;
	let bot = line;
	while (top - 1 >= b.start && !isSep(lines[top - 1])) top--;
	while (bot + 1 <= b.end && !isSep(lines[bot + 1])) bot++;
	return [top, bot];
}

/** Append a fresh empty bar to every grid row of the current system. In notation
 *  this spans the whole multi-staff set (all staves get a bar at once); in tab it's
 *  the single system. Works on a sheet with no bars yet (adds the first barline). */
export function addBar(lines: string[], pos: Pos): Edit | null {
	const cur = pos.line;
	const b = blockAt(lines, cur);
	if (!b) return null;
	const d = directives(lines, b);
	let rows: number[];
	if (d.mode === "notation") {
		// every staff in the set (across double-blanks, up to a === / section / fence)
		const [top, bot] = chunkSpan(lines, b, cur);
		rows = [];
		for (let i = top; i <= bot; i++) if (gridStart(lines[i]) >= 0) rows.push(i);
	} else {
		rows = systemGridRows(lines, b, cur);
	}
	if (!rows.length) return null;
	const inner = lines.slice(b.start, b.end + 1);
	const R = Math.max(...rows.map((r) => lines[r].length)); // current right edge
	// bar width = an existing bar's width (so it matches), else from meter/unit
	let w = 0;
	for (const r of rows) if (lines[r].includes("|")) w = Math.max(w, lastBarWidth(lines[r]));
	if (!w) w = unitsPerBar(d);
	const cursorLine = rows.includes(cur) ? cur : rows[0];
	const systemHasBars = rows.some((r) => lines[r].includes("|"));
	let cursorCh = R;
	for (const r of rows) {
		const i = r - b.start;
		const f = fillChar(lines[r]);
		const padded = lines[r] + f.repeat(Math.max(0, R - lines[r].length));
		if (padded.endsWith("|")) inner[i] = padded + f.repeat(w) + "|"; // closing-bar style: ...| -> ...|----|
		else if (padded.includes("|") || !systemHasBars) inner[i] = padded + "|" + f.repeat(w); // open style: ...- -> ...-|----
		else inner[i] = padded + f.repeat(w + 1); // ledger/accidental row in a barred system: keep aligned, no stray |
		if (r === cursorLine) cursorCh = padded.endsWith("|") ? R : R + 1;
	}
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: cursorLine, ch: cursorCh } };
}

/** Continue the current set of staves on a new line: insert a `===` then a blank
 *  copy of the whole set (all staves, ready for the next bars). */
export function addContinuation(lines: string[], pos: Pos): Edit | null {
	const b = blockAt(lines, pos.line);
	if (!b) return null;
	const [top, bot] = chunkSpan(lines, b, pos.line);
	let rows = lines.slice(top, bot + 1);
	let s = 0;
	let e = rows.length - 1;
	while (s <= e && rows[s].trim() === "") s++;
	while (e >= s && rows[e].trim() === "") e--;
	rows = rows.slice(s, e + 1);
	if (!rows.length) return null;
	const clone = rows.map(blankRow);
	const block = ["===", ...clone];
	const inner = lines.slice(b.start, b.end + 1);
	const at = bot - b.start + 1;
	inner.splice(at, 0, ...block);
	let fg = clone.findIndex((t) => gridStart(t) >= 0);
	if (fg < 0) fg = 0;
	const topDoc = b.start + at + 1 + fg; // skip the === line
	const sc = gridStart(clone[fg]);
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: topDoc, ch: sc >= 0 ? sc : 0 } };
}

/** Width of the last (rightmost non-empty) bar on a barred grid row. */
function lastBarWidth(text: string): number {
	const s = gridStart(text);
	if (s < 0) return 0;
	const bars = text.slice(s).split("|");
	for (let k = bars.length - 1; k >= 0; k--) if (bars[k].length > 0) return bars[k].length;
	return 0;
}

/** Scaffold the first staff(s) in an empty block (just directives, no grid drawn
 *  yet): a tab stave from `tuning`, or notation staves per the `clef:` list (grand
 *  = treble + gap + bass), each with one empty bar. */
function createStaves(lines: string[], b: Block, pos: Pos): Edit {
	const d = directives(lines, b);
	const w = unitsPerBar(d);
	// Left buffer so an H:/L: label (2 chars) can be prepended later with its `|`
	// aligning to the staff's opening `|` — no need to shuffle the bar over.
	const pad = "  ";
	const staff5 = () => {
		const line = pad + "|" + "-".repeat(w) + "|";
		const sp = pad + "|" + " ".repeat(w) + "|";
		return [line, sp, line, sp, line, sp, line, sp, line]; // 5 lines + 4 spaces, top→bottom
	};
	let rows: string[];
	if (d.mode === "tab") {
		const labels = [...d.tuning].reverse(); // tuning is low→high; tab rows are high→low
		rows = labels.map((l) => `${l}:  ` + "-".repeat(w));
	} else {
		rows = [];
		d.clefs.forEach((c, i) => {
			if (i) rows.push("", ""); // double-blank separates staves
			rows.push(...(c.toLowerCase() === "grand" ? [...staff5(), "", "", ...staff5()] : staff5()));
		});
	}
	const inner = lines.slice(b.start, b.end + 1);
	const at = Math.max(0, Math.min(inner.length, pos.line - b.start));
	if (at > 0 && (inner[at - 1] || "").trim() !== "") rows = ["", ...rows]; // blank after the header
	inner.splice(at, 0, ...rows);
	let fg = rows.findIndex((t) => gridStart(t) >= 0);
	if (fg < 0) fg = 0;
	const s = gridStart(rows[fg]);
	const ch = s >= 0 ? s + (rows[fg][s] === "|" ? 1 : 0) : 0;
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: b.start + at + fg, ch } };
}

/** One-command entry: empty block -> scaffold staff; blank line -> new stave;
 *  on a grid row -> add a bar. */
export function addBarOrSystem(lines: string[], pos: Pos): Edit | null {
	const b = blockAt(lines, pos.line);
	if (!b) return null;
	let hasStaff = false;
	for (let i = b.start; i <= b.end; i++) if (gridStart(lines[i]) >= 0) { hasStaff = true; break; }
	if (!hasStaff) return createStaves(lines, b, pos);
	if ((lines[pos.line] || "").trim() === "") return addSystem(lines, pos);
	return addBar(lines, pos);
}

/** Add a new blank system (stave) below the current one. Tab only (derives the
 *  string rows from `tuning`, drawn high→low). */
export function addSystem(lines: string[], pos: Pos): Edit | null {
	const cur = pos.line;
	const b = blockAt(lines, cur);
	if (!b) return null;
	const span = systemSpan(lines, b, cur);
	if (!span) return null;
	// clone the WHOLE system emptied — staff lines, interior blanks, and the
	// H:/L: rows (keeping their labels) — so the new stave has the same scaffolding.
	const [top, bot] = span;
	const clone: string[] = [];
	for (let i = top; i <= bot; i++) clone.push(blankRow(lines[i]));
	// 2 empty lines separate staves (ledger notes reach at most 1 empty line out,
	// so a 2-line gap keeps the staves distinct). Pad both sides.
	const block = ["", "", ...clone, "", ""];
	const inner = lines.slice(b.start, b.end + 1);
	const at = bot - b.start + 1;
	inner.splice(at, 0, ...block);
	// cursor on the first staff/note row of the new stave (skip leading H:/L:)
	let firstGrid = clone.findIndex((t) => gridStart(t) >= 0);
	if (firstGrid < 0) firstGrid = 0;
	const topDoc = b.start + at + 2 + firstGrid;
	const s = gridStart(clone[firstGrid]);
	return { start: b.start, end: b.end, newInner: inner, cursor: { line: topDoc, ch: s >= 0 ? s : 0 } };
}

/** Empty a row: keep its label/gutter and barlines, replace content with fill.
 *  Handles staff/note rows, H:/L: rows, and blank interior rows. */
function blankRow(text: string): string {
	if (text.trim() === "") return "";
	const hl = text.match(/^\s*[HhLl]\s*:\s?/); // H:/L: -> keep label, blank chords/lyrics (space)
	if (hl) return text.slice(0, hl[0].length) + text.slice(hl[0].length).replace(/[^|]/g, " ");
	const s = gridStart(text);
	const f = fillChar(text);
	// labelled row (tab `e:`) -> keep the label; otherwise keep the leading gutter
	// (the spaces before an opening `|`) so it isn't turned into dashes.
	const keep = s > 0 ? s : text.match(/^\s*/)![0].length;
	return text.slice(0, keep) + text.slice(keep).replace(/[^|]/g, f);
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
