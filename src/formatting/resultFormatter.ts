import type { BigNumber, Complex, Fraction, MathJsInstance, ResultSet } from 'mathjs';
import { getMathRuntime } from '../mathRuntime';
// This leaf ownership helper has no formatter imports or runtime side effects.
import { getOwnedFunctionString, isOwnedResultDescription } from '../evaluation/valueOwnership';
import {
	CurrencyDisplayMode,
	CurrencyPrecisionMode,
} from '../numerals.types';
import type { StringReplaceMap } from '../numerals.types';
import {
	getLocaleFormatter,
	texCurrencyReplacement,
} from '../rendering/displayUtils';
import { resultToTeX } from '../rendering/texRendering';
import type { CurrencyRegistry } from './currencyRegistry';
import {
	formatWithNumberFormatProfile,
	formatNumberWithProfile,
	resolveNumberFormatProfile,
} from './numberFormat';
import type {
	FormattedResult,
	CurrencyMatch,
	NumberFormatProfile,
	ResultFormatOverrides,
	ResultFormatter,
} from './types';

export interface ResultFormatterConfig {
	/** Engine retained with the raw results and currency definitions it created. */
	runtime?: MathJsInstance;
	profile: NumberFormatProfile;
	/** Active currency definitions created by Numerals. */
	currencies?: CurrencyRegistry;
	/** Whether pure currency values follow the number format or ISO minor units. */
	currencyPrecisionMode?: CurrencyPrecisionMode;
	/** Whether pure currency values display their unit code or configured symbol. */
	currencyDisplayMode?: CurrencyDisplayMode;
	/** Legacy TeX conversion applies these source preprocessing rules. */
	preProcessors?: StringReplaceMap[];
}

/** Create the shared formatter used by block, inline, TeX, and insertion paths. */
export function createResultFormatter(
	config: ResultFormatterConfig
): ResultFormatter {
	return new DefaultResultFormatter(config);
}

class DefaultResultFormatter implements ResultFormatter {
	private readonly math: MathJsInstance;
	private readonly profile: NumberFormatProfile;
	private readonly preProcessors: StringReplaceMap[];
	private readonly currencies: CurrencyRegistry | undefined;
	private readonly currencyPrecisionMode: CurrencyPrecisionMode;
	private readonly currencyDisplayMode: CurrencyDisplayMode;

	constructor(config: ResultFormatterConfig) {
		if (config.runtime && config.currencies && config.runtime !== config.currencies.runtime) {
			throw new Error('The currency registry and formatter must retain the same mathjs runtime.');
		}
		this.math = config.runtime ?? config.currencies?.runtime ?? getMathRuntime();
		this.profile = config.profile;
		this.preProcessors = [...(config.preProcessors ?? [])];
		this.currencies = config.currencies;
		this.currencyPrecisionMode = config.currencyPrecisionMode ??
			CurrencyPrecisionMode.CurrencyStandard;
		this.currencyDisplayMode = config.currencyDisplayMode ??
			CurrencyDisplayMode.Symbol;
	}

	format(rawValue: unknown, overrides?: ResultFormatOverrides): FormattedResult {
		const math = this.math;
		const descriptionAware = needsDescriptionDisplay(rawValue, math);
		const displayState = {cyclic: false};
		const displayValue = descriptionAware ? prepareDescriptionDisplay(rawValue, math, new Set(), displayState) : rawValue;
		const value = this.currencies?.canonicalizeAliases(displayValue) ?? displayValue;
		const profile = resolveNumberFormatProfile(this.profile, overrides, math);
		const currency = this.currencies?.match(value);
		if (currency) {
			if (this.usesCurrencyPresentation(overrides)) {
				return this.formatCurrency(currency, profile, overrides);
			}

			const legacy = this.formatGeneral(value, profile, overrides);
			return {
				...legacy,
				// Preserve legacy display while ensuring persisted currency never
				// depends on the alias used to construct the mathjs Unit.
				canonical: `${formatCurrencyNumber(
					currency.amount,
					profile,
					undefined, math
				)} ${currency.definition.code}`,
			};
		}

		return this.formatGeneral(value, profile, overrides, displayState.cyclic);
	}

	private usesCurrencyPresentation(
		overrides?: ResultFormatOverrides
	): boolean {
		return overrides?.decimalPlaces !== undefined ||
			this.currencyPrecisionMode === CurrencyPrecisionMode.CurrencyStandard ||
			this.currencyDisplayMode === CurrencyDisplayMode.Symbol;
	}

