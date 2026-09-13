import { all, create, MathJsInstance, Unit } from 'mathjs';
import type { CurrencyType, NumeralsSettings } from '../numerals.types';
import { defaultCurrencyMap } from './currencies';

export function currencyMappings(settings: NumeralsSettings): CurrencyType[] {
	const entries = defaultCurrencyMap.map(entry => ({ ...entry,
		currency: entry.symbol === '$' ? settings.dollarSymbolCurrency.currency :
			entry.symbol === '¥' ? settings.yenSymbolCurrency.currency : entry.currency,
	}));
	if (settings.customCurrencySymbol) {
		const index = entries.findIndex(entry => entry.symbol === settings.customCurrencySymbol?.symbol);
		if (index < 0) entries.push({ ...settings.customCurrencySymbol });
		else entries[index] = { ...settings.customCurrencySymbol };
	}
	return entries;
}

const reservedNames = new Set(['true', 'false', 'null', 'undefined', 'end', 'in', 'to', 'and', 'or', 'xor', 'not', 'mod']);

export interface CurrencyRuntime {
	readonly math: MathJsInstance;
	readonly mappings: readonly CurrencyType[];
	readonly texSymbols: ReadonlyMap<string, string>;
	readonly warnings: readonly string[];
	/** Representative owned definitions detect user replacements before remapping. */
	readonly ownedUnits: ReadonlyMap<string, Unit>;
	/** Release parser shims when the owning plugin unloads. */
	dispose(): void;
}

/** Build a private, complete candidate before publishing any settings or runtime. */
export function createCurrencyRuntime(settings: NumeralsSettings, previous?: CurrencyRuntime): CurrencyRuntime {
	const math = create(all);
	const mappings = currencyMappings(settings);
	const symbols = new Set(mappings.map(entry => entry.symbol));
	// Unit's documented alphabet hook sees UTF-16 code units without neighbors.
	const symbolCodeUnits = new Set(mappings.flatMap(entry => entry.symbol.split('')));
	// Function-property views preserve exact originals without unbound method calls.
	const parserAlphabet: { isAlpha: (character: string, previous: string, next: string) => boolean } = math.parse;
	const unitAlphabet: { isValidAlpha: (character: string) => boolean } = math.Unit;
	const parseAlpha = parserAlphabet.isAlpha, unitAlpha = unitAlphabet.isValidAlpha;
	math.parse.isAlpha = (character, before, after) => parseAlpha(character, before, after) || symbols.has(character) ||
		symbols.has(character + after) || symbols.has(before + character);
	unitAlphabet.isValidAlpha = character => unitAlpha(character) || symbolCodeUnits.has(character);
	const dispose = () => { math.parse.isAlpha = parseAlpha; unitAlphabet.isValidAlpha = unitAlpha; };
	try {
		const codes = new Set(mappings.map(entry => entry.currency));
		const names = new Map<string, string>();
		const warnings: string[] = [];

		for (const code of codes) names.set(code, code);
		for (const entry of mappings) names.set(entry.symbol, entry.currency);
		for (const name of names.keys()) {
			if (currencyNameConflicts(math, previous, name)) throw new Error(`Currency name ${name} conflicts with an existing mathjs name or unit; choose another code or remove the conflicting declaration in Numerals settings.`);
		}
		for (const code of codes) {
			const alias = code.toLowerCase();
			if (alias === code) continue;
			if (currencyNameConflicts(math, previous, alias) || (names.has(alias) && names.get(alias) !== code)) {
				warnings.push(`Lowercase ${alias} keeps its existing meaning; use ${code} or its configured symbol.`);
			} else names.set(alias, code);
		}
		for (const code of codes) math.createUnit(code);
		for (const [name, code] of names) {
			if (name !== code) math.createUnit(name, { definition: `1 ${code}` });
			const interpreted: unknown = math.evaluate(`1 ${name}`);
			if (!math.isUnit(interpreted) || !interpreted.equals(math.unit(1, code))) {
				throw new Error(`Currency name ${name} is not an unambiguous unit in expressions; choose another code in Numerals settings.`);
			}
		}
		return {
			math, warnings: Object.freeze(warnings),
			ownedUnits: new Map([...names.keys()].map(name => [name, math.unit(1, name).clone()])),
			mappings: Object.freeze(mappings.map(entry => Object.freeze(entry))),
			texSymbols: new Map(mappings.map(entry => [entry.symbol, `\\unicode{${entry.unicode}}`])), dispose,
		};
	} catch (error) { dispose(); throw error; }
}

// Keep prior-engine checks outside candidate closures: a parser/dispose closure
// must never capture a chain of every previously configured currency engine.
function currencyNameConflicts(math: MathJsInstance, previous: CurrencyRuntime | undefined, name: string): boolean {
	if (name in math || reservedNames.has(name) || math.Unit.isValuelessUnit(name)) return true;
	if (!previous?.math.Unit.isValuelessUnit(name)) return false;
	const owned = previous.ownedUnits.get(name);
	return !owned || !previous.math.unit(1, name).equals(owned);
}
