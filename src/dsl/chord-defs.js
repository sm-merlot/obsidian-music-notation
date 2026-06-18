// Chord-shape definitions, shared by tab and chords modes. A line like:
//   chord D = 2 3 2 0 x x        (frets high-e → low-E, matching `tuning:`)
//   chord Em = 0 0 0 2 2 0
//   chord C = x32010             (compact: one char per string, single digits)
// `x` = muted, `0` = open. Returns [{ name, strings }] where strings[0] is the
// high e and strings[5] the low E; a string is null (muted) or a fret number.

export function parseChordDefs(src) {
	const defs = [];
	for (const line of src.replace(/\r/g, "").split("\n")) {
		const m = line.match(/^\s*chord\s+(\S+)\s*=?\s*(.+?)\s*$/i);
		if (!m) continue;
		const rest = m[2].trim();
		const toks = /\s/.test(rest) ? rest.split(/\s+/) : rest.split("");
		const strings = toks
			.slice(0, 6)
			.map((t) => (/^x$/i.test(t) ? null : Number(t)))
			.map((n) => (Number.isNaN(n) ? null : n));
		defs.push({ name: m[1], strings });
	}
	return defs;
}

// Layout for drawing: base fret of the 4-fret window + dot/marker positions.
// dots: {string: 0..5 (0 = low E, left), fret: 1..4 within the window}.
// markers: {string: 0..5, type: "x" | "o"} above the nut.
export function chordLayout(strings) {
	// strings is high→low; flip so index 0 = low E (drawn on the left).
	const lo2hi = strings.slice().reverse();
	const fretted = lo2hi.filter((f) => typeof f === "number" && f > 0);
	const max = fretted.length ? Math.max(...fretted) : 0;
	const min = fretted.length ? Math.min(...fretted) : 0;
	const base = max <= 4 ? 1 : min; // open-position window, else start at min fret
	const dots = [];
	const markers = [];
	lo2hi.forEach((f, s) => {
		if (f === null) markers.push({ string: s, type: "x" });
		else if (f === 0) markers.push({ string: s, type: "o" });
		else dots.push({ string: s, fret: f - base + 1 });
	});
	return { base, dots, markers };
}
