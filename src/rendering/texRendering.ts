import * as math from 'mathjs';
import { StringReplaceMap } from '../numerals.types';
import {
	texCurrencyReplacement,
	unescapeSubscripts,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
	getLocaleFormatter,
} from './displayUtils';

function restoreInlineMagicVariables(tex: string, rawExpression: string): string {
	if (!/@prev/i.test(rawExpression)) return tex;
	return tex.replace(/(\\_\\_prev|__prev)\b/g, '@prev');
}

/**
 * Convert a mathjs-ready expression into TeX using Numerals display conventions.
 */
export function expressionToTeX(
	processedExpression: string,
	rawExpression = processedExpression,
): string {
	const preprocessedTex = math.parse(processedExpression).toTex();
	let tex = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(
		preprocessedTex,
		rawExpression,
		'@Sum()',
	);
	tex = restoreInlineMagicVariables(tex, rawExpression);
	tex = unescapeSubscripts(tex);
	return texCurrencyReplacement(tex);
}

/**
 * Convert an evaluated mathjs result into TeX using block TeX result formatting.
 */
export function resultToTeX(
	result: unknown,
	preProcessors: StringReplaceMap[],
): string {
	let processedResult = math.format(
		result,
		getLocaleFormatter('en-US', { useGrouping: false }),
	);

	for (const processor of preProcessors) {
		processedResult = processedResult.replace(processor.regex, processor.replaceStr);
	}

	return texCurrencyReplacement(math.parse(processedResult).toTex());
}
