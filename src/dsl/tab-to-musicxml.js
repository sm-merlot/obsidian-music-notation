// Parsed tab model -> 2-staff MusicXML.
// Staff 1 (G clef) is a carrier for lyrics on single notes (it gets stripped from
// the SVG afterwards; pitches are irrelevant, fixed to B4). Staff 2 is the TAB
// staff with explicit string/fret. Both voices share the event rhythm.

export const DIV = 24; // divisions per quarter (mult. of 3 so triplets are integral)
export const esc = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASES = [
	[1, "whole"],
	[0.5, "half"],
	[0.25, "quarter"],
	[0.125, "eighth"],
	[0.0625, "16th"],
	[0.03125, "32nd"],
];

export function durParts(durFrac) {
	let base = BASES[BASES.length - 1];
	for (const b of BASES) {
		if (b[0] <= durFrac + 1e-9) {
			base = b;
			break;
		}
	}
	const ratio = durFrac / base[0];
	const dots = ratio >= 1.74 ? 2 : ratio >= 1.4 ? 1 : 0;
	return { type: base[1], dots, div: Math.max(1, Math.round(durFrac * 4 * DIV)) };
}

export function dotsXml(n) {
	return "<dot/>".repeat(n);
}

// Chord name -> <harmony>. The literal suffix is shown via kind@text so jazz
// chords (Cmaj7#11, Cm7b5, G/B) display exactly as written.
export function harmonyXml(name) {
	const m = name.match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
	if (!m) return "";
	const alt = (a) => (a === "#" ? 1 : a === "b" ? -1 : 0);
	const rootAlter = alt(m[1][1]);
	const rootA = rootAlter ? `<root-alter>${rootAlter}</root-alter>` : "";
	const rest = m[2] || "";
	let kind = "major";
	if (/^(maj7|M7|Maj7)/.test(rest)) kind = "major-seventh";
	else if (/^(m7|min7|-7)/.test(rest)) kind = "minor-seventh";
	else if (/^7/.test(rest)) kind = "dominant";
	else if (/^dim|^o/.test(rest)) kind = "diminished";
	else if (/^aug|^\+/.test(rest)) kind = "augmented";
	else if (/^(m|min|-)/.test(rest)) kind = "minor";
	const bass = m[3]
		? `<bass><bass-step>${m[3][0]}</bass-step>${alt(m[3][1]) ? `<bass-alter>${alt(m[3][1])}</bass-alter>` : ""}</bass>`
		: "";
	return (
		`<harmony print-frame="no"><root><root-step>${m[1][0]}</root-step>${rootA}</root>` +
		`<kind text="${esc(rest)}">${kind}</kind>${bass}</harmony>`
	);
}

