import * as math from 'mathjs';
import { NumeralsScope, mathjsFormat, StringReplaceMap } from '../numerals.types';
import { replaceStringsInTextFromMap } from '../processing/preprocessor';

/**
 * Evaluate a single inline expression against a scope.
 *
 * Applies preprocessors (currency symbols, thousands separators),
 * evaluates via mathjs, and formats the result. The scope is cloned
 * to prevent inline expressions from polluting the shared scope.
 *
 * @param expression - The math expression to evaluate (trigger prefix already stripped)
 * @param scope - Variable scope (note-globals + frontmatter)
 * @param numberFormat - mathjs format options for result display
 * @param preProcessors - String replacement rules (currency, thousands, etc.)
 * @returns Formatted result string
 * @throws If mathjs cannot evaluate the expression
 */
export function evaluateInlineExpression(
	expression: string,
	scope: NumeralsScope,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[]
): string {
	// Apply preprocessors (currency symbols, thousands separators)
	let processed = expression;
	if (preProcessors.length > 0) {
		processed = replaceStringsInTextFromMap(processed, preProcessors);
	}

	// Clone scope so inline evaluation doesn't write back to shared state
	const localScope = new NumeralsScope(scope);

	// Evaluate — let mathjs errors propagate to caller
	const result = math.evaluate(processed, localScope);

	return numberFormat !== undefined
		? math.format(result, numberFormat)
		: math.format(result);
}
