// Chord-over-lyric mode parser. Input mirrors tab mode: `H:` chord rows above
// `L:` lyric rows, column-aligned (like the gdoc chord sheets). Output is a list
// of blocks the plugin renders as HTML that wraps word-by-word, each chord glued
// above its word.

const ROW = /^\s*([A-Za-z]+)\s*:\s?(.*)$/;
const SECTION = /^\s*\[(.+?)\]\s*$/;

// Whitespace tokens with their start column.
function tokens(line) {
	const out = [];
	const re = /\S+/g;
	let m;
	while ((m = re.exec(line || ""))) out.push({ col: m.index, text: m[0] });
	return out;
}

export function parseChords(src) {
	const lines = src.replace(/\r/g, "").split("\n");
	const directives = { capo: "", title: "" };
	const blocks = [];
	let pendingChords = null; // tokens from an H: row awaiting its L: row

	const flushChordsOnly = () => {
		if (pendingChords && pendingChords.length) {
			blocks.push({ type: "chordline", chords: pendingChords.map((t) => t.text) });
		}
		pendingChords = null;
	};

	for (const raw of lines) {
		const dir = raw.match(/^\s*(capo|title|mode)\s*:\s*(.+?)\s*$/);
		if (dir && (dir[1] === "capo" || dir[1] === "title")) {
			directives[dir[1]] = dir[2];
			continue;
		}
		if (dir && dir[1] === "mode") continue;
		const sec = raw.match(SECTION);
		if (sec) {
			flushChordsOnly();
			blocks.push({ type: "section", label: sec[1] });
			continue;
		}
		const row = raw.match(ROW);
		if (row && /^[Hh]$/.test(row[1])) {
			flushChordsOnly();
			pendingChords = tokens(row[2]);
			continue;
		}
		if (row && /^[Ll]$/.test(row[1])) {
			blocks.push(buildLine(pendingChords || [], row[2]));
			pendingChords = null;
			continue;
		}
		// blank or other
		if (raw.trim() === "") {
			flushChordsOnly();
			blocks.push({ type: "blank" });
		}
	}
	flushChordsOnly();
	return { directives, blocks };
}

// Attach each chord to the lyric word it sits over (largest word col <= chord col;
// else the first word). Chords with no word become leading chords.
function buildLine(chordToks, lyric) {
	const words = tokens(lyric).map((w) => ({ text: w.text, col: w.col, chords: [] }));
	const lead = [];
	for (const c of chordToks) {
		let idx = -1;
		for (let i = 0; i < words.length; i++) {
			if (words[i].col <= c.col) idx = i;
			else break;
		}
		if (idx === -1) {
			if (words.length) words[0].chords.push(c.text);
			else lead.push(c.text);
		} else {
			words[idx].chords.push(c.text); // a word can carry more than one chord
		}
	}
	return { type: "line", words: words.map((w) => ({ text: w.text, chords: w.chords })), lead };
}

// Split a chord name into display parts: root (+ accidental glyph) and the rest
// (extensions/bass), with #/b turned into ♯/♭.
export function chordParts(name) {
	const m = name.match(/^([A-G])([#b]?)(.*)$/);
	if (!m) return { root: name, ext: "" };
	const acc = m[2] === "#" ? "♯" : m[2] === "b" ? "♭" : "";
	const ext = (m[3] || "").replace(/#/g, "♯").replace(/b/g, "♭");
	return { root: m[1] + acc, ext };
}
