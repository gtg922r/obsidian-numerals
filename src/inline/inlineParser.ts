import {
	InlineNumeralsMode,
	InlineNumeralsExpression,
	InlineTriggerSettings,
	NumeralsRenderStyle,
} from '../numerals.types';

/**
 * Attempt to parse an inline code string as a Numerals expression.
 *
 * Checks whether the text starts with a recognized trigger prefix. Each
 * trigger maps to a rendering mode (result-only or equation) and a render
 * style (plain text or TeX). Triggers are checked longest-first so that a
 * longer trigger that has a shorter trigger as a prefix wins (e.g. "#=$:"
 * before "#=:", "#$:", and "#:").
 *
 * Empty triggers are silently ignored to prevent matching all code spans.
 *
 * @param text - The raw inline code text
 * @param triggers - The four configured trigger prefixes from settings
 * @returns Parsed expression with mode and render style, or null if no trigger matched
 */
export function parseInlineExpression(
	text: string,
	triggers: InlineTriggerSettings
): InlineNumeralsExpression | null {
	// Build candidate list, filtering out empty triggers.
	const candidates: [string, InlineNumeralsMode, NumeralsRenderStyle][] = [];
	if (triggers.resultTrigger) candidates.push([triggers.resultTrigger, InlineNumeralsMode.ResultOnly, NumeralsRenderStyle.Plain]);
	if (triggers.equationTrigger) candidates.push([triggers.equationTrigger, InlineNumeralsMode.Equation, NumeralsRenderStyle.Plain]);
	if (triggers.texResultTrigger) candidates.push([triggers.texResultTrigger, InlineNumeralsMode.ResultOnly, NumeralsRenderStyle.TeX]);
	if (triggers.texEquationTrigger) candidates.push([triggers.texEquationTrigger, InlineNumeralsMode.Equation, NumeralsRenderStyle.TeX]);

	// Sort longest-first to avoid prefix conflicts ("#=$:" before "#=:")
	candidates.sort((a, b) => b[0].length - a[0].length);

	for (const [trigger, mode, renderStyle] of candidates) {
		if (text.startsWith(trigger)) {
			const expression = text.slice(trigger.length).trim();
			if (expression.length === 0) {
				return null;
			}
			return { mode, renderStyle, expression };
		}
	}

	return null;
}
