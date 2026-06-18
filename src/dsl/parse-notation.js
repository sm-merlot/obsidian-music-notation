// ASCII-staff notation parser. The user literally draws a staff: rows of `-` are
// the 5 staff lines, blank rows between/around are spaces; each text row is one
// diatonic step. Pitch = vertical position (anchored by clef). A note is `x`
// (natural per key), `#` (sharp), `b` (flat) or `n` (natural) at its row+column;
// `_` sustains the previous note (duration). `|` = barline. Reuses tab's column
// = time-unit idea, but durations are EXPLICIT (onset + trailing `_`).

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const stepUp = (p) =>
	p.letter === "B"
		? { letter: "C", octave: p.octave + 1 }
		: { letter: LETTERS[LETTERS.indexOf(p.letter) + 1], octave: p.octave };
const stepDown = (p) =>
	p.letter === "C"
		? { letter: "B", octave: p.octave - 1 }
		: { letter: LETTERS[LETTERS.indexOf(p.letter) - 1], octave: p.octave };
function stepBy(p, n) {
	let q = { ...p };
	while (n > 0) { q = stepUp(q); n--; }
	while (n < 0) { q = stepDown(q); n++; }
	return q;
}

// bottom staff line per clef
const BOTTOM_LINE = { treble: { letter: "E", octave: 4 }, bass: { letter: "G", octave: 2 } };

const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
const keyAlter = (letter, fifths) =>
	fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(letter) ? 1
	: fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1
	: 0;

const NOTE_CHARS = "xX#bn";
function syllablesFor(t) {
	const out = []; const re = /\S+/g; let m;
	while ((m = re.exec(t || ""))) out.push({ col: m.index, raw: m[0] });
	return out;
}

export function parseNotation(src) {
	const lines = src.replace(/\r/g, "").split("\n");
	const d = { mode: "notation", clef: "treble", key: "C", meter: "4/4", unit: "1/8" };
	const body = [];
	for (const l of lines) {
		const m = l.match(/^\s*(mode|clef|key|meter|unit|title)\s*:\s*(.+?)\s*$/);
		if (m) { d[m[1]] = m[2]; continue; }
		if (/^\s*chord\s+\S/i.test(l)) continue; // chord-diagram defs handled elsewhere
		body.push(l);
	}
	const [beats, beatType] = d.meter.split("/").map(Number);
	const [un, ud] = String(d.unit).split("/").map(Number);
	const fifths = FIFTHS[d.key] ?? 0;
	const directives = { ...d, beats, beatType, unitFrac: un / ud, fifths };

	// split body into systems by [Section]; each system = staff rows + H:/L:
	const systems = [];
	let cur = { section: null, rows: [], lyric: null, chordRow: null };
	const pushCur = () => {
		// trim leading/trailing all-blank rows (padding, not pitches)
		while (cur.rows.length && cur.rows[0].trim() === "") cur.rows.shift();
		while (cur.rows.length && cur.rows[cur.rows.length - 1].trim() === "") cur.rows.pop();
		if (cur.rows.length) systems.push(cur);
		cur = { section: null, rows: [], lyric: null, chordRow: null };
	};
	for (const l of body) {
		const sec = l.match(/^\s*\[(.+?)\]\s*$/);
		if (sec) { pushCur(); cur.section = sec[1]; continue; }
		const lab = l.match(/^\s*([A-Za-z]+)\s*:\s?(.*)$/);
		if (lab && /^[Ll]$/.test(lab[1])) { cur.lyric = lab[2]; continue; }
		if (lab && /^[Hh]$/.test(lab[1])) { cur.chordRow = lab[2]; continue; }
		cur.rows.push(l);
	}
	pushCur();

	const out = { directives, systems: [] };
	for (const sys of systems) {
		out.systems.push(resolveSystem(sys, directives));
	}
	return out;
}

