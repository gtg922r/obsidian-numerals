import type { CurrencyType } from '../numerals.types';
import type { MathJsInstance, Unit } from 'mathjs';

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
	// Public JSON APIs retain null/BigNumber values, prefix and simplification flags.
	// Do not stringify: that would serialize numeric objects and lose their raw type.
	return target === units ? value.clone() : math.Unit.fromJSON({ ...value.toJSON(), unit: target });
}

/** Preserve array/matrix/object serialization while detaching contained currency Units. */
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
