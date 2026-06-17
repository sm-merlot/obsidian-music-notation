import { parseTab } from "./parse-tab.js";
import { tabToMusicXML } from "./tab-to-musicxml.js";
import { stripNotationStaff } from "./strip-notation.js";

export { stripNotationStaff };

/** Tab DSL source -> 2-staff MusicXML string. */
export function tabSrcToMusicXML(src) {
	return tabToMusicXML(parseTab(src));
}
