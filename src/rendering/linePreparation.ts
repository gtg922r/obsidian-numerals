import { scanExpression } from '../processing/expressionScanner';
import { NumeralsSettings, numeralsBlockInfo, LineRenderData } from '../numerals.types';

/**
 * Extracts inline comment from a raw input string.
 * Comments in Numerals start with # and continue to the end of the line.
 *
 * @param rawInput - The raw input string that may contain a comment
 * @returns Object with the input without comment and the extracted comment (or null)
 *
 * @example
 * ```typescript
 * extractComment("2 + 2 # this is a comment")
 * // Returns: { inputWithoutComment: "2 + 2 ", comment: " this is a comment" }
 *
 * extractComment("2 + 2")
 * // Returns: { inputWithoutComment: "2 + 2", comment: null }
 * ```
 */
export function extractComment(rawInput: string): {
	inputWithoutComment: string;
	comment: string | null;
} {
	const tokens = scanExpression(rawInput);
	let commentMatch = tokens.find(t => t.kind === 'comment');
	const emitter = tokens.find(t => t.kind === 'emitter');
	if (!commentMatch && emitter) {
		const comment = scanExpression(emitter.text.slice(2)).find(t => t.kind === 'comment');
		if (comment) commentMatch = { ...comment, start: emitter.start + 2 + comment.start };
	}
	if (commentMatch) {
		return {
			inputWithoutComment: rawInput.slice(0, commentMatch.start),
			comment: commentMatch.text,
		};
	}
	return {
		inputWithoutComment: rawInput,
		comment: null,
	};
}

/**
 * Renders an inline comment into an HTML element.
 * Appends a span with the "numerals-inline-comment" class containing the comment text.
 *
 * @param element - The parent element to append the comment to
 * @param comment - The comment string (including the # symbol)
 *
 * @example
 * ```typescript
 * const container = activeDocument.createElement('div');
 * renderComment(container, "# this is a comment");
 * // Appends: <span class="numerals-inline-comment"># this is a comment</span>
 * ```
 */
export function renderComment(element: HTMLElement, comment: string): void {
	element.createSpan({ cls: "numerals-inline-comment", text: comment });
}

/**
 * Cleans raw input string by removing Numerals directives for display.
 * - Removes emitter markup (=>) if hideEmitterMarkupInInput setting is true
 * - Removes result insertion directive syntax (@[variable::result])
 *
 * This function returns a new string and does not mutate the input.
 *
 * @param rawInput - The raw input string to clean
 * @param settings - Numerals settings that control which directives to hide
 * @returns Cleaned input string ready for display
 *
 * @example
 * ```typescript
 * cleanRawInput("result = 42 =>", { hideEmitterMarkupInInput: true })
 * // Returns: "result = 42 "
 *
 * cleanRawInput("@[profit::100] = sales - costs", settings)
 * // Returns: "profit = sales - costs"
 * ```
 */
export function cleanRawInput(rawInput: string, settings: NumeralsSettings): string {
	// Scanner guards prevent literal strings/comments from becoming display directives.
	const tokens = scanExpression(rawInput);
	let cleaned = rawInput;
	for (const token of tokens.slice().reverse()) {
		if (token.kind === 'insertion') {
			const expression = token.insertion!.expressionSpan;
			const replacement = rawInput.slice(expression.start, expression.end);
			cleaned = cleaned.slice(0, token.start) + replacement + cleaned.slice(token.end);
		} else if (token.kind === 'emitter' && settings.hideEmitterMarkupInInput) {
			cleaned = cleaned.slice(0, token.start).replace(/[\t ]+$/, '') + token.text.replace(/^=>[\t ]*(\$\{.*?\})?/, '');
		}
	}

	return cleaned;
}

/**
 * Prepares data for rendering a single line in a Numerals block.
 * Extracts metadata, cleans input, and determines line characteristics.
 *
 * This is a pure function that transforms raw data into a structured format
 * ready for rendering. It does not mutate any inputs.
 *
 * @param index - Zero-based index of the line in the block
 * @param rawRows - Array of raw input strings from the original source
 * @param inputs - Array of processed input strings that were evaluated
 * @param results - Array of evaluation results
 * @param blockInfo - Metadata about special lines (emitters, insertions, etc.)
 * @param settings - Numerals settings that affect line preparation
 * @returns LineRenderData object ready for rendering
 *
 * @example
 * ```typescript
 * const lineData = prepareLineData(
 *   0,
 *   ["2 + 2 # sum", ""],
 *   ["2 + 2"],
 *   [4, undefined],
 *   { emitter_lines: [], insertion_lines: [], hidden_lines: [], shouldHideNonEmitterLines: false },
 *   settings
 * );
 * // Returns: { index: 0, rawInput: "2 + 2", processedInput: "2 + 2", result: 4,
 * //           isEmpty: false, isEmitter: false, isHidden: false, comment: "# sum" }
 * ```
 */
export function prepareLineData(
	index: number,
	rawRows: string[],
	inputs: string[],
	results: unknown[],
	blockInfo: numeralsBlockInfo,
	settings: NumeralsSettings
): LineRenderData {
	const {
		emitter_lines,
		hidden_lines,
		shouldHideNonEmitterLines,
	} = blockInfo;

	// Get raw input and clean directives
	const rawInput = rawRows[index] || "";
	const cleanedInput = cleanRawInput(rawInput, settings);

	// Extract comment from cleaned input
	const { inputWithoutComment, comment } = extractComment(cleanedInput);

	// Determine line characteristics
	const result = results[index];
	const isEmpty = result === undefined;
	const isEmitter = emitter_lines.includes(index);
	const isHidden =
		hidden_lines.includes(index) ||
		(shouldHideNonEmitterLines && !isEmitter);

	return {
		index,
		rawInput: inputWithoutComment,
		processedInput: inputs[index] || "",
		result,
		isEmpty,
		isEmitter,
		isHidden,
		comment,
	};
}
