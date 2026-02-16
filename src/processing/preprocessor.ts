import {
	CREATE_UNIT_DIRECTIVE,
	HIDE_ROWS_DIRECTIVE,
	ROLLING_TOTAL_MAGIC_VARIABLE,
	PREVIOUS_VALUE_MAGIC_VARIABLE,
} from "../constants";
import { numeralsBlockInfo, StringReplaceMap } from "../numerals.types";

/**
 * Applies a map of replacements to text in-order.
 */
export function replaceStringsInTextFromMap(
	text: string,
	stringReplaceMap: StringReplaceMap[]
): string {
	let output = text;
	for (const processor of stringReplaceMap) {
		output = output.replace(processor.regex, processor.replaceStr);
	}
	return output;
}

/**
 * Replaces the rolling-total magic variable in processed text with either a
 * provided replacement or a directive recovered from the raw input.
 */
export function replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(
	processedString: string,
	rawString: string,
	replacement: string | undefined = undefined
): string {
	const directiveRegex = /@(sum|total)\b/g;
	const directiveMatches = rawString.match(directiveRegex);

	if (replacement) {
		return processedString.replace(
			new RegExp(`(${ROLLING_TOTAL_MAGIC_VARIABLE}|\\\\_\\\\_${ROLLING_TOTAL_MAGIC_VARIABLE.slice(2)})\\b`, "g"),
			replacement
		);
	}

	const defaultReplacementDirective = "@Sum";
	return processedString.replace(
		new RegExp(`(${ROLLING_TOTAL_MAGIC_VARIABLE}|\\\\_\\\\_${ROLLING_TOTAL_MAGIC_VARIABLE.slice(2)})\\b`, "g"),
		() => directiveMatches?.shift() ?? defaultReplacementDirective
	);
}

/**
 * Pre-processes a block to remove Numerals directives and apply replacements.
 */
export function preProcessBlockForNumeralsDirectives(
	source: string,
	preProcessors: StringReplaceMap[] | undefined
): {
	rawRows: string[];
	processedSource: string;
	blockInfo: numeralsBlockInfo;
} {
	const rawRows: string[] = source.split("\n");
	let processedSource: string = source;

	const emitter_lines: number[] = [];
	const insertion_lines: number[] = [];
	const hidden_lines: number[] = [];
	let shouldHideNonEmitterLines = false;

	for (let i = 0; i < rawRows.length; i++) {
		if (rawRows[i].match(/^[^#\r\n]*=>.*$/)) {
			emitter_lines.push(i);
		}

		const insertionMatch = rawRows[i].match(/@\s*\[([^\]:]+)(::)?([^\]]*)\].*$/);
		if (insertionMatch) {
			insertion_lines.push(i);
		}

		if (rawRows[i].match(new RegExp(`^\\s*${HIDE_ROWS_DIRECTIVE}\\s*$`))) {
			hidden_lines.push(i);
			shouldHideNonEmitterLines = true;
		}

		if (rawRows[i].match(new RegExp(`^\\s*${CREATE_UNIT_DIRECTIVE}\\s*$`))) {
			hidden_lines.push(i);
		}
	}

	processedSource = processedSource.replace(
		/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm,
		"$1"
	);
	processedSource = processedSource.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3");
	processedSource = processedSource.replace(/@sum/gi, ROLLING_TOTAL_MAGIC_VARIABLE);
	processedSource = processedSource.replace(/@total/gi, ROLLING_TOTAL_MAGIC_VARIABLE);
	processedSource = processedSource.replace(/@prev/gi, PREVIOUS_VALUE_MAGIC_VARIABLE);
	processedSource = processedSource.replace(new RegExp(`^\\s*${HIDE_ROWS_DIRECTIVE}`, "gim"), "");

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
		},
	};
}
