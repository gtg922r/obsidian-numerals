import { finishRenderMath, renderMath, sanitizeHTMLToDom } from 'obsidian';
import { CurrencyType } from '../numerals.types';

/**
 * Regular expression for matching variables with subscript notation 
 * using `\_`.
 */
const subscriptRegex = /(?<varStart>[\p{L}\p{Nl}_$])(?<varBody>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]*)(\\_)(?<varEnd>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]+)/gu;

/**
 * Replaces the magic variable for sum in the processed string with either a specified replacement string or the first matching directive from the raw string.
 * 
 * This function searches for occurrences of the magic variable `__total` in the `processedString` and replaces them with either a specified `replacement` string or the first matching sum directive (e.g., `sum` or `total`) found in the `rawString`. If no replacement is specified and no matching directives are found, the magic variable is removed.
 * 
 * @param processedString - The string after initial processing, where the magic variable `__total` needs to be replaced.
 * @param rawString - The original raw string, which is searched for sum directives.
 * @param replacement - An optional string to replace the magic variable with. If not provided, the function uses the first matching directive from the raw string.
 * @returns The `processedString` with the magic variable `__total` replaced as described.
 * 
 * @example
 * ```typescript
 * const processed = "profit = __total";
 * const raw = "profit = @sum";
 * const output = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(processed, raw);
 * console.log(output); // "profit = @sum"
 */
export function replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(processedString:string, rawString: string, replacement:string|undefined = undefined): string {
    const directiveRegex = /@(sum|total)\b/g;
	const directiveMatches = rawString.match(directiveRegex);

	let restoredInput;
	if (replacement) {
		restoredInput = processedString.replace(/(__total|\\_\\_total)\b/g, replacement);
	} else {
		const defaultReplacementDirective = "@Sum";
		restoredInput = processedString.replace(/(__total|\\_\\_total)\b/g, (match) => directiveMatches?.shift() ?? defaultReplacementDirective);
	}

	return restoredInput;
}

/**
 * Transforms a given string by unescaping and reformatting subscript notation.
 *
 * This function takes a string that contains variables with subscript notation, 
 * where the subscript is written as `\_` followed by the subscript characters 
 * (e.g. `var\_subscript`), and reformat it to use underscore and curly braces 
 * (e.g. `var_{subscript}`).
 *
 * The function is useful for processing strings that represent mathematical 
 * notation or code, and need to be reformatted into a more standardized or 
 * readable subscript notation.
 *
 * @param input - A string potentially containing variables with subscript 
 * notation using `\_`.
 *
 * @returns The input string with the subscript notation reformatted, where each
 * `var\_subscript` is replaced with `var_{subscript}`.
 *
 * @example
 * ```typescript
 * const input = "a\_1 + b\_2 = c\_3";
 * const output = unescapeSubscripts(input);
 * console.log(output); // "a_{1} + b_{2} = c_{3}"
 * ```
 */
export function unescapeSubscripts(input: string): string {
    const output = input.replace(subscriptRegex, (match, varStart, varBody, _, varEnd) => {
        return `${varStart}${varBody}_{${varEnd}}`;
    });
  
    return output;
}


// TODO: Add a switch for only rendering input

export const defaultCurrencyMap: CurrencyType[] = [
	{	symbol: "$", unicode: "x024", 	name: "dollar", currency: "USD"},
	{	symbol: "€", unicode: "x20AC",	name: "euro", 	currency: "EUR"},
	{	symbol: "£", unicode: "x00A3",	name: "pound", 	currency: "GBP"},
	{	symbol: "¥", unicode: "x00A5",	name: "yen", 	currency: "JPY"},
	{	symbol: "₹", unicode: "x20B9",	name: "rupee", 	currency: "INR"}	
];

const currencyTexReplacements = defaultCurrencyMap.map(m => ({
	regex: new RegExp('\\\\*\\' + m.symbol, 'g'),
	replacement: '\\' + m.name + ' ',
}));

/**
 * Replaces currency symbols in a given TeX string with their corresponding TeX command.
 *
 * This function takes a TeX string as input, and replaces all occurrences of currency symbols
 * (e.g., "$", "€", "£", "¥", "₹") with their corresponding TeX command (e.g., "\dollar", "\euro",
 * "\pound", "\yen", "\rupee"). The mapping between symbols and commands is defined by the
 * `defaultCurrencyMap` array.
 *
 * @param input_tex - The input TeX string, potentially containing currency symbols.
 *
 * @returns The input string with all currency symbols replaced with their corresponding TeX command.
 */
export function texCurrencyReplacement(input_tex:string) {
	for (const { regex, replacement } of currencyTexReplacements) {
		input_tex = input_tex.replace(regex, replacement);
	}
	return input_tex
}


/**
 * Converts a string of HTML into a DocumentFragment continaing a sanitized collection array of DOM elements.
 *
 * @param html The HTML string to convert.
 * @returns A DocumentFragment contaning DOM elements.
 */
export function htmlToElements(html: string): DocumentFragment {
	const sanitizedHTML = sanitizeHTMLToDom(html);
	return sanitizedHTML;
  }

export async function mathjaxLoop(container: HTMLElement, value: string) {
	const html = renderMath(value, true);
	await finishRenderMath()

	// container.empty();
	container.append(html);
}

/**
 * Return a function that formats a number according to the given locale
 * @param locale Locale to use
 * @param options Options to use (see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat)
 * @returns Function that calls toLocaleString with given locale
 */
export function getLocaleFormatter(
	locale: Intl.LocalesArgument | undefined = undefined,
	options: Intl.NumberFormatOptions | undefined = undefined
): (value: number) => string {
	if (locale === undefined) {
		return (value: number): string => value.toLocaleString();
	} else if (options === undefined) {
		return (value: number): string => value.toLocaleString(locale);
	} else {
		return (value: number): string => value.toLocaleString(locale, options);
	}
}
