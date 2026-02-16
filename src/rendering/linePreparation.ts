import { LineRenderData, NumeralsSettings, numeralsBlockInfo } from "../numerals.types";

/**
 * Extracts inline comment from a raw input string.
 * Comments in Numerals start with # and continue to the end of the line.
 */
export function extractComment(rawInput: string): {
	inputWithoutComment: string;
	comment: string | null;
} {
	const commentMatch = rawInput.match(/#.+$/);
	if (commentMatch) {
		return {
			inputWithoutComment: rawInput.replace(/#.+$/, ""),
			comment: commentMatch[0],
		};
	}
	return {
		inputWithoutComment: rawInput,
		comment: null,
	};
}

/**
 * Renders an inline comment into an HTML element.
 */
export function renderComment(element: HTMLElement, comment: string): void {
	element.createEl("span", { cls: "numerals-inline-comment", text: comment });
}

/**
 * Cleans raw input string by removing Numerals directives for display.
 */
export function cleanRawInput(rawInput: string, settings: NumeralsSettings): string {
	let cleaned = rawInput;

	if (settings.hideEmitterMarkupInInput) {
		cleaned = cleaned.replace(
			/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm,
			"$1$4"
		);
	}

	cleaned = cleaned.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3");
	return cleaned;
}

/**
 * Prepares data for rendering a single line in a Numerals block.
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

	const rawInput = rawRows[index] || "";
	const cleanedInput = cleanRawInput(rawInput, settings);
	const { inputWithoutComment, comment } = extractComment(cleanedInput);

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
