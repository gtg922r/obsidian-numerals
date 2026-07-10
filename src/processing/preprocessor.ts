import { NumeralsFormatDirective, StringReplaceMap, numeralsBlockInfo } from '../numerals.types';

/** Matches a valid `@format <name> [N]` line (name validated separately). */
const FORMAT_DIRECTIVE_REGEX = /^\s*@format\s+([a-z]+)(?:\s+(\d+))?\s*$/i;

/** Matches a valid `@decimalPlaces N` / `@decimalPlace N` line (N required). */
const DECIMAL_PLACES_DIRECTIVE_REGEX = /^\s*@decimalPlaces?\s+(\d+)\s*$/i;

/**
 * Resolve a `@format` notation name to its mathjs notation, or `undefined` when
 * the name is not recognized (so the directive line stays visible and errors).
 *
 * @param name - The raw notation name from the directive (case-insensitive).
 * @returns The mathjs notation, or `undefined` for unknown names.
 */
function resolveFormatNotation(name: string): NumeralsFormatDirective['notation'] | undefined {
	switch (name.toLowerCase()) {
		case 'fixed':
			return 'fixed';
		case 'exponential':
		case 'exp':
		case 'sci':
		case 'scientific':
			return 'exponential';
		case 'eng':
		case 'engineering':
			return 'engineering';
		default:
			return undefined;
	}
}

/**
 * Parse a single source line into a {@link NumeralsFormatDirective}.
 *
 * Recognizes `@format <name> [N]` and the `@decimalPlaces N` / `@decimalPlace N`
 * alias (which maps to `@format fixed N`, with `N` required). `N` must be a
 * non-negative integer. Returns `undefined` for non-directive lines and for
 * invalid directives (unknown notation, negative/decimal/non-numeric `N`, or a
 * bare `@decimalPlaces`) so they remain ordinary input and surface a mathjs error.
 *
 * @param line - A raw source line.
 * @returns The parsed directive, or `undefined` when the line is not a valid directive.
 */
function parseFormatDirectiveLine(line: string): NumeralsFormatDirective | undefined {
	const formatMatch = line.match(FORMAT_DIRECTIVE_REGEX);
	if (formatMatch) {
		const notation = resolveFormatNotation(formatMatch[1]);
		if (notation === undefined) {
			return undefined;
		}
		const precision = formatMatch[2] !== undefined ? Number(formatMatch[2]) : undefined;
		return { notation, ...(precision !== undefined && { precision }) };
	}

	const decimalMatch = line.match(DECIMAL_PLACES_DIRECTIVE_REGEX);
	if (decimalMatch) {
		return { notation: 'fixed', precision: Number(decimalMatch[1]) };
	}

	return undefined;
}

/**
 * Process a block of text to convert from Numerals syntax to MathJax syntax
 * @param text Text to process
 * @param stringReplaceMap Array of StringReplaceMap objects to use for replacement
 * @returns Processed text 
 */
export function replaceStringsInTextFromMap(text: string, stringReplaceMap: StringReplaceMap[]): string {
	for (const processor of stringReplaceMap ) {
		text = text.replace(processor.regex, processor.replaceStr)
	}
	return text;
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
	source: string,
	preProcessors: StringReplaceMap[] | undefined,
): {
	rawRows: string[],
	processedSource: string,
	blockInfo: numeralsBlockInfo
} {

	const rawRows: string[] = source.split("\n");
	let processedSource:string = source;

	const emitter_lines: number[] = [];
	const insertion_lines: number[] = [];
	const hidden_lines: number[] = [];
	let shouldHideNonEmitterLines = false;
	let formatDirective: NumeralsFormatDirective | undefined = undefined;
	const formatDirectiveRows: number[] = [];

	// Find emitter and result insertion lines before modifying source
	for (let i = 0; i < rawRows.length; i++) {

		// Find emitter lines (lines that end with `=>`)
		if (rawRows[i].match(/^[^#\r\n]*=>.*$/)) {				 								
			emitter_lines.push(i);
		}

		// Find result insertion lines (lines that match `@[variable::result]`)
		const insertionMatch = rawRows[i].match(/@\s*\[([^\]:]+)(::)?([^\]]*)\].*$/);
		if (insertionMatch) {
			insertion_lines.push(i)
		}

		// Find hideRows directives (starts with @hideRows, ignoring whitespace)
		if (rawRows[i].match(/^\s*@hideRows\s*$/)) {
			hidden_lines.push(i);
			shouldHideNonEmitterLines = true;
		}

		// Find @createUnit directives (starts with @createUnit, ignoring whitespace)
		if (rawRows[i].match(/^\s*@createUnit\s*$/)) {
			hidden_lines.push(i);
		}

		// Find @format / @decimalPlaces directives. Only valid directives are
		// hidden, recorded (last valid one wins), and marked for row removal;
		// invalid variants fall through as ordinary input so their failure
		// stays visible.
		const parsedDirective = parseFormatDirectiveLine(rawRows[i]);
		if (parsedDirective) {
			hidden_lines.push(i);
			formatDirective = parsedDirective;
			formatDirectiveRows.push(i);
		}
	}

	// remove `=>` at the end of lines, but preserve comments.
	processedSource = processedSource.replace(/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm,"$1") 

	// Replace Directives
	// Replace result insertion directive `@[variable::result]` with only the variable
	processedSource = processedSource.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3")	

	// Replace sum and prev directives
	processedSource = processedSource.replace(/@sum/gi, "__total");
	processedSource = processedSource.replace(/@total/gi, "__total");
	processedSource = processedSource.replace(/@prev/gi, "__prev");

	// Remove @hideRows directive
	processedSource = processedSource.replace(/^\s*@hideRows/gim, "");

	// Remove valid @format / @decimalPlaces directives by row index. Blanking
	// exactly the rows the detector accepted (none of the replacements above
	// add or remove lines) guarantees detector/stripper agreement by
	// construction: invalid variants — including a directive suffixed with `=>`,
	// which the `=>` removal above would otherwise disguise as a valid line —
	// remain visible and surface a mathjs error. Rows become empty strings so
	// line indices stay aligned for emitter/insertion/hidden bookkeeping.
	if (formatDirectiveRows.length > 0) {
		const processedRows = processedSource.split("\n");
		for (const row of formatDirectiveRows) {
			processedRows[row] = "";
		}
		processedSource = processedRows.join("\n");
	}

	// Apply any pre-processors (e.g. currency replacement, thousands separator replacement, etc.)
	if (preProcessors && preProcessors.length > 0) {
		processedSource = replaceStringsInTextFromMap(processedSource, preProcessors);
	}

	return {
		rawRows,
		processedSource,
		blockInfo: {
			emitter_lines,
			insertion_lines,
			hidden_lines,
			shouldHideNonEmitterLines,
			formatDirective
		}
	}
}
