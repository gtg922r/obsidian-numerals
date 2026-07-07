import * as math from 'mathjs';
import { StringReplaceMap } from '../numerals.types';
import {
	texCurrencyReplacement,
	unescapeSubscripts,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
	getLocaleFormatter,
} from './displayUtils';

/**
 * Convert a mathjs-ready expression into TeX, preserving Numerals display
 * conventions such as escaped subscripts, currency symbols, and @sum labels.
 */
export function expressionToTeX(
	processedExpression: string,
	rawExpression = processedExpression
): string {
	const preprocessedTex = math.parse(processedExpression).toTex();
	let tex = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(
		preprocessedTex,
		rawExpression,
		'@Sum()'
	);
	// Restore the @prev directive for display: mathjs toTex() emits the
	// substituted magic variable `__prev` as `\_\_prev`. Must run before
	// unescapeSubscripts, which would rewrite `\_\_prev` into `\__{prev}`.
	tex = tex.replace(/(\\_\\_|__)prev\b/g, '@prev');
	tex = unescapeSubscripts(tex);
	return texCurrencyReplacement(tex);
}

/**
 * Convert an evaluated mathjs result into TeX using the same no-grouping,
 * period-decimal formatting that block TeX rendering uses.
 */
export function resultToTeX(
	result: unknown,
	preProcessors: StringReplaceMap[]
): string {
	let processedResult = math.format(
		result,
		getLocaleFormatter('en-US', { useGrouping: false })
	);

	for (const processor of preProcessors) {
		processedResult = processedResult.replace(processor.regex, processor.replaceStr);
	}

	return texCurrencyReplacement(math.parse(processedResult).toTex());
}
