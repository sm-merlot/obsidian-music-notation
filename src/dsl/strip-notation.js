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

export function stripNotationStaff(svg, connections) {
	const rm = (el) => el && el.parentNode && el.parentNode.removeChild(el);

	// Draw slide/hammer/pull as a small letter in the gap between the two frets
	// (Verovio renders none of these usefully in tab). Done before compaction so
	// the labels move with their system.
	if (connections && connections.length) drawConnectors(svg, connections);

	// System brace, part label and floating measure numbers look wrong once the
	// notation staff is gone.
	svg.querySelectorAll("g.grpSym, g.label, g.mNum").forEach(rm);

	svg.querySelectorAll("g.measure").forEach((measure) => {
		const staves = Array.from(measure.children).filter((c) =>
			hasClass(c, "staff")
		);
		if (staves.length < 2) return; // single-staff: nothing to strip

		// Strip staff 1 (notation), keeping only its lyric + chord-symbol text.
		const g1 = staves[0];
		const keep = Array.from(g1.querySelectorAll("g.verse, g.harm"));
		while (g1.firstChild) g1.removeChild(g1.firstChild);
		keep.forEach((v) => g1.appendChild(v));

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

	// Harmony renders above the (now removed) notation staff, far above the
	// lyrics. Pull each system's chord symbols down to just above its lyric row.
	svg.querySelectorAll("g.system").forEach((sys) => {
		if (!sys.querySelector("g.harm")) return;
		let lyrY = Infinity;
		sys.querySelectorAll("g.verse text").forEach((t) => {
			const y = parseFloat(t.getAttribute("y"));
			if (!Number.isNaN(y) && y < lyrY) lyrY = y;
		});
		let chordY;
		if (Number.isFinite(lyrY)) {
			chordY = lyrY - CHORD_GAP; // sit just above the lyric row
		} else {
			// no lyrics: sit above the highest tab content (rhythm stems/beams).
			let minPath = Infinity;
			sys.querySelectorAll("path").forEach((p) => {
				const d = p.getAttribute("d") || "";
				for (const m of d.matchAll(/[ML]\s*-?[\d.]+\s+(-?[\d.]+)/g)) {
					const y = Number(m[1]);
					if (y < minPath) minPath = y;
				}
			});
			if (!Number.isFinite(minPath)) return;
			chordY = minPath - 300;
		}
		const newY = chordY.toFixed(1);
		// the chord glyph carries y on the <text> AND an inner <tspan>; move both
		sys.querySelectorAll("g.harm text, g.harm tspan").forEach((t) => {
			if (t.hasAttribute("y")) t.setAttribute("y", newY);
		});
	});

	// The stripped notation staff still reserved its full height, leaving a big
	// empty band above the lyrics/tab in every system. Re-stack the systems by
	// their real content (lyrics, tab, stems) and shrink the viewBox to fit.
	compactSystems(svg);

	return svg;
}

// Raw-coordinate paddings (Verovio internal units).
const TOP_PAD = 140;
const SYS_GAP = 320;
const BOT_PAD = 160;
// Approx glyph extent above/below a text baseline, so lyrics/chords aren't clipped.
const TEXT_ASCENT = 400;
const TEXT_DESCENT = 140;
// Distance the chord row sits above the lyric baseline.
const CHORD_GAP = 380;

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
	sys.querySelectorAll("text, tspan").forEach((t) => {
		const y = parseFloat(t.getAttribute("y"));
		if (!Number.isNaN(y)) {
			acc(y - TEXT_ASCENT);
			acc(y + TEXT_DESCENT);
		}
	});
	return top === Infinity ? null : { top, bot };
}

// Place an italic letter (h/p/s) centred in the gap ABOVE the string line the
// two connected fret numbers sit on, midway between them.
function drawConnectors(svg, connections) {
	const NS = "http://www.w3.org/2000/svg";
	for (const c of connections) {
		const a = svg.querySelector(`g.note[id="${c.a}"] text`);
		const b = svg.querySelector(`g.note[id="${c.b}"] text`);
		if (!a || !b) continue;
		const xa = parseFloat(a.getAttribute("x"));
		const xb = parseFloat(b.getAttribute("x"));
		const y = parseFloat(a.getAttribute("y"));
		if ([xa, xb, y].some(Number.isNaN)) continue;

		const staff = a.closest && a.closest("g.staff");
		const lines = staff ? staffLineYs(staff) : [];
		let spacing = 315;
		let nearest = y;
		if (lines.length >= 2) {
			const diffs = [];
			for (let i = 1; i < lines.length; i++) diffs.push(lines[i] - lines[i - 1]);
			diffs.sort((p, q) => p - q);
			spacing = diffs[diffs.length >> 1] || spacing;
			nearest = lines.reduce((p, q) => (Math.abs(q - y) < Math.abs(p - y) ? q : p), lines[0]);
		}
		const fontSize = Math.round(spacing * 0.9);
		const baseline = nearest - spacing / 2 + fontSize * 0.35; // centred in the gap

		const t = svg.ownerDocument.createElementNS(NS, "text");
		t.setAttribute("x", ((xa + xb) / 2).toFixed(1));
		t.setAttribute("y", baseline.toFixed(1));
		t.setAttribute("text-anchor", "middle");
		t.setAttribute("font-size", String(fontSize));
		t.setAttribute("font-style", "italic");
		t.textContent = c.label;
		a.parentNode.appendChild(t);
	}
}

// Sorted unique y of a staff's horizontal line paths.
function staffLineYs(staff) {
	const ys = new Set();
	staff.querySelectorAll("path").forEach((p) => {
		const m = (p.getAttribute("d") || "").match(VLINE);
		if (m && Math.abs(Number(m[2]) - Number(m[4])) < 1) ys.add(Math.round(Number(m[2])));
	});
	return [...ys].sort((p, q) => p - q);
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
