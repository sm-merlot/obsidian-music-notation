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
	let cur = { section: null, rows: [], lyric: null, lyricAbs: null, chordRow: null, chordRowAbs: null };
	const pushCur = () => {
		// trim leading/trailing all-blank rows (padding, not pitches)
		while (cur.rows.length && cur.rows[0].trim() === "") cur.rows.shift();
		while (cur.rows.length && cur.rows[cur.rows.length - 1].trim() === "") cur.rows.pop();
		if (cur.rows.length) systems.push(cur);
		cur = { section: null, rows: [], lyric: null, lyricAbs: null, chordRow: null, chordRowAbs: null };
	};
	for (const l of body) {
		const sec = l.match(/^\s*\[(.+?)\]\s*$/);
		if (sec) { pushCur(); cur.section = sec[1]; continue; }
		const lab = l.match(/^\s*([A-Za-z]+)\s*:\s?(.*)$/);
		// Store both forms of H:/L: rows: `*` = label stripped (relative: content
		// col 0 = beat 1) and `*Abs` = label blanked (absolute columns). With an
		// opening barline the staff and H:/L: share a margin, so absolute columns
		// line up visually; without one we fall back to the relative form.
		const blankLabel = (s) => s.replace(/^(\s*[A-Za-z]+\s*:\s?)/, (m) => " ".repeat(m.length));
		if (lab && /^[Ll]$/.test(lab[1])) { cur.lyric = lab[2]; cur.lyricAbs = blankLabel(l); continue; }
		if (lab && /^[Hh]$/.test(lab[1])) { cur.chordRow = lab[2]; cur.chordRowAbs = blankLabel(l); continue; }
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
			// `acc` = the accidental the user typed (#, b, n) so it's drawn explicitly
			// — e.g. `n` neutralises a key-signature sharp/flat with a ♮.
			onsetsByCol.get(c).push({ step: p.letter, alter, octave: p.octave, span, acc: override });
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
	// An opening barline (a leading `|` with no onsets to its left) sets a shared
	// origin so the staff and H:/L: rows line up by absolute column; the gutter
	// before it (labels etc.) is dropped, and beat 1 is the char right after it.
	let bnds = bounds;
	const hasOpenBar = bnds.length > 0 && ![...onsetsByCol.keys()].some((c) => c < bnds[0]);
	let segStart = 0;
	if (hasOpenBar) { segStart = bnds[0] + 1; bnds = bnds.slice(1); }

	const segs = [];
	let start = segStart;
	for (const b of bnds.concat([width])) { segs.push([start, b]); start = b + 1; }

	// With an opening barline, read H:/L: in absolute columns (ignoring any `|`
	// the user drew there); otherwise use the label-stripped (relative) form.
	const lyrSrc = hasOpenBar ? (sys.lyricAbs || "").replace(/\|/g, " ") : sys.lyric;
	const chordSrc = hasOpenBar ? (sys.chordRowAbs || "").replace(/\|/g, " ") : sys.chordRow;
	const lyr = lyrSrc ? syllablesFor(lyrSrc) : [];
	const chordToks = chordSrc ? syllablesFor(chordSrc) : [];

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
					// the bracket's interior width = the tuplet's played length (in
					// units); triplet notes can't land on exact power-of-two columns,
					// so the notes inside snap to N EVEN slots within that length.
					const total = (sp.close - sp.open - 1) * dir.unitFrac;
					const n = members.length;
					members.forEach((mc, k) => {
						events.push({
							col: mc,
							durFrac: total / n,
							notes: onsetsByCol.get(mc),
							tuplet: { actual, normal, pos: k === 0 ? "start" : k === n - 1 ? "stop" : "mid" },
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
			// lyrics attach to the nearest note (they need a notehead)
			const noteEvents = events.filter((ev) => !ev.rest && ev.col >= s && ev.col < e);
			const nearest = (col) => noteEvents.reduce((best, ev) => (best == null || Math.abs(ev.col - col) < Math.abs(best.col - col) ? ev : best), null);
			for (const t of lyr) if (t.col >= s && t.col < e) { const ev = nearest(t.col); if (ev) (ev.syllables ||= []).push(t.raw); }
			// chords don't need a note: attach to the event at/just-before the chord's
			// column (incl. rests), so a chord sits on the beat it's written over —
			// beat 1 works, and an empty/rest beat can still carry a chord.
			const inBar = events.filter((ev) => ev.col >= s && ev.col < e).sort((a, b) => a.col - b.col);
			const atOrBefore = (col) => {
				let best = null;
				for (const ev of inBar) { if (ev.col <= col) best = ev; else break; }
				return best || inBar[0] || null;
			};
			for (const t of chordToks) if (t.col >= s && t.col < e) { const ev = atOrBefore(t.col); if (ev) ev.chord = t.raw; }
			return { events };
		});

	return { section: sys.section, bars };
}