function resolveSystem(sys, dir) {
	const rows = sys.rows;
	const width = Math.max(0, ...rows.map((r) => r.length));
	// A STAFF line spans (most of) the width; a short dash is a ledger line
	// (cosmetic). Anchor on the lowest full-width dash row = bottom staff line.
	const dashCount = (r) => (r.match(/-/g) || []).length;
	const isStaffLine = (r) => dashCount(r) >= Math.max(4, width * 0.5);
	let bottomLineIdx = -1;
	rows.forEach((r, i) => { if (isStaffLine(r)) bottomLineIdx = i; });
	if (bottomLineIdx === -1) rows.forEach((r, i) => { if (r.includes("-")) bottomLineIdx = i; });
	if (bottomLineIdx === -1) bottomLineIdx = rows.length - 1;
	const base = BOTTOM_LINE[dir.clef] || BOTTOM_LINE.treble;
	const pitchOfRow = (i) => stepBy(base, bottomLineIdx - i); // rows above = higher

	// onsets per row: {col, span, alterOverride|null}
	const onsetsByCol = new Map(); // col -> [{step, alter, octave}]
	const noteCols = new Set();
	rows.forEach((r, i) => {
		const p = pitchOfRow(i);
		for (let c = 0; c < r.length; c++) {
			const ch = r[c];
			if (!NOTE_CHARS.includes(ch)) continue;
			// duration = onset + trailing '_'
			let span = 1;
			while (r[c + span] === "_") span++;
			const override = ch === "#" ? 1 : ch === "b" ? -1 : ch === "n" ? 0 : null;
			const alter = override === null ? keyAlter(p.letter, dir.fifths) : override;
			if (!onsetsByCol.has(c)) onsetsByCol.set(c, []);
			onsetsByCol.get(c).push({ step: p.letter, alter, octave: p.octave, span });
			noteCols.add(c);
			c += span - 1;
		}
	});

	// bar boundaries: columns where any staff row has '|'
	const barCols = [];
	rows.forEach((r) => { for (let c = 0; c < r.length; c++) if (r[c] === "|") barCols.push(c); });
	const bounds = [...new Set(barCols)].sort((a, b) => a - b);

	// build events per bar (a column with onsets = a chord; rest fills gaps)
	const segs = [];
	let start = 0;
	for (const b of bounds.concat([width])) { segs.push([start, b]); start = b + 1; }

	const lyr = sys.lyric ? syllablesFor(sys.lyric) : [];
	const chordToks = sys.chordRow ? syllablesFor(sys.chordRow) : [];

	const bars = segs
		.filter(([s, e]) => e > s)
		.map(([s, e]) => {
			const cols = [...onsetsByCol.keys()].filter((c) => c >= s && c < e).sort((a, b) => a - b);
			const events = [];
			let cursor = s;
			for (const c of cols) {
				if (c > cursor) events.push({ col: cursor, rest: true, durFrac: (c - cursor) * dir.unitFrac, notes: [] });
				const notes = onsetsByCol.get(c);
				const span = Math.max(...notes.map((n) => n.span));
				events.push({ col: c, durFrac: span * dir.unitFrac, notes });
				cursor = c + span;
			}
			if (cursor < e) events.push({ col: cursor, rest: true, durFrac: (e - cursor) * dir.unitFrac, notes: [] });
			// attach lyrics/chords (absolute column) to nearest non-rest event
			const noteEvents = events.filter((ev) => !ev.rest && ev.col >= s && ev.col < e);
			const nearest = (col) => noteEvents.reduce((best, ev) => (best == null || Math.abs(ev.col - col) < Math.abs(best.col - col) ? ev : best), null);
			for (const t of lyr) if (t.col >= s && t.col < e) { const ev = nearest(t.col); if (ev) (ev.syllables ||= []).push(t.raw); }
			for (const t of chordToks) if (t.col >= s && t.col < e) { const ev = nearest(t.col); if (ev) ev.chord = t.raw; }
			return { events };
		});

	return { section: sys.section, bars };
}
