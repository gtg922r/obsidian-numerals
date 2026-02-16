import { InlineNumeralsMode, InlineNumeralsExpression } from '../numerals.types';

/**
 * Attempt to parse an inline code string as a Numerals expression.
 *
 * Checks whether the text starts with a recognized trigger prefix.
 * The equation trigger is checked first to handle the case where
 * one trigger is a prefix of the other (e.g. "=:" vs "==:").
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
	// Try longer/more-specific trigger first to avoid prefix conflicts
	// (e.g. "==:" must be tried before "=:")
	const triggers: [string, InlineNumeralsMode][] = equationTrigger.length >= resultTrigger.length
		? [[equationTrigger, InlineNumeralsMode.Equation], [resultTrigger, InlineNumeralsMode.ResultOnly]]
		: [[resultTrigger, InlineNumeralsMode.ResultOnly], [equationTrigger, InlineNumeralsMode.Equation]];

	for (const [trigger, mode] of triggers) {
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
