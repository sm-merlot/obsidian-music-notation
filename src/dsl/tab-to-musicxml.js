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
	// flatten all bars across systems into measures; carry each system's section
	// label onto its first bar.
	const measures = [];
	for (const sys of model.systems) {
		sys.bars.forEach((bar, bi) => {
			if (bi === 0 && sys.section) bar.sectionLabel = sys.section;
			measures.push(bar);
		});
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
		// Section label as a direction on the TAB staff (staff 2 survives the
		// notation-staff strip), rendered bold above the tab.
		let v2 = "";
		if (bar.sectionLabel) {
			v2 +=
				`<direction placement="above"><direction-type>` +
				`<words font-weight="bold" font-size="11">${esc(bar.sectionLabel)}</words>` +
				`</direction-type><staff>2</staff></direction>`;
		}
		for (const e of bar.events) {
			const { type, dots, div } = durParts(e.durFrac);
			e.notes.forEach((n, i) => {
				const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
				v2 +=
					`<note>${i > 0 ? "<chord/>" : ""}` +
					`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
					`<duration>${div}</duration><voice>2</voice><type>${type}</type>${dotsXml(dots)}` +
					`<staff>2</staff>` +
					`<notations><technical><string>${n.stringNum}</string><fret>${n.fret}</fret></technical></notations></note>`;
			});
		}
		const backupXml = `<backup><duration>${backup}</duration></backup>`;
		return `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${v1}${backupXml}${v2}</measure>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
  <part id="P1">${parts.join("")}</part>
</score-partwise>`;
}
