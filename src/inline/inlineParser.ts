import { InlineNumeralsMode, InlineNumeralsExpression } from '../numerals.types';

/**
 * Attempt to parse an inline code string as a Numerals expression.
 *
 * Checks whether the text starts with a recognized trigger prefix.
 * The longer trigger is checked first to handle the case where
 * one trigger is a prefix of the other (e.g. "=:" vs "==:").
 *
 * Empty triggers are silently ignored to prevent matching all code spans.
 *
 * @param text - The raw inline code text
 * @param resultTrigger - Trigger prefix for result-only mode (e.g. "=:")
 * @param equationTrigger - Trigger prefix for equation mode (e.g. "==:")
 * @returns Parsed expression with mode, or null if no trigger matched
 */
export function parseInlineExpression(
	text: string,
	resultTrigger: string,
	equationTrigger: string
): InlineNumeralsExpression | null {
	// Build candidate list, filtering out empty triggers
	const candidates: [string, InlineNumeralsMode][] = [];
	if (resultTrigger) candidates.push([resultTrigger, InlineNumeralsMode.ResultOnly]);
	if (equationTrigger) candidates.push([equationTrigger, InlineNumeralsMode.Equation]);

	// Sort longest-first to avoid prefix conflicts ("==:" before "=:")
	candidates.sort((a, b) => b[0].length - a[0].length);

	for (const [trigger, mode] of candidates) {
		if (text.startsWith(trigger)) {
			const expression = text.slice(trigger.length).trim();
			if (expression.length === 0) {
				return null;
			}
			return { mode, expression };
		}
	}

	return null;
}
