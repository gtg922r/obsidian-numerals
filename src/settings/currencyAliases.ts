import type { CurrencyType } from '../numerals.types';
import type { MathJsInstance, ResultSet, Unit } from 'mathjs';

/** Normalize aliases in mathjs-generated unit notation, never in source expressions. */
export function currencyAliasesToCodes(value: Unit, mappings: readonly CurrencyType[], math: MathJsInstance): Unit {
	const aliases = new Map<string, string>();
	for (const entry of mappings) {
		for (const alias of [entry.symbol, entry.currency.toLowerCase()]) {
			// Optional lowercase aliases may intentionally remain physical units (cup/CUP).
			if (math.Unit.isValuelessUnit(alias) && math.unit(1, alias).equals(math.unit(1, entry.currency))) {
				aliases.set(alias, entry.currency);
			}
		}
	}
	const units = value.formatUnits();
	const target = units.replace(/[^\s*/^()]+/gu, token => aliases.get(token) ?? token);
	if (target === units) return value.clone();
	// Unit.to copies the normalized value exactly; JSON APIs denormalize and can
	// round BigNumber compound rates. A valueless Unit needs no numeric conversion.
	const normalized = value.value === null ? math.unit(target) : value.to(target);
	normalized.fixPrefix = value.fixPrefix;
	normalized.skipAutomaticSimplification = value.skipAutomaticSimplification;
	return normalized;
}

/** Preserve array/matrix/ResultSet/object serialization while detaching contained currency Units. */
export function normalizeCurrencyAliases(value: unknown, mappings: readonly CurrencyType[], math: MathJsInstance,
	seen = new WeakMap<object, unknown>()): unknown {
	if (math.isUnit(value)) return currencyAliasesToCodes(value, mappings, math);
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);
	if (Array.isArray(value)) {
		const result: unknown[] = []; seen.set(value, result);
		for (const item of value as unknown[]) result.push(normalizeCurrencyAliases(item, mappings, math, seen));
		return result;
	}
	if (math.isResultSet(value)) {
		// ResultSet's public constructor is omitted from mathjs's instance typings.
		// Rebuild its entries directly; JSON stringification would lose raw types.
		const ResultSet = (math as MathJsInstance & { ResultSet: new (entries: unknown[]) => ResultSet }).ResultSet;
		const result = new ResultSet([]); seen.set(value, result);
		result.entries = normalizeCurrencyAliases(value.entries, mappings, math, seen) as unknown[];
		return result;
	}
	if (math.isMatrix(value)) {
		const clone = value.clone(); seen.set(value, clone);
		const normalized = clone.map((item: unknown) => normalizeCurrencyAliases(item, mappings, math, seen));
		seen.set(value, normalized);
		return normalized;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === Object.prototype || prototype === null) {
		const result: Record<string, unknown> = {}; seen.set(value, result);
		for (const [key, item] of Object.entries(value)) {
			Object.defineProperty(result, key, { value: normalizeCurrencyAliases(item, mappings, math, seen), enumerable: true, writable: true, configurable: true });
		}
		return result;
	}
	return value;
}
