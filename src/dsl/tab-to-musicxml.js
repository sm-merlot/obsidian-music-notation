// Parsed tab model -> 2-staff MusicXML.
// Staff 1 (G clef) is a carrier for lyrics on single notes (it gets stripped from
// the SVG afterwards; pitches are irrelevant, fixed to B4). Staff 2 is the TAB
// staff with explicit string/fret. Both voices share the event rhythm.

const DIV = 8; // divisions per quarter -> 32nd = 1
const esc = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASES = [
	[1, "whole"],
	[0.5, "half"],
	[0.25, "quarter"],
	[0.125, "eighth"],
	[0.0625, "16th"],
	[0.03125, "32nd"],
];

function durParts(durFrac) {
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

function dotsXml(n) {
	return "<dot/>".repeat(n);
}

// Chord name -> <harmony>. The literal suffix is shown via kind@text so jazz
// chords (Cmaj7#11, Cm7b5, G/B) display exactly as written.
function harmonyXml(name) {
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
function beamRoles(events, beatFrac) {
	const n = events.length;
	const beamable = events.map((e) => e.durFrac <= 0.125 + 1e-9);
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
function makeSyllabifier() {
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

	// Link connectors: a note's `conn` connects it back to the previous note on
	// the same string. '^' = tie; h/p = slur (hammer-on/pull-off); s / \ = slide
	// (a line drawn between the two frets).
	const lastByString = new Map();
	let lineN = 0;
	for (const bar of measures) {
		for (const e of bar.events) {
			for (const n of e.notes) {
				const prev = lastByString.get(n.stringNum);
				if (n.conn && prev) {
					if (n.conn === "^") {
						prev.tieStart = true;
						n.tieStop = true;
					} else {
						const num = ++lineN;
						const kind = n.conn === "s" ? "slide" : "slur";
						(prev[kind + "Start"] ||= []).push(num);
						(n[kind + "Stop"] ||= []).push(num);
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
				// <tie> (sound) goes after duration; <tied>/<slur>/<slide>
				// (visual) in <notations>. <beam> goes on the first note only.
				const tieEl =
					(n.tieStart ? '<tie type="start"/>' : "") +
					(n.tieStop ? '<tie type="stop"/>' : "");
				const tied =
					(n.tieStart ? '<tied type="start"/>' : "") +
					(n.tieStop ? '<tied type="stop"/>' : "");
				const lines = [
					...(n.slurStart || []).map((x) => `<slur type="start" number="${x}"/>`),
					...(n.slurStop || []).map((x) => `<slur type="stop" number="${x}"/>`),
					...(n.slideStart || []).map((x) => `<slide type="start" line-type="solid" number="${x}"/>`),
					...(n.slideStop || []).map((x) => `<slide type="stop" line-type="solid" number="${x}"/>`),
				].join("");
				v2 +=
					`<note>${i > 0 ? "<chord/>" : ""}` +
					`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
					`<duration>${div}</duration>${tieEl}<voice>2</voice><type>${type}</type>${dotsXml(dots)}` +
					`<staff>2</staff>${i === 0 ? beam : ""}` +
					`<notations><technical><string>${n.stringNum}</string><fret>${n.fret}</fret></technical>${tied}${lines}</notations></note>`;
			});
		});
		const backupXml = `<backup><duration>${backup}</duration></backup>`;
		return `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${v1}${backupXml}${v2}</measure>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
  <part id="P1">${parts.join("")}</part>
</score-partwise>`;
}
