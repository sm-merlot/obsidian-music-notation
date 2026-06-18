// DSL tab parser: directive header + ASCII grid -> rhythmic model.
//
// Core idea ("column-gap timeline"): a tab grid encodes time by column. We take
// the UNION of note onsets across all strings in a bar; each onset column is an
// event (a tab chord). An event's duration = gap (in columns) to the next onset,
// times `unit`. This collapses the 6-string grid into a single rhythmic voice of
// tab chords with exact durations — no lossy guessing.

const NOTE_LEN = {
	// quarter-fraction (in `unit`s handled by caller) -> {type, dots}
};

// MIDI for an open string given its letter+octave; +fret semitones.
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Default tuning octaves per standard 6-string (string label -> midi of open).
// We resolve octaves from a canonical EADGBE map but allow label overrides.
const DEFAULT_OPEN = { e: 64, B: 59, G: 55, D: 50, A: 45, E: 40 };

function midiToPitch(midi) {
	const n = PC[midi % 12];
	return { step: n[0], alter: n.length > 1 ? 1 : 0, octave: Math.floor(midi / 12) - 1 };
}

export function parseDirectives(lines) {
	const d = { mode: "tab", meter: "4/4", unit: "1/8", tuning: null, capo: 0 };
	for (const l of lines) {
		const m = l.match(/^\s*(mode|meter|unit|tuning|capo|title)\s*:\s*(.+?)\s*$/);
		if (m) d[m[1]] = m[2];
	}
	d.capo = Number(d.capo) || 0;
	const [beats, beatType] = d.meter.split("/").map(Number);
	d.beats = beats;
	d.beatType = beatType;
	// unit "1/8" -> fraction of a whole note
	const [un, ud] = String(d.unit).split("/").map(Number);
	d.unitFrac = un / ud;
	return d;
}

// A connector char between two frets on a string: h hammer, p pull, s slide,
// ^ tie. Captured so it links the new onset back to the previous one.
const CONNECTORS = "hps^";

// Tokenize one string's bar content into [{col, fret, conn}] onsets. `-` = no
// onset. Each column is a time slot, so EACH digit is its own note (e.g. `333`
// = three separate frets, not fret 333). A fret of 10+ is written in parens —
// `(12)` — occupying one slot. `conn` is the connector char since the previous
// onset (links this note to the prior).
function onsetsFor(barText) {
	const onsets = [];
	let pendingConn = null;
	for (let i = 0; i < barText.length; i++) {
		const c = barText[i];
		if (c === "(") {
			const close = barText.indexOf(")", i);
			const num = close > i ? barText.slice(i + 1, close).replace(/[^0-9]/g, "") : "";
			if (num) {
				onsets.push({ col: i, fret: Number(num), conn: pendingConn });
				pendingConn = null;
				i = close;
				continue;
			}
		}
		if (c >= "0" && c <= "9") {
			onsets.push({ col: i, fret: Number(c), conn: pendingConn });
			pendingConn = null;
		} else if (CONNECTORS.includes(c) && onsets.length) {
			pendingConn = c; // only meaningful between two frets
		}
	}
	return onsets;
}

// Build events for one bar from per-string bar texts.
// strings: [{label, open, barText}], colsPerBar: width used for the trailing gap.
function eventsForBar(strings, unitFrac, colsPerBar) {
	const byCol = new Map(); // col -> [{string,label,fret,open}]
	for (let s = 0; s < strings.length; s++) {
		for (const o of onsetsFor(strings[s].barText)) {
			if (!byCol.has(o.col)) byCol.set(o.col, []);
			byCol.get(o.col).push({
				stringNum: strings[s].num,
				label: strings[s].label,
				open: strings[s].open,
				fret: o.fret,
				col: o.col,
				conn: o.conn,
			});
		}
	}
	const cols = [...byCol.keys()].sort((a, b) => a - b);
	const events = [];
	for (let k = 0; k < cols.length; k++) {
		const col = cols[k];
		const next = k + 1 < cols.length ? cols[k + 1] : colsPerBar;
		const gap = Math.max(1, next - col);
		events.push({
			col,
			durFrac: gap * unitFrac,
			notes: byCol.get(col).map((n) => ({
				stringNum: n.stringNum,
				fret: n.fret,
				conn: n.conn,
				...midiToPitch(n.open + n.fret),
			})),
		});
	}
	return events;
}

// A grid row: a label then `:` or `|` then content. Single-letter labels are
// strings (e/B/G/D/A/E, case distinguishes high/low E); `L` = aligned lyric row;
// `H` (harmony) = aligned chord row. Both lyric & chord tokens align to columns.
const ROW_LINE = /^\s*([A-Za-z]+)\s*[|:]\s?(.*)$/;
const isLyricLabel = (s) => s === "L" || s === "l";
const isChordLabel = (s) => s === "H" || /^chords?$/i.test(s);

// Extract syllables from one bar of an aligned lyric row: each whitespace-
// delimited token is a syllable at its start column. Leading/trailing '-' marks
// word continuation for syllabification.
function syllablesFor(barText) {
	const out = [];
	const re = /\S+/g;
	let m;
	while ((m = re.exec(barText))) out.push({ col: m.index, raw: m[0] });
	return out;
}

