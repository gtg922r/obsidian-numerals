import * as math from 'mathjs';
import { NumeralsScope, mathjsFormat, StringReplaceMap, InlineEvaluationResult } from '../numerals.types';
import { replaceStringsInTextFromMap } from '../processing/preprocessor';

/**
 * Evaluate a single inline expression against a scope.
 *
 * Applies preprocessors (currency symbols, thousands separators),
 * handles the `@prev` directive (substituted to `__prev`),
 * evaluates via mathjs, and formats the result. The scope is cloned
 * to prevent inline expressions from polluting the shared scope.
 *
 * @param expression - The math expression to evaluate (trigger prefix already stripped)
 * @param scope - Variable scope (note-globals + frontmatter)
 * @param numberFormat - mathjs format options for result display
 * @param preProcessors - String replacement rules (currency, thousands, etc.)
 * @param prevResult - The raw result of the previous inline expression (for @prev support).
 *                     Pass `undefined` when there is no previous result.
 * @returns Object with `formatted` (display string) and `raw` (mathjs value for chaining)
 * @throws If mathjs cannot evaluate the expression, or @prev is used without a previous result
 */
export function evaluateInlineExpression(
	expression: string,
	scope: NumeralsScope,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[],
	prevResult?: unknown,
): InlineEvaluationResult {
	// Apply preprocessors (currency symbols, thousands separators)
	let processed = expression;
	if (preProcessors.length > 0) {
		processed = replaceStringsInTextFromMap(processed, preProcessors);
	}

	// Replace @prev directive with __prev (case-insensitive, matching code block behavior)
	processed = processed.replace(/@prev/gi, '__prev');

	// Clone scope so inline evaluation doesn't write back to shared state
	const localScope = new NumeralsScope(scope);

	// Inject __prev into scope if the expression references it
	if (/__prev/i.test(processed)) {
		if (prevResult === undefined) {
			throw new Error('Error evaluating @prev directive. There is no previous inline result.');
		}
		localScope.set('__prev', prevResult);
	}

	// Evaluate — let mathjs errors propagate to caller
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mathjs evaluate() returns `any`
	const result = math.evaluate(processed, localScope);

	// mathjs returns undefined for comments/empty expressions
	if (result === undefined) {
		throw new Error('Expression produced no result');
	}

	const formatted = numberFormat !== undefined
		? math.format(result, numberFormat)
		: math.format(result);

	// Extract note-global ($-prefixed) variable assignments.
	// Compare the local scope against the original to find new or changed $-keys.
	const globals = new Map<string, unknown>();
	for (const [key, value] of localScope.entries()) {
		if (key.startsWith('$') && value !== scope.get(key)) {
			globals.set(key, value);
		}
	}

	return { formatted, raw: result, globals };
}
