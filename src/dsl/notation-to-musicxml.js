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
			const dp = durParts(e.durFrac);
			const div = dp.div; // played duration (already scaled for the tuplet)
			let type = dp.type;
			let dots = dp.dots;
			// A tuplet member is NOTATED as a straight note (played × actual/normal),
			// plus a time-modification and a bracket on the first/last member.
			let timeMod = "";
			let tupletNot = "";
			if (e.tuplet) {
				const b = durParts((e.durFrac * e.tuplet.actual) / e.tuplet.normal);
				type = b.type;
				dots = b.dots;
				timeMod = `<time-modification><actual-notes>${e.tuplet.actual}</actual-notes><normal-notes>${e.tuplet.normal}</normal-notes></time-modification>`;
				if (e.tuplet.pos !== "mid")
					tupletNot = `<notations><tuplet type="${e.tuplet.pos}" bracket="yes"/></notations>`;
			}
			if (e.chord) body += harmonyXml(e.chord); // chords sit over rests too
			if (e.rest || !e.notes.length) {
				body += `<note><rest/><duration>${div}</duration><voice>1</voice><type>${type}</type>${dotsXml(dots)}</note>`;
				return;
			}
			const beam = roles[ei] ? `<beam number="1">${roles[ei]}</beam>` : "";
			let lyric = "";
			if (e.syllables && e.syllables.length) {
				const s = syllab(e.syllables.join(" "));
				lyric = `<lyric><syllabic>${s.syllabic}</syllabic><text>${esc(s.text)}</text></lyric>`;
			}
			e.notes.forEach((n, i) => {
				const alter = n.alter ? `<alter>${n.alter}</alter>` : "";
				// draw the accidental the user typed (sharp/flat/natural) so e.g. `n`
				// shows a ♮ that cancels the key signature
				const accName = n.acc === 1 ? "sharp" : n.acc === -1 ? "flat" : n.acc === 0 ? "natural" : "";
				const accidental = accName ? `<accidental>${accName}</accidental>` : "";
				body +=
					`<note>${i > 0 ? "<chord/>" : ""}` +
					`<pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch>` +
					`<duration>${div}</duration><voice>1</voice><type>${type}</type>${dotsXml(dots)}${accidental}${timeMod}` +
					`${i === 0 ? beam : ""}${i === 0 ? tupletNot : ""}${i === 0 ? lyric : ""}</note>`;
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
