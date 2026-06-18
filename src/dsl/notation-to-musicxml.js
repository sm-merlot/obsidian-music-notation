// Parsed ASCII-staff notation model -> single-staff MusicXML (real engraving:
// pitches, key, rests, lyrics, chord symbols, beams). Reuses the tab helpers.
import {
	DIV,
	esc,
	durParts,
	dotsXml,
	beamRoles,
	makeSyllabifier,
	harmonyXml,
} from "./tab-to-musicxml.js";

export function notationToMusicXML(model) {
	const d = model.directives;
	const syllab = makeSyllabifier();
	const clefXml =
		d.clef === "bass"
			? "<clef><sign>F</sign><line>4</line></clef>"
			: "<clef><sign>G</sign><line>2</line></clef>";
	const attributes =
		`<attributes><divisions>${DIV}</divisions>` +
		`<key><fifths>${d.fifths || 0}</fifths></key>` +
		`<time><beats>${d.beats}</beats><beat-type>${d.beatType}</beat-type></time>` +
		clefXml +
		`</attributes>`;

	const measures = [];
	for (const sys of model.systems) for (const bar of sys.bars) measures.push(bar);

	const parts = measures.map((bar, mi) => {
		const roles = beamRoles(bar.events, 1 / d.beatType);
		let body = "";
		bar.events.forEach((e, ei) => {
			const { type, dots, div } = durParts(e.durFrac);
			if (e.rest || !e.notes.length) {
				body += `<note><rest/><duration>${div}</duration><voice>1</voice><type>${type}</type>${dotsXml(dots)}</note>`;
				return;
			}
			if (e.chord) body += harmonyXml(e.chord);
			const beam = roles[ei] ? `<beam number="1">${roles[ei]}</beam>` : "";
			let lyric = "";
			if (e.syllables && e.syllables.length) {
				const s = syllab(e.syllables.join(" "));
				lyric = `<lyric><syllabic>${s.syllabic}</syllabic><text>${esc(s.text)}</text></lyric>`;
			}
			e.notes.forEach((n, i) => {
				const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
				body +=
					`<note>${i > 0 ? "<chord/>" : ""}` +
					`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
					`<duration>${div}</duration><voice>1</voice><type>${type}</type>${dotsXml(dots)}` +
					`${i === 0 ? beam : ""}${i === 0 ? lyric : ""}</note>`;
			});
		});
		return `<measure number="${mi + 1}">${mi === 0 ? attributes : ""}${body}</measure>`;
	});

	return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
  <part id="P1">${parts.join("")}</part>
</score-partwise>`;
}
