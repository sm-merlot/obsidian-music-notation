// Remove the (carrier) notation staff from a Verovio SVG, keeping its lyrics and
// the TAB staff. Works on a DOM <svg> element (browser DOMParser or linkedom).
//
// Per measure the first `<g class="staff">` is staff 1 (notation). Its lyric
// `<g class="verse">` subtrees use ABSOLUTE coordinates, so we can drop every
// other child of that staff (lines, clef, noteheads, stems) and re-keep the
// verses in place. The system brace/label are removed too.

function hasClass(el, c) {
	return (
		el.getAttribute &&
		(el.getAttribute("class") || "").split(/\s+/).includes(c)
	);
}

export function stripNotationStaff(svg) {
	const rm = (el) => el && el.parentNode && el.parentNode.removeChild(el);

	// System brace + part label look wrong once a staff is gone.
	svg.querySelectorAll("g.grpSym, g.label").forEach(rm);

	svg.querySelectorAll("g.measure").forEach((measure) => {
		const staves = Array.from(measure.children).filter((c) =>
			hasClass(c, "staff")
		);
		if (staves.length < 2) return; // single-staff: nothing to strip
		const g1 = staves[0];
		const verses = Array.from(g1.querySelectorAll("g.verse"));
		while (g1.firstChild) g1.removeChild(g1.firstChild);
		verses.forEach((v) => g1.appendChild(v));
	});

	return svg;
}
