
import * as math from 'mathjs';

/**
 * Process frontmatter and return updated scope object
 * - Numbers are converted to mathjs numbers. Strings are processed as mathjs expressions.
 * - Objects are ignored
 * - Frontmatter key `numerals` sets which frontmatter keys are processed (none is default)):
 *  - `numerals: all` processes all frontmatter keys
 *  - `numerals: none` processes no frontmatter keys
 *  - `numerals: key1` processes only the frontmatter key `key1`
 *  - `numerals: [key1, key2, ...]` processes only the listed frontmatter keys
 *  * 
 * @param scope Numerals scope object (Map)
 * @param frontmatter Frontmatter object
 * @returns Updated scope object
 * TODO: Does scope thats passed in get updated???
 */
export function processFrontmatter(
	frontmatter: { [key: string]: unknown },
	scope: Map<string, unknown>|undefined,
	forceAll=false,
	stringReplaceMap: StringReplaceMap[] = []
): Map<string, unknown> {
	
	if (!scope) {
		scope = new Map<string, unknown>();
	}

	if (frontmatter && typeof frontmatter === "object") {
		let frontmatter_process:{ [key: string]: unknown } = {}
		if (frontmatter.hasOwnProperty("numerals")) {
			if (frontmatter["numerals"] === "none") {
				frontmatter_process = {};
			} else if (frontmatter.hasOwnProperty("numerals") && frontmatter["numerals"] === "all") {
				// Build frontmatter_process from all keys in frontmatter
				for (const [key, value] of Object.entries(frontmatter)) {
					if (key !== "numerals") {
						frontmatter_process[key] = value;
					}
				}
			} else if (typeof frontmatter["numerals"] === "string") {
				if (frontmatter.hasOwnProperty(frontmatter["numerals"])) {
					frontmatter_process[frontmatter["numerals"]] = frontmatter[frontmatter["numerals"]];
				}
			} else if (Array.isArray(frontmatter["numerals"])) {
				for (const key of frontmatter["numerals"]) {
					if (frontmatter.hasOwnProperty(key)) {
						frontmatter_process[key] = frontmatter[key];
					}
				}
			}

		} else if (forceAll) {
			frontmatter_process = frontmatter;
		}

		for (const [key, rawValue] of Object.entries(frontmatter_process)) {
			let value = rawValue;
			// if processedValue is array-like, take the last element
			if (Array.isArray(value)) {
				value = value[value.length - 1];
			}

			if (typeof value === "number") {
				scope.set(key, math.number(value));
			} else if (typeof value === "string") {
				const processedValue = processTextForReplacements(value, stringReplaceMap);
				scope.set(key, math.evaluate(processedValue));
			}
		}

		return scope;
	} else {
		return scope;
	}
}	

/**
 * Regular expression for matching variables with subscript notation 
 * using `\_`.
 */
const subscriptRegex = /(?<varStart>[\p{L}\p{Nl}_$])(?<varBody>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]*)(\\_)(?<varEnd>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]+)/gu;

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

export interface StringReplaceMap {
	regex: RegExp;
	replaceStr: string;
}

/**
 * Process a block of text to convert from Numerals syntax to MathJax syntax
 * @param text Text to process
 * @param stringReplaceMap Array of StringReplaceMap objects to use for replacement
 * @returns Processed text
 */
export function processTextForReplacements(text: string, stringReplaceMap: StringReplaceMap[]): string {
	for (const processor of stringReplaceMap ) {
		text = text.replace(processor.regex, processor.replaceStr)
	}
	return text;
}
