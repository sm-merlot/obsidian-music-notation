// Bar grouping: force line (system) breaks every N bars so a rendered score
// reads in phrases (4s/8s) instead of however many bars happen to fit.
//
//   bars: 4      -> always 4 bars per line
//   bars: 4/8    -> 8 per line if 8 fit at this width, else 4
//   bars: auto   -> Verovio's own wrapping (no forced breaks)
//
// A pick-up bar (first bar shorter than the time signature) is not counted: it
// rides along on the first line and the groups start from the next bar.

/** Parse a `bars:` value into candidate group sizes, largest first. [] = auto. */
export function parseBarGroups(value) {
	const v = String(value ?? "").trim().toLowerCase();
	if (!v || v === "auto" || v === "off" || v === "none") return [];
	return [...new Set(v.split(/[\/,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => b - a);
}

/** The `bars:` directive in a block's source, if any. */
export function barsDirective(source) {
	const m = String(source).match(/^\s*bars\s*:\s*(.+?)\s*$/im);
	return m ? m[1] : null;
}

/**
 * True when the first bar is a pick-up. The DSL converters mark it with
 * `implicit="yes"` from the grid width (durations alone can't tell: tab drops
 * a bar's leading gap).
 */
export function hasPickup(xml) {
	const m = String(xml).match(/<measure\b[^>]*>/);
	return !!m && /\bimplicit="yes"/.test(m[0]);
}

/**
 * Insert `<print new-system="yes"/>` at the start of each group (in every part,
 * so all staves break together). `pickup` bars are skipped before counting.
 */
export function applyBarGroups(xml, size, pickup) {
	const p = pickup ? 1 : 0;
	return xml.replace(/<part\s[^>]*>[\s\S]*?<\/part>/g, (part) => {
		let i = -1;
		return part.replace(/<measure\b[^>]*>/g, (open) => {
			i++;
			return i > p && (i - p) % size === 0 ? `${open}<print new-system="yes"/>` : open;
		});
	});
}

/**
 * From an auto-wrapped Verovio SVG, the fewest bars on any full line (the last
 * line is ignored -- it is just the leftovers; a pick-up bar is not counted).
 * Infinity when everything fits on one line.
 */
export function minBarsPerLine(svg, pickup) {
	const systems = String(svg).split(/<g\b[^>]*class="system"/).slice(1);
	if (systems.length < 2) return Infinity;
	const counts = systems.map((s) => (s.match(/<g\b[^>]*class="measure\b/g) || []).length);
	if (pickup) counts[0] -= 1;
	return Math.min(...counts.slice(0, -1));
}

/** Pick the largest group size that fits, or 0 for auto. */
export function chooseGroup(sizes, fit) {
	for (const s of sizes) if (s <= fit) return s;
	return 0;
}
