import { finishRenderMath, renderMath, sanitizeHTMLToDom } from 'obsidian';
import * as math from 'mathjs';
import { CurrencyType, CurrencyResultDisplay, NumeralsDisplayContext, mathjsFormat } from '../numerals.types';

const MAX_FIXED_FORMAT_LEADING_DECIMAL_ZEROES = 5;

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
	const defaultFormatter = new Intl.NumberFormat(locale, options);
	const preciseFormatter = new Intl.NumberFormat(locale, {
		...options,
		maximumSignificantDigits: Math.max(options?.maximumSignificantDigits ?? 0, 15),
	});
	const zero = defaultFormatter.format(0);
	const negativeZero = defaultFormatter.format(-0);

	return (value: number): string => {
		const formattedValue = defaultFormatter.format(value);
		if (Number.isFinite(value) && value !== 0 && (formattedValue === zero || formattedValue === negativeZero)) {
			if (countLeadingDecimalZeroes(value) > MAX_FIXED_FORMAT_LEADING_DECIMAL_ZEROES) {
				return math.format(value, { notation: 'exponential' });
			}
			return preciseFormatter.format(value);
		}
		return formattedValue;
	};
}

function countLeadingDecimalZeroes(value: number): number {
	const absValue = Math.abs(value);
	if (absValue >= 1 || absValue === 0) {
		return 0;
	}
	return Math.max(0, -Math.floor(Math.log10(absValue)) - 1);
}

/****************************************************
 * Currency-aware result formatting
 ****************************************************/

/**
 * A mathjs Unit narrowed to the fields Numerals inspects for currency
 * detection: its component list and its numeric value.
 */
interface MathjsUnitWithComponents {
	units: math.Unit['units'];
	value: number | null;
}

/** Fallback minor-unit count for currencies Intl cannot resolve. */
const DEFAULT_CURRENCY_MINOR_UNITS = 2;

/** Cache of ISO code → conventional minor-unit (decimal) count. */
const currencyMinorUnitsCache = new Map<string, number>();

/**
 * Resolve the number of conventional minor units (decimal places) for an ISO
 * currency code via `Intl.NumberFormat`, cached per code.
 *
 * Examples: USD/GBP/EUR/INR → 2, JPY → 0. Codes that Intl cannot resolve
 * (e.g. custom non-ISO codes) fall back to {@link DEFAULT_CURRENCY_MINOR_UNITS}.
 *
 * @param code - The ISO 4217 currency code (e.g. `"USD"`).
 * @returns The conventional decimal-place count for the currency.
 */
export function getCurrencyMinorUnits(code: string): number {
	const cached = currencyMinorUnitsCache.get(code);
	if (cached !== undefined) {
		return cached;
	}

	let minorUnits = DEFAULT_CURRENCY_MINOR_UNITS;
	try {
		const resolved = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: code,
		}).resolvedOptions();
		minorUnits = resolved.maximumFractionDigits ?? DEFAULT_CURRENCY_MINOR_UNITS;
	} catch {
		minorUnits = DEFAULT_CURRENCY_MINOR_UNITS;
	}

	currencyMinorUnitsCache.set(code, minorUnits);
	return minorUnits;
}

/**
 * Determine whether a value is a "pure" currency result and, if so, resolve
 * its ISO code and display symbol.
 *
 * A value is pure currency when it is a mathjs Unit with exactly one unit
 * component at power 1, a finite numeric value, and a component unit name that
 * matches an active currency code. Compound units (e.g. `$/hr`) and units with
 * a null value return `null`.
 *
 * @param value - The evaluated result to inspect.
 * @param currencies - The active currency map (symbol ↔ ISO code).
 * @returns `{ code, symbol }` for a pure currency value, otherwise `null`.
 */
export function getPureCurrencyInfo(
	value: unknown,
	currencies: ReadonlyArray<CurrencyType>
): { code: string; symbol: string } | null {
	if (!math.isUnit(value)) {
		return null;
	}

	const unit = value as unknown as MathjsUnitWithComponents;
	if (unit.units.length !== 1) {
		return null;
	}

	const [component] = unit.units;
	if (component.power !== 1) {
		return null;
	}

	if (typeof unit.value !== 'number' || !Number.isFinite(unit.value)) {
		return null;
	}

	const code = component.unit.name;
	const match = currencies.find(currency => currency.currency === code);
	if (!match) {
		return null;
	}

	return { code, symbol: match.symbol };
}

/**
 * Format an evaluated result for display, restoring currency conventions.
 *
 * Non-currency values format exactly as before via `math.format`. Pure
 * currency values are formatted with their conventional decimal places (unless
 * `ctx.hasExplicitFormat` is set) and rendered either with the currency symbol
 * (`$12.50`) or the ISO code (`12.50 USD`) per `ctx.currencyDisplay`.
 *
 * @param value - The evaluated result (number, Unit, matrix, etc.).
 * @param ctx - Display context (number format + currency configuration).
 * @returns The formatted display string.
 */
export function formatNumeralsResult(value: unknown, ctx: NumeralsDisplayContext): string {
	const info = getPureCurrencyInfo(value, ctx.currencies);
	if (!info) {
		return ctx.numberFormat !== undefined
			? math.format(value, ctx.numberFormat)
			: math.format(value);
	}

	const numeric = formatPureCurrencyNumeric(value, info.code, ctx);
	if (ctx.currencyDisplay === CurrencyResultDisplay.CurrencyCode) {
		return `${numeric} ${info.code}`;
	}
	return applyCurrencySymbol(numeric, info.symbol);
}

