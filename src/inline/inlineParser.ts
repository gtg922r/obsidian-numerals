import { InlineNumeralsMode, InlineNumeralsExpression, NumeralsRenderStyle } from '../numerals.types';

export const INLINE_TEX_RESULT_TRIGGER = '#$:';
export const INLINE_TEX_EQUATION_TRIGGER = '#=$:';

export interface InlineTriggerCandidate {
	trigger: string;
	mode: InlineNumeralsMode;
	renderStyle: NumeralsRenderStyle;
}

/**
 * Build the complete list of inline trigger candidates.
 *
 * User-configurable plain triggers are kept alongside fixed TeX triggers.
 * TeX triggers are not settings because they are per-expression style markers.
 */
export function getInlineTriggerCandidates(
	resultTrigger: string,
	equationTrigger: string,
): InlineTriggerCandidate[] {
	const candidates: InlineTriggerCandidate[] = [];

	function addCandidate(
		trigger: string,
		mode: InlineNumeralsMode,
		renderStyle: NumeralsRenderStyle,
	): void {
		if (!trigger) return;
		if (candidates.some(candidate => candidate.trigger === trigger)) return;
		candidates.push({ trigger, mode, renderStyle });
	}

	addCandidate(INLINE_TEX_RESULT_TRIGGER, InlineNumeralsMode.ResultOnly, NumeralsRenderStyle.TeX);
	addCandidate(INLINE_TEX_EQUATION_TRIGGER, InlineNumeralsMode.Equation, NumeralsRenderStyle.TeX);
	addCandidate(resultTrigger, InlineNumeralsMode.ResultOnly, NumeralsRenderStyle.Plain);
	addCandidate(equationTrigger, InlineNumeralsMode.Equation, NumeralsRenderStyle.Plain);

	return candidates.sort((a, b) => b.trigger.length - a.trigger.length);
}

export function hasInlineTrigger(
	text: string,
	resultTrigger: string,
	equationTrigger: string,
): boolean {
	return getInlineTriggerCandidates(resultTrigger, equationTrigger).some(({ trigger }) =>
		text.startsWith(trigger)
	);
}

/**
 * Attempt to parse an inline code string as a Numerals expression.
 *
 * Checks whether the text starts with a recognized trigger prefix. This includes
 * user-configured plain triggers plus fixed TeX triggers (`#$:` and `#=$:`).
 * The longer trigger is checked first to handle prefix conflicts.
 *
 * Empty triggers are silently ignored to prevent matching all code spans.
 *
 * @param text - The raw inline code text
 * @param resultTrigger - Trigger prefix for result-only mode (e.g. "#:")
 * @param equationTrigger - Trigger prefix for equation mode (e.g. "#=:")
 * @returns Parsed expression with mode and render style, or null if no trigger matched
 */
export function parseInlineExpression(
	text: string,
	resultTrigger: string,
	equationTrigger: string
): InlineNumeralsExpression | null {
	const candidates = getInlineTriggerCandidates(resultTrigger, equationTrigger);

	for (const { trigger, mode, renderStyle } of candidates) {
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
