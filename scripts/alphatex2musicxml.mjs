// Minimal alphaTex -> MusicXML converter (seed of the Phase-2 friendly compiler).
// Handles the subset our guitar sheets use: fret.string notes, parenthesised
// plucks (chords), :dur rhythm, bar lines, rests, {ch "X"} chord symbols and
// {lyrics "y"} syllables. Emits a 2-staff part (notation staff carries lyrics +
// chords, TAB staff carries the explicit frets) — the validated "nottab" layout.

const OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 }; // EADGBe, str1=high e
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DUR = {
	1: { type: "whole", div: 16 },
	2: { type: "half", div: 8 },
	4: { type: "quarter", div: 4 },
	8: { type: "eighth", div: 2 },
	16: { type: "16th", div: 1 },
};

const esc = (s) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function midiToPitch(midi) {
	const name = PC[midi % 12];
	return {
		step: name[0],
		alter: name.length > 1 ? 1 : 0,
		octave: Math.floor(midi / 12) - 1,
	};
}

function fretToNote({ string, fret }) {
	const midi = OPEN_MIDI[string] + fret;
	return { ...midiToPitch(midi), string, fret };
}

function parseChord(name) {
	const m = name.match(/^([A-G][#b]?)(.*)$/);
	if (!m) return { rootStep: "C", rootAlter: 0, kind: "major" };
	const rootStep = m[1][0];
	const rootAlter = m[1][1] === "#" ? 1 : m[1][1] === "b" ? -1 : 0;
	const rest = m[2];
	let kind = "major";
	if (/^maj7/.test(rest)) kind = "major-seventh";
	else if (/^m7|^min7/.test(rest)) kind = "minor-seventh";
	else if (/^7/.test(rest)) kind = "dominant";
	else if (/^m|^min/.test(rest)) kind = "minor";
	return { rootStep, rootAlter, kind, text: rest };
}

// Split the music body (everything after the alphaTex "." line) into a token
// stream and fold it into measures of beats.
function parseMusic(body) {
	const measures = [];
	let beats = [];
	let dur = 4;
	const re = /:(\d+)|\||(\([^)]*\)|r|\d+\.\d+)(\{[^}]*\})?/g;
	let mt;
	while ((mt = re.exec(body))) {
		if (mt[1]) {
			dur = Number(mt[1]);
			continue;
		}
		if (mt[0] === "|") {
			measures.push(beats);
			beats = [];
			continue;
		}
		const core = mt[2];
		const anno = mt[3] || "";
		const ch = (anno.match(/ch\s+"([^"]*)"/) || [])[1];
		const lyric = (anno.match(/lyrics\s+"([^"]*)"/) || [])[1];
		const frets =
			core === "r"
				? []
				: [...core.matchAll(/(\d+)\.(\d+)/g)].map((g) =>
						fretToNote({ fret: Number(g[1]), string: Number(g[2]) })
				  );
		beats.push({ dur, frets, ch, lyric, rest: core === "r" });
	}
	if (beats.length) measures.push(beats);
	return measures;
}

function harmonyXml(ch) {
	const c = parseChord(ch);
	const alter = c.rootAlter ? `<root-alter>${c.rootAlter}</root-alter>` : "";
	return `<harmony><root><root-step>${c.rootStep}</root-step>${alter}</root><kind>${c.kind}</kind></harmony>`;
}

function notesXml(beat, { staff, voice, tab, lyricState }) {
	const d = DUR[beat.dur] || DUR[8];
	if (beat.rest || beat.frets.length === 0) {
		return `<note><rest/><duration>${d.div}</duration><voice>${voice}</voice><type>${d.type}</type><staff>${staff}</staff></note>`;
	}
	return beat.frets
		.map((n, i) => {
			const chordTag = i > 0 ? "<chord/>" : "";
			const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
			const pitch = `<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>`;
			const tech = tab
				? `<notations><technical><string>${n.string}</string><fret>${n.fret}</fret></technical></notations>`
				: "";
			let lyric = "";
			if (!tab && i === 0 && beat.lyric) {
				const raw = beat.lyric;
				const trailing = raw.endsWith("-");
				const prev = lyricState.prev;
				let syllabic = "single";
				if (prev && trailing) syllabic = "middle";
				else if (prev && !trailing) syllabic = "end";
				else if (!prev && trailing) syllabic = "begin";
				lyricState.prev = trailing;
				const text = esc(raw.replace(/-$/, ""));
				lyric = `<lyric><syllabic>${syllabic}</syllabic><text>${text}</text></lyric>`;
			}
			return `<note>${chordTag}${pitch}<duration>${d.div}</duration><voice>${voice}</voice><type>${d.type}</type><staff>${staff}</staff>${tech}${lyric}</note>`;
		})
		.join("");
}

export function convert(alphatex) {
	const dot = alphatex.indexOf("\n.");
	const body = dot >= 0 ? alphatex.slice(dot + 2) : alphatex;
	const measures = parseMusic(body);
	const lyricState = { prev: false };

	const parts = measures.map((beats, mi) => {
		const attributes =
			mi === 0
				? `<attributes><divisions>4</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>TAB</sign><line>5</line></clef><staff-details number="2"><staff-lines>6</staff-lines></staff-details></attributes>`
				: "";
		let v1 = "";
		let backup = 0;
		for (const b of beats) {
			if (b.ch) v1 += harmonyXml(b.ch);
			v1 += notesXml(b, { staff: 1, voice: 1, tab: false, lyricState });
			backup += (DUR[b.dur] || DUR[8]).div;
		}
		let v2 = "";
		for (const b of beats) {
			v2 += notesXml(b, { staff: 2, voice: 2, tab: true, lyricState });
		}
		const backupXml = `<backup><duration>${backup}</duration></backup>`;
		return `<measure number="${mi + 1}">${attributes}${v1}${backupXml}${v2}</measure>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">${parts.join("")}</part>
</score-partwise>`;
}
