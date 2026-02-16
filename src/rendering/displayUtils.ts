import * as math from "mathjs";
import {
	finishRenderMath,
	renderMath,
	sanitizeHTMLToDom,
} from "obsidian";
import { defaultCurrencyMap } from "../constants";

/**
 * Regular expression for matching variables with subscript notation
 * using `\_`.
 */
const subscriptRegex =
	/(?<varStart>[\p{L}\p{Nl}_$])(?<varBody>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]*)(\\_)(?<varEnd>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]+)/gu;

const currencyReplacementRegexes = defaultCurrencyMap.map((symbolType) => ({
	symbolName: symbolType.name,
	regex: RegExp(`\\\\*\\${symbolType.symbol}`, "g"),
}));

const highlightedNumberRegex =
	/<span class="math-number">([^<]+)<\/span>/g;

const expandedHighlightNumberFormat = {
	notation: "auto",
	lowerExp: -20,
	upperExp: 20,
	precision: 15,
} as const;

const defaultLocaleFormatterOptions: Intl.NumberFormatOptions = {
	maximumSignificantDigits: 15,
	useGrouping: true,
};

/**
 * Replaces currency symbols in a given TeX string with their corresponding TeX command.
 *
 * @param inputTeX - The input TeX string, potentially containing currency symbols.
 * @returns The input string with all currency symbols replaced with their corresponding TeX command.
 */
export function texCurrencyReplacement(inputTeX: string): string {
	let output = inputTeX;
	for (const replacement of currencyReplacementRegexes) {
		output = output.replace(replacement.regex, `\\${replacement.symbolName} `);
	}
	return output;
}

/**
 * Converts a string of HTML into a DocumentFragment containing a sanitized
 * collection of DOM elements.
 *
 * @param html The HTML string to convert.
 * @returns A DocumentFragment containing DOM elements.
 */
export function htmlToElements(html: string): DocumentFragment {
	return sanitizeHTMLToDom(html);
}

export async function mathjaxLoop(
	container: HTMLElement,
	value: string
): Promise<void> {
	const html = renderMath(value, true);
	await finishRenderMath();
	container.append(html);
}

/**
 * Return a function that formats a number according to the given locale.
 * The default formatter preserves small/precise values by using
 * significant digits rather than browser defaults.
 *
 * @param locale Locale to use
 * @param options Options to use (see Intl.NumberFormat)
 * @returns Function that calls toLocaleString with given locale and options
 */
export function getLocaleFormatter(
	locale: Intl.LocalesArgument | undefined = undefined,
	options: Intl.NumberFormatOptions | undefined = undefined
): (value: number) => string {
	const normalizedOptions = {
		...defaultLocaleFormatterOptions,
		...(options ?? {}),
	};
	if (locale === undefined) {
		return (value: number): string => value.toLocaleString(undefined, normalizedOptions);
	}

	return (value: number): string => value.toLocaleString(locale, normalizedOptions);
}

/**
 * Rewrites mathjs-highlighted number spans so large/small values are displayed
 * in decimal form rather than forced scientific notation.
 */
export function normalizeHighlightedNumberNotation(highlightedHtml: string): string {
	return highlightedHtml.replace(highlightedNumberRegex, (_fullMatch, numberText: string) => {
		const parsed = Number(numberText);
		if (!Number.isFinite(parsed)) {
			return `<span class="math-number">${numberText}</span>`;
		}
		const normalized = math.format(parsed, expandedHighlightNumberFormat);
		return `<span class="math-number">${normalized}</span>`;
	});
}

/**
 * Transforms a given string by unescaping and reformatting subscript notation.
 *
 * @param input - A string potentially containing variables with subscript notation using `\_`.
 * @returns The input string with the subscript notation reformatted.
 */
export function unescapeSubscripts(input: string): string {
	return input.replace(
		subscriptRegex,
		(_match, varStart, varBody, _escapeSequence, varEnd) => {
			return `${varStart}${varBody}_{${varEnd}}`;
		}
	);
}
