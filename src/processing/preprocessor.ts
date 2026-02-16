import { StringReplaceMap, numeralsBlockInfo } from '../numerals.types';

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
			shouldHideNonEmitterLines
		}
	}
}
