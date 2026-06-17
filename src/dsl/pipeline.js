import { parseTab } from "./parse-tab.js";
import { tabToMusicXML } from "./tab-to-musicxml.js";
import { stripNotationStaff } from "./strip-notation.js";

export { stripNotationStaff };

/** Tab DSL source -> 2-staff MusicXML string (whole piece, one render). */
export function tabSrcToMusicXML(src) {
	return tabToMusicXML(parseTab(src)).xml;
}

/**
 * Tab DSL source -> one MusicXML per SECTION, so the plugin can render each
 * section as its own (separately wrapping) SVG that starts on a new line.
 * Systems without a [Section] header continue the current section.
 */
export function tabSrcToSections(src) {
	const model = parseTab(src);
	const groups = [];
	for (const sys of model.systems) {
		if (sys.section || groups.length === 0) {
			groups.push({ label: sys.section || null, systems: [sys] });
		} else {
			groups[groups.length - 1].systems.push(sys);
		}
	}
	return {
		directives: model.directives,
		sections: groups.map((g) => {
			const { xml, connections } = tabToMusicXML({
				directives: model.directives,
				systems: g.systems,
			});
			return { label: g.label, xml, connections };
		}),
	};
}