// Beam roles for a bar's events: group beamable notes (eighth or shorter) that
// fall within the same beat. Verovio honors encoded <beam>s and won't auto-beam.
export function beamRoles(events, beatFrac) {
	const n = events.length;
	const beamable = events.map((e) => !e.rest && e.durFrac <= 0.125 + 1e-9);
	const beat = [];
	let pos = 0;
	for (const e of events) {
		beat.push(Math.floor(pos / beatFrac + 1e-6));
		pos += e.durFrac;
	}
	const roles = new Array(n).fill(null);
	let i = 0;
	while (i < n) {
		if (!beamable[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < n && beamable[j + 1] && beat[j + 1] === beat[i]) j++;
		if (j > i) {
			roles[i] = "begin";
			for (let k = i + 1; k < j; k++) roles[k] = "continue";
			roles[j] = "end";
		}
		i = j + 1;
	}
	return roles;
}

// Syllabification across the whole stream: a trailing '-' means the word
// continues; track the previous syllable to pick begin/middle/end/single.
export function makeSyllabifier() {
	let prevHyphen = false;
	return (raw) => {
		const trailing = raw.endsWith("-");
		let syllabic = "single";
		if (prevHyphen && trailing) syllabic = "middle";
		else if (prevHyphen && !trailing) syllabic = "end";
		else if (!prevHyphen && trailing) syllabic = "begin";
		prevHyphen = trailing;
		return { syllabic, text: raw.replace(/-+$/, "") };
	};
}

export function tabToMusicXML(model) {
	const d = model.directives;
	const syllab = makeSyllabifier();
	// flatten all bars across systems into measures
	const measures = [];
	for (const sys of model.systems) {
		for (const bar of sys.bars) measures.push(bar);
	}

	// Assign every tab note a stable id (in serialization order) and link
	// connectors to the previous note on the same string. '^' = tie (rendered by
	// Verovio). s = slide, h/p = hammer/pull — Verovio renders neither usefully
	// in tab, so we record them and draw the lines/arcs ourselves on the SVG.
	const connections = [];
	const lastByString = new Map();
	let tid = 0;
	for (const bar of measures) {
		for (const e of bar.events) {
			for (const n of e.notes) {
				n.id = "t" + tid++;
				const prev = lastByString.get(n.stringNum);
				if (n.conn && prev) {
					if (n.conn === "^") {
						prev.tieStart = true;
						n.tieStop = true;
					} else {
						// h/p/s drawn as a small letter between the two frets.
						connections.push({ a: prev.id, b: n.id, label: n.conn });
					}
				}
				lastByString.set(n.stringNum, n);
			}
		}
	}

	const attributes =
		`<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths></key>` +
		`<time><beats>${d.beats}</beats><beat-type>${d.beatType}</beat-type></time>` +
		`<staves>2</staves>` +
		`<clef number="1"><sign>G</sign><line>2</line></clef>` +
		`<clef number="2"><sign>TAB</sign><line>5</line></clef>` +
		`<staff-details number="2"><staff-lines>6</staff-lines></staff-details></attributes>`;

	const parts = measures.map((bar, mi) => {
		let v1 = "";
		let backup = 0;
		for (const e of bar.events) {
			const { type, dots, div } = durParts(e.durFrac);
			backup += div;
			if (e.chord) v1 += harmonyXml(e.chord);
			let lyric = "";
			if (e.syllables && e.syllables.length) {
				const s = syllab(e.syllables.join(" "));
				lyric = `<lyric><syllabic>${s.syllabic}</syllabic><text>${esc(s.text)}</text></lyric>`;
			}
			v1 +=
				`<note><pitch><step>B</step><octave>4</octave></pitch>` +
				`<duration>${div}</duration><voice>1</voice><type>${type}</type>${dotsXml(dots)}` +
				`<staff>1</staff>${lyric}</note>`;
		}
		let v2 = "";
		const roles = beamRoles(bar.events, 1 / d.beatType);
		bar.events.forEach((e, ei) => {
			const { type, dots, div } = durParts(e.durFrac);
			const beam =
				roles[ei] ? `<beam number="1">${roles[ei]}</beam>` : "";
			e.notes.forEach((n, i) => {
				const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
				// <tie> (sound) after duration; <tied> (visual) in <notations>.
				// <beam> on the first note only. Slides/hammers are drawn on the
				// SVG afterwards (Verovio can't render them in tab) — hence the id.
				const tieEl =
					(n.tieStart ? '<tie type="start"/>' : "") +
					(n.tieStop ? '<tie type="stop"/>' : "");
				const tied =
					(n.tieStart ? '<tied type="start"/>' : "") +
					(n.tieStop ? '<tied type="stop"/>' : "");
				v2 +=
					`<note id="${n.id}">${i > 0 ? "<chord/>" : ""}` +
					`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
					`<duration>${div}</duration>${tieEl}<voice>2</voice><type>${type}</type>${dotsXml(dots)}` +
					`<staff>2</staff>${i === 0 ? beam : ""}` +
					`<notations><technical><string>${n.stringNum}</string><fret>${n.fret}</fret></technical>${tied}</notations></note>`;
			});
		});
		const backupXml = `<backup><duration>${backup}</duration></backup>`;
		return `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${v1}${backupXml}${v2}</measure>`;
	});

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
  <part id="P1">${parts.join("")}</part>
</score-partwise>`;
	return { xml, connections };
}
