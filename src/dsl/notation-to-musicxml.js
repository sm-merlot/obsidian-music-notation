// Parsed ASCII-staff notation model -> MusicXML. Supports multiple parts (SATB,
// voice + piano) bracketed together, and a `grand` part = one braced 2-staff
// piano (notes auto-split at middle C). Reuses the tab helpers.
import {
	DIV,
	esc,
	durParts,
	dotsXml,
	beamRoles,
	makeSyllabifier,
	harmonyXml,
} from "./tab-to-musicxml.js";

function clefXml(type, number) {
	const num = number ? ` number="${number}"` : "";
	switch (type) {
		case "bass":
			return `<clef${num}><sign>F</sign><line>4</line></clef>`;
		case "treble-8ve":
			return `<clef${num}><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`;
		case "tenor":
			return `<clef${num}><sign>C</sign><line>4</line></clef>`;
		case "alto":
			return `<clef${num}><sign>C</sign><line>3</line></clef>`;
		default:
			return `<clef${num}><sign>G</sign><line>2</line></clef>`; // treble
	}
}

// One <note> (or chord member) / rest, with accidental, tuplet, beam, lyric.
function noteXml(e, n, i, ctx) {
	const { div, type, dots, timeMod, beam, lyric, tupletNot, staffTag, voice } = ctx;
	if (!n) {
		return `<note><rest/><duration>${div}</duration>${voice}<type>${type}</type>${dotsXml(dots)}${staffTag}</note>`;
	}
	const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
	const accName = n.acc === 1 ? "sharp" : n.acc === -1 ? "flat" : n.acc === 0 ? "natural" : "";
	const accidental = accName ? `<accidental>${accName}</accidental>` : "";
	return (
		`<note>${i > 0 ? "<chord/>" : ""}` +
		`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
		`<duration>${div}</duration>${voice}<type>${type}</type>${dotsXml(dots)}${accidental}${timeMod}` +
		`${i === 0 ? beam : ""}${i === 0 ? staffTag : ""}${i === 0 ? tupletNot : ""}${i === 0 ? lyric : ""}</note>`
	);
}

// Emit one voice (a staff's worth of events) for a measure. `staff` (1/2) tags
// the notes for a multi-staff part; pass null for a single-staff part.
function voiceXml(events, d, syllab, staff) {
	const sel = events;
	const roles = beamRoles(sel, 1 / d.beatType);
	const voice = staff == null ? `<voice>1</voice>` : `<voice>${staff}</voice>`;
	const staffTag = staff == null ? "" : `<staff>${staff}</staff>`;
	let body = "";
	sel.forEach((e, ei) => {
		const dp = durParts(e.durFrac);
		let type = dp.type;
		let dots = dp.dots;
		let timeMod = "";
		let tupletNot = "";
		if (e.tuplet) {
			const b = durParts((e.durFrac * e.tuplet.actual) / e.tuplet.normal);
			type = b.type;
			dots = b.dots;
			timeMod = `<time-modification><actual-notes>${e.tuplet.actual}</actual-notes><normal-notes>${e.tuplet.normal}</normal-notes></time-modification>`;
			if (e.tuplet.pos !== "mid") tupletNot = `<notations><tuplet type="${e.tuplet.pos}" bracket="yes"/></notations>`;
		}
		// chords print once (on the top staff / single staff)
		if (e.chord && staff !== 2) body += harmonyXml(e.chord);
		const beam = roles[ei] ? `<beam number="1">${roles[ei]}</beam>` : "";
		let lyric = "";
		if (e.syllables && e.syllables.length) {
			const s = syllab(e.syllables.join(" "));
			lyric = `<lyric><syllabic>${s.syllabic}</syllabic><text>${esc(s.text)}</text></lyric>`;
		}
		const ctx = { div: dp.div, type, dots, timeMod, beam, lyric, tupletNot, staffTag, voice };
		if (e.rest || !e.notes.length) {
			body += noteXml(e, null, 0, ctx);
			return;
		}
		e.notes.forEach((n, i) => (body += noteXml(e, n, i, ctx)));
	});
	return body;
}

function partXml(part, d, syllab) {
	const grand = part.clefType === "grand";
	const measureDiv = Math.round((d.beats / d.beatType) * 4 * DIV); // full-measure divisions
	const attributes =
		`<attributes><divisions>${DIV}</divisions>` +
		`<key><fifths>${d.fifths || 0}</fifths></key>` +
		`<time><beats>${d.beats}</beats><beat-type>${d.beatType}</beat-type></time>` +
		(grand ? `<staves>2</staves>` + clefXml("treble", 1) + clefXml("bass", 2) : clefXml(part.clefType)) +
		`</attributes>`;
	if (grand) {
		const tb = part.trebleBars || [];
		const bb = part.bassBars || [];
		const n = Math.max(tb.length, bb.length);
		const empty = { events: [{ rest: true, durFrac: d.beats / d.beatType, notes: [] }] };
		let out = "";
		for (let mi = 0; mi < n; mi++) {
			const body =
				voiceXml((tb[mi] || empty).events, d, syllab, 1) +
				`<backup><duration>${measureDiv}</duration></backup>` +
				voiceXml((bb[mi] || empty).events, d, syllab, 2);
			out += `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${body}</measure>`;
		}
		return out;
	}
	return part.bars
		.map((bar, mi) => `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${voiceXml(bar.events, d, syllab, null)}</measure>`)
		.join("");
}

export function notationToMusicXML(model) {
	const d = model.directives;
	const syllab = makeSyllabifier();
	const parts = model.parts && model.parts.length ? model.parts : [{ clefType: d.clef, bars: (model.systems || []).flatMap((s) => s.bars) }];

	const ids = parts.map((_, i) => `P${i + 1}`);
	const group = parts.length > 1;
	const partList =
		`<part-list>` +
		(group ? `<part-group type="start" number="1"><group-symbol>bracket</group-symbol><group-barline>yes</group-barline></part-group>` : "") +
		parts.map((_, i) => `<score-part id="${ids[i]}"><part-name></part-name></score-part>`).join("") +
		(group ? `<part-group type="stop" number="1"/>` : "") +
		`</part-list>`;
	const body = parts.map((p, i) => `<part id="${ids[i]}">${partXml(p, d, syllab)}</part>`).join("");

	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${partList}
  ${body}
</score-partwise>`;
}