	private formatGeneral(
		value: unknown,
		profile: NumberFormatProfile,
		overrides?: ResultFormatOverrides,
		cycleAware = false
	): FormattedResult {
		const math = this.math;
		const text = formatWithNumberFormatProfile(
			value,
			profile,
			overrides?.decimalPlaces, math
		);

		let tex: string;
		try {
			tex = overrides?.decimalPlaces === undefined && overrides?.numberFormat === undefined
					? legacyResultToTeX(value, this.preProcessors, math, cycleAware)
					: formatOverrideAsTeX(value, profile, overrides?.decimalPlaces, this.preProcessors, math);
		} catch (error: unknown) {
			if (!cycleAware) throw error;
			// Cyclic input has no legacy serialization. Ordinary and function
			// results retain their exact existing conversion and diagnostics.
			tex = `\\text{${escapeDescriptionText(formatWithNumberFormatProfile(value, texProfile(profile, math), overrides?.decimalPlaces, math))}}`;
		}

		return {
			text,
			tex,
			// Compatibility path: preserve the PR 1 insertion contract.
			canonical: text,
		};
	}

	private formatCurrency(
		currency: CurrencyMatch,
		profile: NumberFormatProfile,
		overrides?: ResultFormatOverrides
	): FormattedResult {
		const math = this.math;
		const decimalPlaces = overrides?.decimalPlaces ??
			(this.currencyPrecisionMode === CurrencyPrecisionMode.CurrencyStandard
				? currency.definition.fractionDigits
				: undefined);
		const numericText = formatCurrencyNumber(
			currency.amount,
			profile,
			decimalPlaces, math
		);
		const text = this.currencyDisplayMode === CurrencyDisplayMode.Symbol
			? placeConfiguredCurrencySymbol(
				currency,
				profile,
				decimalPlaces, math
			)
			: `${numericText} ${currency.definition.code}`;

		const nonLocalizedProfile = nonLocalizedNumberProfile(profile, math);
		const canonicalNumber = formatCurrencyNumber(
			currency.amount,
			nonLocalizedProfile,
			decimalPlaces, math
		);
		const canonical = `${canonicalNumber} ${currency.definition.code}`;
		const tex = formatCurrencyTeX(
			currency,
			nonLocalizedProfile,
			decimalPlaces,
			this.currencyDisplayMode, math
		);

		return { text, tex, canonical };
	}
}

function formatCurrencyNumber(
	value: number,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	return decimalPlaces === undefined
		? formatWithNumberFormatProfile(value, profile, undefined, math)
		: formatNumberWithProfile(value, profile, decimalPlaces, math);
}

function placeConfiguredCurrencySymbol(
	currency: CurrencyMatch,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	const negative = currency.amount < 0 || Object.is(currency.amount, -0);
	const numericText = formatCurrencyNumber(
		Math.abs(currency.amount),
		profile,
		decimalPlaces, math
	);
	const locale = profile.locale ?? profile.systemLocale;
	const templateCurrency = /^[A-Za-z]{3}$/u.test(currency.definition.code)
		? currency.definition.code.toUpperCase()
		: 'USD';
	const parts = new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: templateCurrency,
		currencyDisplay: 'symbol',
		useGrouping: false,
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).formatToParts(negative ? -1 : 1);

	let insertedNumber = false;
	return parts.map((part) => {
		if (part.type === 'currency') {
			return currency.definition.symbol;
		}
		if (isNumericFormatPart(part.type)) {
			if (insertedNumber) {
				return '';
			}
			insertedNumber = true;
			return numericText;
		}
		return part.value;
	}).join('');
}

function isNumericFormatPart(type: Intl.NumberFormatPartTypes): boolean {
	return type === 'integer' ||
		type === 'group' ||
		type === 'decimal' ||
		type === 'fraction' ||
		type === 'nan' ||
		type === 'infinity' ||
		type === 'compact' ||
		type === 'exponentInteger' ||
		type === 'exponentMinusSign' ||
		type === 'exponentSeparator';
}

