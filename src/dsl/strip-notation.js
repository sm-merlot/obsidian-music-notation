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

		// Strip staff 1 (notation), keeping only its lyric text.
		const g1 = staves[0];
		const verses = Array.from(g1.querySelectorAll("g.verse"));
		while (g1.firstChild) g1.removeChild(g1.firstChild);
		verses.forEach((v) => g1.appendChild(v));

		// Trim barlines (which spanned both staves) down to the tab staff's top
		// line so they don't dangle up into the removed notation staff.
		const tabTop = staffTopY(staves[1]);
		if (tabTop != null) {
			measure.querySelectorAll("g.barLine path").forEach((p) => {
				const m = (p.getAttribute("d") || "").match(VLINE);
				if (!m) return;
				const bottom = Math.max(Number(m[2]), Number(m[4]));
				const top = Math.max(Math.min(Number(m[2]), Number(m[4])), tabTop);
				p.setAttribute("d", `M${m[1]} ${top} L${m[3]} ${bottom}`);
			});
		}
	});

	// Draw a left barline at the start of every system (Verovio doesn't, and the
	// ASCII tabs always lead with '|'). Vertical line at the system's first tab
	// staff left edge, spanning its lines.
	const NS = "http://www.w3.org/2000/svg";
	svg.querySelectorAll("g.system").forEach((system) => {
		const measure = system.querySelector("g.measure");
		if (!measure) return;
		const staves = Array.from(measure.children).filter((c) =>
			hasClass(c, "staff")
		);
		const tab = staves[staves.length - 1];
		const box = tab && staffBox(tab);
		if (!box) return;
		const path = svg.ownerDocument.createElementNS(NS, "path");
		path.setAttribute("d", `M${box.left} ${box.top} L${box.left} ${box.bottom}`);
		path.setAttribute("stroke-width", "18");
		const g = svg.ownerDocument.createElementNS(NS, "g");
		g.setAttribute("class", "barLine");
		g.appendChild(path);
		measure.insertBefore(g, measure.firstChild);
	});

	return svg;
}

// A straight two-point line path: "M x y L x y".
const VLINE = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s+L\s*(-?[\d.]+)\s+(-?[\d.]+)/;

// Bounding box of a staff from its horizontal line paths.
function staffBox(staff) {
	let left = null,
		right = null,
		top = null,
		bottom = null;
	staff.querySelectorAll("path").forEach((p) => {
		const m = (p.getAttribute("d") || "").match(VLINE);
		if (!m) return;
		const x1 = Number(m[1]),
			y1 = Number(m[2]),
			x2 = Number(m[3]),
			y2 = Number(m[4]);
		if (Math.abs(y1 - y2) >= 1) return; // only horizontal staff lines
		left = left == null ? Math.min(x1, x2) : Math.min(left, x1, x2);
		right = right == null ? Math.max(x1, x2) : Math.max(right, x1, x2);
		top = top == null ? y1 : Math.min(top, y1);
		bottom = bottom == null ? y1 : Math.max(bottom, y1);
	});
	return left == null ? null : { left, right, top, bottom };
}

// Topmost (smallest) y among a staff's horizontal line paths.
function staffTopY(staff) {
	const box = staffBox(staff);
	return box ? box.top : null;
}