/**
 * Build the TeX string for a pure currency result, bypassing the
 * `math.parse(...).toTex()` reconstruction path.
 *
 * The numeric part always uses an en-US, no-grouping formatter (a constraint of
 * the TeX rendering path) with conventional decimals. Symbol mode emits e.g.
 * `\pound 12.50` (sign outside: `-\pound 12.50`); code mode emits
 * `12.50~\mathrm{GBP}`.
 *
 * @param value - The evaluated result to inspect.
 * @param ctx - Display context (currency configuration).
 * @returns The TeX string, or `null` when the value is not pure currency.
 */
export function formatPureCurrencyTeX(value: unknown, ctx: NumeralsDisplayContext): string | null {
	const info = getPureCurrencyInfo(value, ctx.currencies);
	if (!info) {
		return null;
	}

	// The TeX path cannot carry grouping separators through parsing, so the
	// numeric part is always formatted en-US without grouping.
	const texCtx: NumeralsDisplayContext = {
		...ctx,
		numberFormat: getLocaleFormatter('en-US', { useGrouping: false }),
	};
	const numeric = formatPureCurrencyNumeric(value, info.code, texCtx);

	if (ctx.currencyDisplay === CurrencyResultDisplay.CurrencyCode) {
		return `${numeric}~\\mathrm{${info.code}}`;
	}
	return texCurrencyReplacement(applyCurrencySymbol(numeric, info.symbol));
}

/**
 * Format the numeric portion of a pure currency value (no symbol, no code),
 * applying conventional decimals unless an explicit format is in effect.
 */
function formatPureCurrencyNumeric(
	value: unknown,
	code: string,
	ctx: NumeralsDisplayContext
): string {
	const minorUnits = getCurrencyMinorUnits(code);
	const resolvedFormat = ctx.hasExplicitFormat
		? ctx.numberFormat
		: getCurrencyNumberFormat(ctx.numberFormat, minorUnits);
	// `math.format(value, undefined)` matches `math.format(value)`, so an
	// explicit-but-undefined format still formats with mathjs defaults.
	const formatted = math.format(value, resolvedFormat);
	return stripTrailingCurrencyCode(formatted, code);
}

/**
 * Prefix a formatted numeric string with a currency symbol, keeping any
 * negative sign outside the symbol (e.g. `-12.50` → `-£12.50`).
 */
function applyCurrencySymbol(numeric: string, symbol: string): string {
	if (numeric.startsWith('-')) {
		return `-${symbol}${numeric.slice(1)}`;
	}
	return `${symbol}${numeric}`;
}

/**
 * Strip a trailing ` CODE` suffix produced by `math.format` on a Unit.
 * Matches the exact unit code (custom codes may not be three letters).
 */
function stripTrailingCurrencyCode(formatted: string, code: string): string {
	const suffix = ` ${code}`;
	return formatted.endsWith(suffix)
		? formatted.slice(0, -suffix.length)
		: formatted;
}

/**
 * Derive the mathjs format used for a pure currency's numeric part.
 *
 * Object/undefined base formats become `{ notation: 'fixed', precision: N }`.
 * Callback (locale) formats are wrapped so the fraction is rounded and padded
 * or truncated to exactly N digits, respecting the locale decimal separator.
 */
function getCurrencyNumberFormat(numberFormat: mathjsFormat, minorUnits: number): mathjsFormat {
	if (typeof numberFormat === 'function') {
		const baseFormatter = numberFormat;
		return (value: unknown): string => {
			if (typeof value === 'number') {
				return formatNumberWithFixedDecimals(value, baseFormatter, minorUnits);
			}
			return math.format(value);
		};
	}

	return { notation: 'fixed', precision: minorUnits };
}

/**
 * Format a number through a locale formatter, then round and pad/truncate its
 * fraction to exactly `decimals` digits (0 → no decimal separator at all).
 */
function formatNumberWithFixedDecimals(
	value: number,
	baseFormatter: (value: number) => string,
	decimals: number
): string {
	if (!Number.isFinite(value)) {
		return baseFormatter(value);
	}

	const roundedValue = roundToDecimalPlaces(value, decimals);
	const formattedValue = baseFormatter(roundedValue);
	// Locale formatters can fall back to exponential for extreme values; the
	// fixed-decimal padding below does not apply to that notation.
	if (/[eE][+-]?\d+$/.test(formattedValue)) {
		return roundedValue.toFixed(decimals);
	}

	const decimalSeparator = getDecimalSeparator(baseFormatter);
	const decimalIndex = formattedValue.lastIndexOf(decimalSeparator);

	if (decimals === 0) {
		// No fractional part wanted — drop any separator and digits after it.
		return decimalIndex === -1 ? formattedValue : formattedValue.slice(0, decimalIndex);
	}

	if (decimalIndex === -1) {
		return `${formattedValue}${decimalSeparator}${'0'.repeat(decimals)}`;
	}

	const fractionDigits = formattedValue.length - decimalIndex - decimalSeparator.length;
	if (fractionDigits < decimals) {
		return `${formattedValue}${'0'.repeat(decimals - fractionDigits)}`;
	}
	return formattedValue;
}

/** Round to N decimal places, nudging by EPSILON to avoid float artifacts. */
function roundToDecimalPlaces(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
}

/** Detect the decimal separator a locale formatter uses (e.g. `.` or `,`). */
function getDecimalSeparator(formatter: (value: number) => string): string {
	const formatted = formatter(1.1);
	const match = formatted.match(/1(\D+)1/u);
	return match?.[1] ?? '.';
}
