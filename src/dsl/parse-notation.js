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

// tuplet ratio: n notes play in the time of the largest power of two below n
// (3:2 triplet, 5:4 quintuplet, 6:4, 7:4 ...).
const tupletNormal = (n) => {
	if (n <= 1) return n;
	let p = 1;
	while (p * 2 < n) p *= 2;
	return p;
};

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
	const d = { mode: "notation", clef: "treble", key: "C", meter: "4/4", unit: "1/8", transpose: "" };
	const body = [];
	for (const l of lines) {
		const m = l.match(/^\s*(mode|clef|key|meter|unit|title|transpose)\s*:\s*(.+?)\s*$/);
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

	// tuplet brackets: an optional count then `( ... )` on ANY row. The parens
	// mark a COLUMN span (not notes on one row), so a melodic triplet drawn across
	// rows works: every onset whose column falls inside the span is a member.
	// Bare `(` defaults to a triplet (3).
	const tupletSpans = [];
	rows.forEach((r) => {
		for (let c = 0; c < r.length; c++) {
			if (r[c] !== "(") continue;
			let j = c - 1;
			while (j >= 0 && /\d/.test(r[j])) j--;
			const n = j < c - 1 ? parseInt(r.slice(j + 1, c), 10) : 3;
			const close = r.indexOf(")", c + 1);
			if (close === -1) continue;
			// the count digits + `(` are annotation, not time — rests are measured
			// up to here, not to the `(`
			tupletSpans.push({ open: c, close, n, start: j + 1 });
			c = close;
		}
	});
	const spanOf = (col) => tupletSpans.find((sp) => col > sp.open && col < sp.close) || null;

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
			let i = 0;
			while (i < cols.length) {
				const c = cols[i];
				const sp = spanOf(c);
				if (sp && sp.open >= s && sp.close < e) {
					// gather every onset column inside this bracket = tuplet members
					const members = [];
					while (i < cols.length && cols[i] > sp.open && cols[i] < sp.close) members.push(cols[i++]);
					if (sp.start > cursor) events.push({ col: cursor, rest: true, durFrac: (sp.start - cursor) * dir.unitFrac, notes: [] });
					const actual = sp.n || members.length;
					const normal = tupletNormal(actual);
					const total = normal * dir.unitFrac; // tuplet group fills `normal` units
					// each note's length = its share of the column spacing inside the bracket
					const ends = members.map((mc, k) => (k < members.length - 1 ? members[k + 1] : sp.close));
					const weights = members.map((mc, k) => Math.max(1, ends[k] - mc));
					const totW = weights.reduce((a, b) => a + b, 0);
					members.forEach((mc, k) => {
						events.push({
							col: mc,
							durFrac: total * (weights[k] / totW),
							notes: onsetsByCol.get(mc),
							tuplet: { actual, normal, pos: k === 0 ? "start" : k === members.length - 1 ? "stop" : "mid" },
						});
					});
					cursor = sp.close + 1;
					continue;
				}
				if (c > cursor) events.push({ col: cursor, rest: true, durFrac: (c - cursor) * dir.unitFrac, notes: [] });
				const notes = onsetsByCol.get(c);
				const span = Math.max(...notes.map((n) => n.span));
				events.push({ col: c, durFrac: span * dir.unitFrac, notes });
				cursor = c + span;
				i++;
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
