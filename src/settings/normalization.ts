import equal from 'fast-deep-equal';
import {
	CurrencyDisplayMode, CurrencyPrecisionMode, CurrencyType, DEFAULT_SETTINGS,
	MAX_CURRENCY_DECIMAL_PLACES, MIN_CURRENCY_DECIMAL_PLACES,
	NumeralsLayout, NumeralsNumberFormat, NumeralsRenderStyle, NumeralsSettings,
} from '../numerals.types';
import { currencyCodesForDollarSign, currencyCodesForYenSign } from './currencies';

export const inlineTriggerKeys = [
	'inlineResultTrigger', 'inlineEquationTrigger', 'inlineTexResultTrigger', 'inlineTexEquationTrigger',
] as const;
export type InlineTriggerKey = typeof inlineTriggerKeys[number];
export type SettingsPatch = { [K in keyof NumeralsSettings]?: NumeralsSettings[K] };

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

export function createDefaultSettings(): NumeralsSettings {
	return {
		...DEFAULT_SETTINGS,
		currencyDisplayMode: CurrencyDisplayMode.Symbol,
		dollarSymbolCurrency: { ...DEFAULT_SETTINGS.dollarSymbolCurrency },
		yenSymbolCurrency: { ...DEFAULT_SETTINGS.yenSymbolCurrency },
		customCurrencySymbol: null,
	};
}

export function customCurrencyError(value: unknown): string | undefined {
	if (value === null) return;
	const entry = record(value);
	if (typeof entry.symbol !== 'string' || !/^\p{Sc}$/u.test(entry.symbol)) {
		return 'Enter one currency symbol, such as $ or ₿.';
	}
	if (typeof entry.currency !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/u.test(entry.currency)) {
		return 'Start the currency code with a letter and use only letters or digits.';
	}
}

export function customCurrency(symbol: string, currency: string): CurrencyType {
	const candidate = { symbol, currency };
	const error = customCurrencyError(candidate);
	if (error) throw new Error(error);
	return { ...candidate, name: 'custom', unicode: `x${symbol.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` };
}

const isString = (value: unknown): boolean => typeof value === 'string';
const isBoolean = (value: unknown): boolean => typeof value === 'boolean';
const oneOf = (values: readonly string[]) => (value: unknown): boolean => typeof value === 'string' && values.includes(value);
const mapping = (symbol: string, codes: Record<string, string>) => (value: unknown): boolean => {
	const entry = record(value);
	return entry.symbol === symbol && typeof entry.currency === 'string' && Object.prototype.hasOwnProperty.call(codes, entry.currency);
};

const validators: { [K in keyof NumeralsSettings]: (value: unknown) => boolean } = {
	resultSeparator: isString,
	layoutStyle: oneOf(Object.values(NumeralsLayout)),
	alternateRowColor: isBoolean,
	defaultRenderStyle: oneOf(Object.values(NumeralsRenderStyle)),
	hideLinesWithoutMarkupWhenEmitting: isBoolean,
	hideEmitterMarkupInInput: isBoolean,
	dollarSymbolCurrency: mapping('$', currencyCodesForDollarSign),
	yenSymbolCurrency: mapping('¥', currencyCodesForYenSign),
	provideSuggestions: isBoolean,
	suggestionsIncludeMathjsSymbols: isBoolean,
	numberFormat: oneOf(Object.values(NumeralsNumberFormat)),
	currencyPrecisionMode: oneOf(Object.values(CurrencyPrecisionMode)),
	currencyDisplayMode: oneOf(Object.values(CurrencyDisplayMode)),
	customCurrencyDecimalPlaces: value => typeof value === 'number' && Number.isInteger(value) &&
		value >= MIN_CURRENCY_DECIMAL_PLACES && value <= MAX_CURRENCY_DECIMAL_PLACES,
	forceProcessAllFrontmatter: isBoolean,
	customCurrencySymbol: value => customCurrencyError(value) === undefined,
	enableGreekAutoComplete: isBoolean,
	enableInlineNumerals: isBoolean,
	inlineResultTrigger: isString,
	inlineEquationTrigger: isString,
	inlineTexResultTrigger: isString,
	inlineTexEquationTrigger: isString,
	inlineEquationSeparator: isString,
	provideInlineSuggestions: isBoolean,
	enableCrossNoteReferences: isBoolean,
};

/** Return a detached, complete settings value; never mutate stored data or defaults. */
export function normalizeSettings(data: unknown): NumeralsSettings {
	const stored = { ...record(data) };
	if (stored.layoutStyle == null && typeof stored.renderStyle === 'number') {
		stored.layoutStyle = [undefined, NumeralsLayout.TwoPanes, NumeralsLayout.AnswerRight, NumeralsLayout.AnswerBelow][stored.renderStyle];
	} else if (typeof stored.layoutStyle === 'number') {
		stored.layoutStyle = [NumeralsLayout.TwoPanes, NumeralsLayout.AnswerRight, NumeralsLayout.AnswerBelow, NumeralsLayout.AnswerInline][stored.layoutStyle];
	}
	const normalized = createDefaultSettings();
	for (const key of Object.keys(validators) as (keyof NumeralsSettings)[]) {
		if (validators[key](stored[key])) Object.assign(normalized, { [key]: stored[key] });
	}
	// A legacy nested mapping can omit its fixed symbol without losing its valid code.
	for (const key of ['dollarSymbolCurrency', 'yenSymbolCurrency'] as const) {
		const candidate: Record<string, unknown> = { symbol: normalized[key].symbol, ...record(stored[key]) };
		if (validators[key](candidate)) normalized[key] = { symbol: candidate.symbol as string, currency: candidate.currency as string };
		else normalized[key] = { ...createDefaultSettings()[key] };
	}
	if (normalized.customCurrencySymbol) {
		normalized.customCurrencySymbol = customCurrency(normalized.customCurrencySymbol.symbol, normalized.customCurrencySymbol.currency);
	}
	// Saved strings take precedence over missing defaults. Exact duplicate nonempty
	// values keep the first saved mode; later conflicts are disabled deterministically.
	const ordered = [...inlineTriggerKeys].sort((a, b) => Number(isString(stored[b])) - Number(isString(stored[a])));
	const used = new Set<string>();
	for (const key of ordered) {
		const trigger = normalized[key];
		if (trigger && used.has(trigger)) normalized[key] = '';
		else if (trigger) used.add(trigger);
	}
	return normalized;
}

export function settingError(settings: NumeralsSettings, key: string, value: unknown): string | undefined {
	if (!Object.prototype.hasOwnProperty.call(validators, key)) return 'Unknown setting.';
	if (!validators[key as keyof NumeralsSettings](value)) {
		return key === 'customCurrencySymbol' ? customCurrencyError(value) : 'Enter a valid value for this setting.';
	}
	if (inlineTriggerKeys.includes(key as InlineTriggerKey) && value !== '' &&
		inlineTriggerKeys.some(other => other !== key && settings[other] === value)) {
		return 'Choose a different trigger; this exact trigger is already in use.';
	}
}

export function applySettingsPatch(settings: NumeralsSettings, patch: Record<string, unknown>): NumeralsSettings {
	const candidate = { ...settings, ...patch };
	for (const [key, value] of Object.entries(patch)) {
		const error = settingError(candidate, key, value);
		if (error) throw new Error(error);
	}
	return normalizeSettings(candidate);
}

export function settingsEqual(left: NumeralsSettings, right: NumeralsSettings): boolean {
	return equal(left, right);
}