export function parseTab(src) {
	const allLines = src.replace(/\r/g, "").split("\n");
	const directiveLines = [];
	const rest = [];
	let inHeader = true;
	for (const l of allLines) {
		if (inHeader && /^\s*(mode|meter|unit|tuning|capo|title)\s*:/.test(l)) {
			directiveLines.push(l);
			continue;
		}
		if (l.trim() === "") {
			rest.push(l);
			continue;
		}
		inHeader = false;
		rest.push(l);
	}
	const dir = parseDirectives(directiveLines);

	// Resolve open-string midis from tuning labels if given, else defaults.
	// tuning: "e B G D A E" top->bottom. Map each label to a midi using octave
	// heuristics from DEFAULT_OPEN by letter (case-sensitive e vs E distinguishes
	// high vs low E); drop-D etc come from changing a label.
	let tuningLabels = null;
	if (dir.tuning) tuningLabels = dir.tuning.trim().split(/\s+/);

	const systems = [];
	let curSection = null;
	let i = 0;
	while (i < rest.length) {
		const line = rest[i];
		const sec = line.match(/^\s*\[(.+?)\]\s*$/);
		if (sec) {
			curSection = sec[1];
			i++;
			continue;
		}
		if (ROW_LINE.test(line)) {
			// collect consecutive grid rows (string rows + optional lyric row)
			const rows = [];
			while (i < rest.length && ROW_LINE.test(rest[i])) {
				const m = rest[i].match(ROW_LINE);
				rows.push({ label: m[1], content: m[2] });
				i++;
			}
			const lyricRow = rows.find((r) => isLyricLabel(r.label));
			const chordRow = rows.find((r) => isChordLabel(r.label));
			const stringLines = rows.filter(
				(r) =>
					r.label.length === 1 &&
					!isLyricLabel(r.label) &&
					!isChordLabel(r.label)
			);
			systems.push({
				section: curSection,
				lyricLine: lyricRow ? lyricRow.content : null,
				chordLine: chordRow ? chordRow.content : null,
				stringLines,
			});
			curSection = null;
			continue;
		}
		i++;
	}

	// Resolve each system into bars of events.
	const out = { directives: dir, systems: [] };
	for (const sys of systems) {
		const numStrings = sys.stringLines.length;
		const strings = sys.stringLines.map((sl, idx) => {
			const label = sl.label;
			// string number: 1 = top line (highest), increasing downward
			const num = idx + 1;
			let open = DEFAULT_OPEN[label] ?? DEFAULT_OPEN[label.toUpperCase()] ?? 40;
			if (tuningLabels && tuningLabels[idx]) {
				const tl = tuningLabels[idx];
				open = DEFAULT_OPEN[tl] ?? DEFAULT_OPEN[tl.toUpperCase()] ?? open;
			}
			// sanitize raw-tab noise: {annotations}, a trailing repeat marker
			// (` x2`), and a trailing barline; technique chars (h/p/b/s and
			// slashes) are left in place — onsetsFor only reads digit runs.
			const content = sl.content
				.replace(/\{[^}]*\}/g, "")
				.replace(/\s+x\d+\s*$/i, "")
				.replace(/\|\s*$/, "");
			return { label, num, open, bars: content.split("|") };
		});
		// align bar count
		const barCount = Math.max(...strings.map((s) => s.bars.length));
		const bars = [];
		const allEvents = []; // across the system, with absolute source columns
		let cumOffset = 0; // running char offset incl. the '|' separators
		for (let b = 0; b < barCount; b++) {
			const barStrings = strings.map((s) => ({
				num: s.num,
				label: s.label,
				open: s.open,
				barText: (s.bars[b] || "").replace(/\s+$/, ""),
			}));
			const colsPerBar = Math.max(1, ...barStrings.map((s) => s.barText.length));
			const events = eventsForBar(barStrings, dir.unitFrac, colsPerBar);
			for (const e of events) {
				e.absCol = cumOffset + e.col;
				allEvents.push(e);
			}
			cumOffset += colsPerBar + 1; // +1 for the '|' barline char
			bars.push({ events, colsPerBar });
		}
		// Map aligned lyric/chord rows to events by absolute character column
		// across the whole system (rows need no '|' — type them above, aligned).
		const nearest = (col) => {
			let best = allEvents[0];
			let bestD = Infinity;
			for (const e of allEvents) {
				const d = Math.abs(e.absCol - col);
				if (d < bestD) {
					bestD = d;
					best = e;
				}
			}
			return best;
		};
		if (sys.lyricLine && allEvents.length) {
			for (const syl of syllablesFor(sys.lyricLine)) {
				(nearest(syl.col).syllables ||= []).push(syl.raw);
			}
		}
		if (sys.chordLine && allEvents.length) {
			for (const tok of syllablesFor(sys.chordLine)) {
				nearest(tok.col).chord = tok.raw;
			}
		}
		out.systems.push({ section: sys.section, bars });
	}
	return out;
}
