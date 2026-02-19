/**
 * Utilities for the Numerals inline code suggestor.
 *
 * Provides detection of whether the cursor is inside an inline code span
 * that starts with a Numerals trigger prefix, and extracts context needed
 * for auto-complete suggestions.
 */

/**
 * Result of detecting an inline Numerals context on a line.
 */
export interface InlineNumeralsContext {
	/** The trigger prefix that was matched (e.g. '#:' or '#=:') */
	triggerPrefix: string;
	/** Column where the expression starts (after the trigger prefix, inside the backticks) */
	expressionStartCh: number;
	/** The expression text from after the trigger up to the cursor position */
	expressionUpToCursor: string;
}

/**
 * Find inline code span segments on a line by scanning for backtick pairs.
 * Returns an array of { from, to } where from/to are the columns of the
 * content INSIDE the backticks (exclusive of the backticks themselves).
 */
function findInlineCodeSegments(line: string): Array<{ from: number; to: number }> {
	const segments: Array<{ from: number; to: number }> = [];
	let i = 0;
	while (i < line.length) {
		if (line[i] === '`') {
			const contentStart = i + 1;
			const closingIdx = line.indexOf('`', contentStart);
			if (closingIdx === -1) {
				// No closing backtick — not a complete span
				break;
			}
			segments.push({ from: contentStart, to: closingIdx });
			i = closingIdx + 1;
		} else {
			i++;
		}
	}
	return segments;
}

/**
 * Determine if the editor cursor is inside an inline Numerals code span
 * on the given line, and if so, return context needed for suggestions.
 *
 * @param line - The full text of the current editor line
 * @param cursorCh - The cursor's column (0-based character offset)
 * @param resultTrigger - The trigger prefix for result-only mode (e.g. '#:')
 * @param equationTrigger - The trigger prefix for equation mode (e.g. '#=:')
 * @returns Context if cursor is inside an inline Numerals span, null otherwise
 */
export function findInlineNumeralsContext(
	line: string,
	cursorCh: number,
	resultTrigger: string,
	equationTrigger: string,
): InlineNumeralsContext | null {
	const segments = findInlineCodeSegments(line);

	// Build trigger candidates, filtering out empty triggers.
	// Sort longest-first to handle prefix conflicts (e.g. '#=:' before '#:').
	const triggers: string[] = [];
	if (resultTrigger) triggers.push(resultTrigger);
	if (equationTrigger) triggers.push(equationTrigger);
	triggers.sort((a, b) => b.length - a.length);

	if (triggers.length === 0) return null;

	for (const seg of segments) {
		// Cursor must be inside the content area.
		// seg.from is first char after opening backtick.
		// seg.to is the closing backtick index.
		// cursorCh == seg.from means cursor is right at content start (valid).
		// cursorCh == seg.to means cursor is right before closing backtick (valid — user is typing at end).
		// We exclude: cursor before content start, or past closing backtick.
		if (cursorCh < seg.from || cursorCh > seg.to) continue;

		const content = line.slice(seg.from, seg.to);

		for (const trigger of triggers) {
			if (content.startsWith(trigger)) {
				const expressionStartCh = seg.from + trigger.length;
				// If cursor is still within the trigger prefix, expression is empty
				const expressionUpToCursor = cursorCh > expressionStartCh
					? line.slice(expressionStartCh, cursorCh)
					: '';
				return {
					triggerPrefix: trigger,
					expressionStartCh,
					expressionUpToCursor,
				};
			}
		}

		// Cursor is inside an inline code span but no trigger matched
		return null;
	}

	return null;
}
