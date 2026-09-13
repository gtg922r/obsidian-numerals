import { applySourceEdits, originalSource, scanExpression, normalizeNumericToken, MappedSource, SourceEdit } from './expressionScanner';
import {
	NumeralsNumberFormat,
	ProcessedBlock,
	StringReplaceMap,
} from '../numerals.types';
import {
	BlockNumberFormat,
	collectFormatDirectives,
} from './formatDirectives';

const blockNumberFormatMap: Record<BlockNumberFormat, NumeralsNumberFormat> = {
	system: NumeralsNumberFormat.System,
	fixed: NumeralsNumberFormat.Fixed,
	exponential: NumeralsNumberFormat.Exponential,
	engineering: NumeralsNumberFormat.Engineering,
	'comma-period': NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal,
	'period-comma': NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
	'space-comma': NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal,
	indian: NumeralsNumberFormat.Format_Indian,
};

/**
 * Process a block of text to convert from Numerals syntax to MathJax syntax
 * @param text Text to process
 * @param stringReplaceMap Array of StringReplaceMap objects to use for replacement
 * @returns Processed text 
 */
export function normalizeExpression(mapped: MappedSource, processors: readonly StringReplaceMap[] = []): MappedSource {
	const edits: SourceEdit[] = [];
	const symbols = processors.flatMap(p => p.currencySymbol ? [p.currencySymbol] : []);
	for (const token of scanExpression(mapped.source, symbols)) {
		let text = token.text;
		if (token.kind === 'number') {
			text = normalizeNumericToken(text, token.groupingAllowed) ?? text;
		} else if (token.kind === 'currency') {
			const symbol = token.currencySymbol!;
			const amount = token.currencyAmount === '' ? '' : normalizeNumericToken(token.currencyAmount!, true);
			if (amount === undefined) continue;
			const currency = processors.find(p => p.currencySymbol === symbol && p.currencyCode !== undefined);
			if (currency) text = `${amount} ${currency.currencyCode!}`.trim();
			else {
				text = token.currencyAmount ? token.text.replace(token.currencyAmount, amount) : token.text;
				for (const processor of processors) text = text.replace(processor.regex, processor.replaceStr);
			}
		} else if (token.kind === 'identifier' && !/\p{Sc}/u.test(text)) {
			for (const processor of processors) {
				if (processor.currencySymbol === undefined) text = text.replace(processor.regex, processor.replaceStr);
			}
		}
		if (text !== token.text) edits.push({ ...token, text });
	}
	return applySourceEdits(mapped, edits);
}

export function replaceStringsInTextFromMap(text: string, processors: StringReplaceMap[]): string {
	return normalizeExpression(originalSource(text), processors).source;
}

export function replaceExpressionDirectives(mapped: MappedSource, block: boolean): MappedSource {
	if (block) {
		const edits: SourceEdit[] = [];
		for (const token of scanExpression(mapped.source)) {
			if (token.kind === 'insertion') {
				edits.push({ ...token, text: /^@[\t ]*\[([^\]:]+)(::[^\]]*)?\]/.exec(token.text)![1] });
			} else if (token.kind === 'emitter') {
				edits.push({ ...token, start: mapped.source.slice(0, token.start).replace(/[\t ]+$/, '').length, text: '' });
			}
		}
		mapped = applySourceEdits(mapped, edits);
	}
	// Unwrapping may expose an eligible @prev/@sum/@total. Rescan the mapped source
	// so literals stay protected and each translation retains the original insertion span.
	const edits: SourceEdit[] = [];
	for (const token of scanExpression(mapped.source)) {
		if (token.kind === 'directive' && (block || token.text.toLowerCase() === '@prev')) {
			edits.push({ ...token, text: token.text.toLowerCase() === '@prev' ? '__prev' : '__total' });
		}
	}
	return applySourceEdits(mapped, edits);
}

/**
 * Pre-processes a block of text to apply and remove Numerals directives and apply any pre-processors.
 * Source should be ready to be processed directly by mathjs after this function.
 * 
 * @param source - The source string to process.
 * @param preProcessors - An array of StringReplaceMap objects that specify text replacements to be
 * made in the source string before it is processed.
 * @returns An object containing the processed source string, the emitter lines, and the result
 * insertion lines.
 */
export function preProcessBlockForNumeralsDirectives(
	source: string | MappedSource,
	preProcessors: StringReplaceMap[] | undefined,
): ProcessedBlock {

	const mapped = typeof source === 'string' ? originalSource(source) : source;
	const rawRows = mapped.originalSource.split('\n');
	const tokens = scanExpression(mapped.source);
	// Only rows starting outside a literal can declare whole-line formatting.
	let directiveOffset = 0;
	const directiveSource = mapped.source.split('\n').map(row => {
		const start = directiveOffset + row.search(/\S/);
		directiveOffset += row.length + 1;
		return tokens.some(t => t.kind === 'string' && t.start <= start && t.end > start)
			? row.replace(/[^\r]/g, ' ') : row;
	}).join('\n');
	const formatDirectives = collectFormatDirectives(directiveSource);
	const emitter_lines: number[] = [];
	const insertion_lines: number[] = [];
	const hidden_lines = [...formatDirectives.directiveLineIndexes];
	let shouldHideNonEmitterLines = false;
	const edits: SourceEdit[] = [];
	let offset = 0;
	for (const [index, row] of mapped.source.split('\n').entries()) {
		const rowTokens = tokens.filter(t => t.start >= offset && t.start < offset + row.length);
		if (rowTokens.some(t => t.kind === 'emitter')) emitter_lines.push(index);
		if (rowTokens.some(t => t.kind === 'insertion')) insertion_lines.push(index);
		// Whole-line directives must also start outside a string/comment.
		const start = offset + row.search(/\S/);
		const protectedStart = tokens.some(t => (t.kind === 'string' || t.kind === 'comment') && t.start <= start && t.end > start);
		const hide = !protectedStart && /^\s*@hideRows\s*$/i.test(row);
		if (hide) { hidden_lines.push(index); shouldHideNonEmitterLines = true; }
		if (!protectedStart && (hide || formatDirectives.directiveLineIndexes.includes(index))) {
			edits.push({ start: offset, end: offset + row.replace(/\r$/, '').length, text: '' });
		}
		offset += row.length + 1;
	}
	const sourceMap = normalizeExpression(replaceExpressionDirectives(applySourceEdits(mapped, edits), true), preProcessors);
	const processedSource = sourceMap.source;

	return {
		rawRows,
		processedSource,
		sourceMap,
		transparentLineIndexes: formatDirectives.directiveLineIndexes,
		formatOverrides: {
			numberFormat: formatDirectives.format === undefined
				? undefined
				: blockNumberFormatMap[formatDirectives.format],
			decimalPlaces: formatDirectives.decimalPlaces,
		},
		invalidFormatDirectives: formatDirectives.invalidDirectives,
		blockInfo: {
			emitter_lines,
			insertion_lines,
			hidden_lines,
			shouldHideNonEmitterLines
		}
	}
}
