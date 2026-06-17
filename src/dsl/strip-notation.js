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

	// System brace, part label and floating measure numbers look wrong once the
	// notation staff is gone.
	svg.querySelectorAll("g.grpSym, g.label, g.mNum").forEach(rm);

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
		// A Verovio measure barline is drawn in segments (notation staff, the
		// connector between staves, tab staff). Drop the segments that live
		// entirely above the tab; clamp any that cross into it.
		const tabTop = staffTopY(staves[1]);
		if (tabTop != null) {
			measure.querySelectorAll("g.barLine path").forEach((p) => {
				const m = (p.getAttribute("d") || "").match(VLINE);
				if (!m) return;
				const lo = Math.min(Number(m[2]), Number(m[4]));
				const hi = Math.max(Number(m[2]), Number(m[4]));
				if (hi <= tabTop + 1) {
					p.parentNode && p.parentNode.removeChild(p);
					return;
				}
				p.setAttribute("d", `M${m[1]} ${Math.max(lo, tabTop)} L${m[3]} ${hi}`);
			});
		}
	});

	// Each system has an initial barline (a direct child path of the system,
	// spanning both staves) — this is the left edge line. Clamp it to the tab
	// staff so it isn't a tall line dangling into the removed notation staff.
	svg.querySelectorAll("g.system").forEach((system) => {
		const measure = system.querySelector("g.measure");
		if (!measure) return;
		const staves = Array.from(measure.children).filter((c) =>
			hasClass(c, "staff")
		);
		if (staves.length < 2) return;
		const tabTop = staffTopY(staves[1]);
		if (tabTop == null) return;
		Array.from(system.children).forEach((ch) => {
			if (ch.tagName !== "path") return;
			const m = (ch.getAttribute("d") || "").match(VLINE);
			if (!m) return;
			const lo = Math.min(Number(m[2]), Number(m[4]));
			const hi = Math.max(Number(m[2]), Number(m[4]));
			if (hi <= tabTop + 1) {
				rm(ch);
				return;
			}
			ch.setAttribute("d", `M${m[1]} ${Math.max(lo, tabTop)} L${m[3]} ${hi}`);
		});
	});

	// The stripped notation staff still reserved its full height, leaving a big
	// empty band above the lyrics/tab in every system. Re-stack the systems by
	// their real content (lyrics, tab, stems) and shrink the viewBox to fit.
	compactSystems(svg);

	return svg;
}

// Raw-coordinate paddings (Verovio internal units).
const TOP_PAD = 200;
const SYS_GAP = 500;
const BOT_PAD = 200;

function compactSystems(svg) {
	const inner = svg.querySelector("svg"); // the definition-scale (raw-coord) svg
	const pm = svg.querySelector("g.page-margin");
	const ivb = (inner && inner.getAttribute("viewBox") || "").split(/\s+/).map(Number);
	const ovb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
	if (!inner || !pm || ivb.length !== 4 || ovb.length !== 4) return;

	// Pin the content's top margin (page-margin's y) small.
	const pmm = (pm.getAttribute("transform") || "").match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
	const px = pmm ? Number(pmm[1]) : 0;
	pm.setAttribute("transform", `translate(${px}, ${TOP_PAD})`);

	// Stack systems by their real content, from local y=0.
	let cursor = 0;
	svg.querySelectorAll("g.system").forEach((sys) => {
		const bb = contentBox(sys);
		if (!bb) return;
		sys.setAttribute("transform", `translate(0 ${(cursor - bb.top).toFixed(1)})`);
		cursor += bb.bot - bb.top + SYS_GAP;
	});
	const totalInner = Math.round(TOP_PAD + Math.max(0, cursor - SYS_GAP) + BOT_PAD);
	const scale = ivb[2] / ovb[2];

	inner.setAttribute("viewBox", `${ivb[0]} ${ivb[1]} ${ivb[2]} ${totalInner}`);
	svg.setAttribute("viewBox", `${ovb[0]} ${ovb[1]} ${ovb[2]} ${Math.round(totalInner / scale)}`);
}

// Vertical extent of a system's real (post-strip) content: y of every line/stem
// path endpoint and every text baseline.
function contentBox(sys) {
	let top = Infinity;
	let bot = -Infinity;
	const acc = (y) => {
		if (y < top) top = y;
		if (y > bot) bot = y;
	};
	sys.querySelectorAll("path").forEach((p) => {
		const d = p.getAttribute("d") || "";
		for (const m of d.matchAll(/[ML]\s*-?[\d.]+\s+(-?[\d.]+)/g)) acc(Number(m[1]));
	});
	sys.querySelectorAll("text").forEach((t) => {
		const y = parseFloat(t.getAttribute("y"));
		if (!Number.isNaN(y)) acc(y);
	});
	return top === Infinity ? null : { top, bot };
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
