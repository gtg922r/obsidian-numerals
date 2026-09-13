import { parseCrossNoteReferences } from '../processing/crossNoteResolver';
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
	// Keep literal reference labels in TeX without printing internal evaluation symbols.
	const references = parseCrossNoteReferences(processedExpression);
	let displaySource = processedExpression;
	const labels = new Map<string, string>();
	for (const [index, ref] of references.slice().reverse().entries()) {
		let symbol = `NumeralsReferenceLabel${index}`;
		while (processedExpression.includes(symbol)) symbol += 'X';
		const escapes: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' };
		labels.set(symbol, `\\text{${ref.fullMatch.replace(/[\\{}$&#%_^~]/g, character => escapes[character])}}`);
		displaySource = displaySource.slice(0, ref.start) + symbol + displaySource.slice(ref.end);
	}
	const preprocessedTex = math.parse(displaySource).toTex({ handler: (node: math.MathNode) => {
		if (math.isSymbolNode(node) && labels.has(node.name)) return node.name;
		return undefined;
	} });
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
	tex = texCurrencyReplacement(tex);
	for (const [symbol, label] of labels) tex = tex.split(symbol).join(label);
	return tex;
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