function nonLocalizedNumberProfile(
	profile: NumberFormatProfile,
	math: MathJsInstance
): NumberFormatProfile {
	if (profile.notation !== 'standard') {
		return profile;
	}

	return {
		...profile,
		locale: 'en-US',
		useGrouping: false,
		mathjsFormat: getLocaleFormatter('en-US', { useGrouping: false }, math),
	};
}

function formatCurrencyTeX(
	currency: CurrencyMatch,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	displayMode: CurrencyDisplayMode,
	math: MathJsInstance = getMathRuntime()
): string {
	if (displayMode === CurrencyDisplayMode.Symbol) {
		const negative = currency.amount < 0 || Object.is(currency.amount, -0);
		const numberTex = numberToTeX(
			Math.abs(currency.amount),
			profile,
			decimalPlaces, math
		);
		return `${negative ? '-' : ''}${currency.definition.texCommand} ${numberTex}`;
	}

	const numberTex = numberToTeX(currency.amount, profile, decimalPlaces, math);
	return `${numberTex}~\\mathrm{${escapeTexRoman(currency.definition.code)}}`;
}

function escapeTexRoman(value: string): string {
	return value.replace(/([{}#$%&_])/gu, '\\$1');
}

function legacyResultToTeX(
	value: unknown,
	preProcessors: StringReplaceMap[],
	math: MathJsInstance = getMathRuntime(),
	descriptionAware = false
): string {
	try {
		return resultToTeX(value, preProcessors, math);
	} catch {
		if (value === Number.POSITIVE_INFINITY) {
			return '\\infty';
		}
		if (value === Number.NEGATIVE_INFINITY) {
			return '-\\infty';
		}
		if (typeof value === 'number' && Number.isNaN(value)) {
			return '\\mathrm{NaN}';
		}
		return `\\text{${(descriptionAware ? escapeDescriptionText : escapeTexText)(math.format(value))}}`;
	}
}

function formatOverrideAsTeX(
	value: unknown,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	preProcessors: StringReplaceMap[],
	math: MathJsInstance = getMathRuntime()
): string {
	if (typeof value === 'number') {
		return numberToTeX(value, profile, decimalPlaces, math);
	}
	if (math.isBigNumber(value)) {
		return bigNumberToTeX(value, profile, decimalPlaces, math);
	}
	if (math.isFraction(value)) {
		return numberToTeX(Number(value.valueOf()), profile, decimalPlaces, math);
	}

	if (math.isComplex(value)) {
		return complexToTeX(value, profile, decimalPlaces, math);
	}

	const collectionTex = collectionToTeX(
		value,
		profile,
		decimalPlaces,
		preProcessors, math
	);
	if (collectionTex !== undefined) {
		return collectionTex;
	}

	if (math.isUnit(value)) {
		try {
			const units = value.formatUnits();
			const numericValue = value.toNumeric(units);
			const numberTex = numericValueToTeX(
				numericValue,
				profile,
				decimalPlaces, math
			);
			let unitExpression = `1 ${units}`;
			unitExpression = applyPreProcessors(unitExpression, preProcessors);
			const unitTex = texCurrencyReplacement(
				math.parse(unitExpression).toTex()
			);
			return unitTex.replace(/1/u, () => numberTex);
		} catch {
			// Fall through to the generic result conversion.
		}
	}

	let processedResult = formatWithNumberFormatProfile(
		value,
		texProfile(profile, math),
		decimalPlaces, math
	);
	processedResult = applyPreProcessors(processedResult, preProcessors);

	try {
		return texCurrencyReplacement(math.parse(processedResult).toTex());
	} catch {
		// Keep the fallback value-driven and non-localized. Some uncommon
		// mathjs result types cannot be round-tripped through expression text.
		return resultToTeX(value, preProcessors, math);
	}
}

function numericValueToTeX(
	value: number | BigNumber | Fraction,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	if (math.isBigNumber(value)) {
		return bigNumberToTeX(value, profile, decimalPlaces, math);
	}
	if (math.isFraction(value)) {
		return numberToTeX(Number(value.valueOf()), profile, decimalPlaces, math);
	}
	return numberToTeX(value, profile, decimalPlaces, math);
}

function numberToTeX(
	value: number,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	const specialValue = specialNumberToTeX(value);
	if (specialValue !== undefined) {
		return specialValue;
	}

	return numberStringToTeX(formatNumberForTeX(value, profile, decimalPlaces, math));
}

function bigNumberToTeX(
	value: BigNumber,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	if (value.isNaN()) {
		return '\\mathrm{NaN}';
	}
	if (!value.isFinite()) {
		return `${value.isNegative() ? '-' : ''}\\infty`;
	}

	return numberStringToTeX(formatWithNumberFormatProfile(
		value,
		texProfile(profile, math),
		decimalPlaces, math
	));
}

function specialNumberToTeX(value: number): string | undefined {
	if (value === Number.POSITIVE_INFINITY) {
		return '\\infty';
	}
	if (value === Number.NEGATIVE_INFINITY) {
		return '-\\infty';
	}
	if (Number.isNaN(value)) {
		return '\\mathrm{NaN}';
	}

	return undefined;
}

function complexToTeX(
	value: Complex,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	const realTex = numberToTeX(value.re, profile, decimalPlaces, math);
	const imaginaryTex = numberToTeX(
		Math.abs(value.im),
		profile,
		decimalPlaces, math
	);

	if (value.im === 0) {
		return realTex;
	}
	if (value.re === 0) {
		return `${value.im < 0 ? '-' : ''}${imaginaryTex}~ i`;
	}

	return `${realTex} ${value.im < 0 ? '-' : '+'} ${imaginaryTex}~ i`;
}

function collectionToTeX(
	value: unknown,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	preProcessors: StringReplaceMap[],
	math: MathJsInstance = getMathRuntime()
): string | undefined {
	let collection: unknown = value;
	if (math.isMatrix(value)) {
		collection = value.toArray();
	}
	if (!Array.isArray(collection)) {
		return undefined;
	}
	const collectionItems = collection as unknown[];
	if (collectionItems.length === 0) {
		return '\\begin{bmatrix}\\end{bmatrix}';
	}

	let rows: unknown[][];
	if (collectionItems.every((item) => !Array.isArray(item))) {
		rows = collectionItems.map((item) => [item]);
	} else if (isRegularMatrix(collectionItems)) {
		rows = collectionItems;
	} else {
		const renderedItems = collectionItems.map((item) =>
			formatOverrideAsTeX(item, profile, decimalPlaces, preProcessors, math)
		);
		return `\\left[${renderedItems.join(', ')}\\right]`;
	}

	const renderedRows = rows.map((row) => row.map((cell) =>
		formatOverrideAsTeX(cell, profile, decimalPlaces, preProcessors, math)
	).join('&'));

	return `\\begin{bmatrix}${renderedRows.join('\\\\')}\\end{bmatrix}`;
}

function isRegularMatrix(value: unknown[]): value is unknown[][] {
	if (!value.every(isFlatCollectionRow)) {
		return false;
	}

	const columnCount = value[0].length;
	return value.every((row) => row.length === columnCount);
}

function isFlatCollectionRow(value: unknown): value is unknown[] {
	return Array.isArray(value) &&
		(value as unknown[]).every((cell) => !Array.isArray(cell));
}

function applyPreProcessors(
	value: string,
	preProcessors: StringReplaceMap[]
): string {
	let processedResult = value;
	for (const processor of preProcessors) {
		processedResult = processedResult.replace(
			processor.regex,
			processor.replaceStr
		);
	}
	return processedResult;
}

function formatNumberForTeX(
	value: number,
	profile: NumberFormatProfile,
	decimalPlaces: number | undefined,
	math: MathJsInstance = getMathRuntime()
): string {
	const profileForTeX = texProfile(profile, math);
	if (decimalPlaces !== undefined) {
		return formatNumberWithProfile(value, profileForTeX, decimalPlaces, math);
	}

	return math.format(value, profileForTeX.mathjsFormat);
}

function texProfile(profile: NumberFormatProfile, math: MathJsInstance): NumberFormatProfile {
	if (profile.notation !== 'standard') {
		return profile;
	}

	return {
		...profile,
		locale: 'en-US',
		useGrouping: false,
		mathjsFormat: getLocaleFormatter('en-US', { useGrouping: false }, math),
	};
}

function numberStringToTeX(value: string): string {
	const exponential = value.match(/^(.+)[eE]([+-]?\d+)$/u);
	if (!exponential) {
		return value;
	}

	return `${exponential[1]} \\times 10^{${Number(exponential[2])}}`;
}

/** Immutable presentation leaf for mathjs's public custom-format hook. */
class DescriptionDisplay {
	constructor(private readonly text: string, private readonly nativeString = text) { Object.freeze(this); }
	format(): string { return this.text; }
	/** Native ResultSet intentionally stringifies entries rather than formatting them. */
	toString(): string { return this.nativeString; }
	/** Public matrix cloning may clone its elements; immutable display leaves can be shared. */
	clone(): DescriptionDisplay { return this; }
}

function descriptorDisplay(value: object): DescriptionDisplay | undefined {
	if (!isOwnedResultDescription(value)) return undefined;
	return value.kind === 'numerals-function'
		? new DescriptionDisplay(value.syntax || 'function', getOwnedFunctionString(value) ?? value.syntax)
		: new DescriptionDisplay(value.text || `[${value.type || 'Unknown value'}]`);
}

/** Inspect only; ordinary payloads keep the existing formatting implementation. */
function needsDescriptionDisplay(value: unknown, math: MathJsInstance, ancestors = new Set<object>()): boolean {
	if (value === null || typeof value !== 'object') return false;
	if (isOwnedResultDescription(value) || ancestors.has(value)) return true;
	const next = new Set(ancestors).add(value);
	const needsDisplay = (entry: unknown): boolean => needsDescriptionDisplay(entry, math, next);
	const prototype: unknown = Object.getPrototypeOf(value);
	// Plain data must precede mathjs predicates, which assume native prototypes.
	if (prototype === null) return true;
	if (prototype === Object.prototype) {
		return Object.keys(value).some(key => {
			const property = Object.getOwnPropertyDescriptor(value, key);
			return !!property && 'value' in property && needsDisplay(property.value);
		});
	}
	if (Array.isArray(value)) return value.some(needsDisplay);
	if (math.isResultSet(value)) return value.entries.some(needsDisplay);
	if (math.isMatrix(value)) {
		let found = false;
		value.forEach((entry: unknown) => { if (!found) found = needsDisplay(entry); }, true);
		return found;
	}
	return false;
}

/**
 * Adapt owned detached descriptions without retaining or restoring a
 * callable function. Numeric/native leaves continue through the shared existing
 * formatter; only container shells and constant display descriptions are made.
 */
function prepareDescriptionDisplay(value: unknown, math: MathJsInstance, ancestors = new Set<object>(), state = {cyclic: false}): unknown {
	if (value === null || typeof value !== 'object' || value instanceof DescriptionDisplay) return value;
	const description = descriptorDisplay(value);
	if (description) return description;
	if (ancestors.has(value)) { state.cyclic = true; return new DescriptionDisplay('[Circular reference]'); }
	const next = new Set(ancestors).add(value);
	const prepare = (item: unknown): unknown => prepareDescriptionDisplay(item, math, next, state);
	if (Array.isArray(value)) return value.map(prepare);
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === Object.prototype || prototype === null) {
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			const property = Object.getOwnPropertyDescriptor(value, key);
			Object.defineProperty(result, key, {enumerable: true, value: property && 'value' in property ? prepare(property.value) :
				new DescriptionDisplay('[Accessor]')});
		}
		return result;
	}
	if (math.isResultSet(value)) {
		// Keep ResultSet's exact native stringification, including its ignored
		// number options; the private leaf supplies the original function string.
		const Constructor = (math as MathJsInstance & {ResultSet: new (entries: unknown[]) => ResultSet}).ResultSet;
		return new Constructor(value.entries.map(prepare));
	}
	if (math.isMatrix(value)) {
		const result = math.matrix(value.storage() === 'sparse' ? 'sparse' : 'dense');
		result.resize(value.size());
		value.forEach((entry: unknown, index) => { result.set(index, prepare(entry)); }, true);
		return result;
	}

	return value;
}

function escapeDescriptionText(value: string): string {
	const replacements: Record<string, string> = {
		'\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '$': '\\$', '%': '\\%',
		'&': '\\&', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
	};
	return value.replace(/[\\{}#$%&_^~]/gu, character => replacements[character]);
}

/** Preserve legacy escaping for ordinary results; descriptions use a single safe pass. */
function escapeTexText(value: string): string {
	return value
		.replace(/\\/gu, '\\textbackslash{}')
		.replace(/([{}#$%&_])/gu, '\\$1')
		.replace(/\^/gu, '\\textasciicircum{}')
		.replace(/~/gu, '\\textasciitilde{}');
}
