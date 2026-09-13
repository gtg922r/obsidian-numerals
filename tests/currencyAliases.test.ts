import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { currencyAliasesToCodes, normalizeCurrencyAliases } from '../src/settings/currencyAliases';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';
import type { Unit } from 'mathjs';

describe('narrow native currency alias canonicalization', () => {
	it.each(['1 USD / h', 'USD^2', '-1.23456789 USD / s', '2 m', '2 cups', '2 m^2 / s', 'USD / GBP'])('keeps existing code/physical-unit formatting unchanged: %s', expression => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		const value = runtime.math.evaluate(expression) as Unit;
		const clone = currencyAliasesToCodes(value, runtime.mappings, runtime.math);
		expect(runtime.math.format(clone)).toBe(runtime.math.format(value));
		expect(clone).not.toBe(value);
		expect(clone.equals(value)).toBe(true);
		runtime.dispose();
	});
	it.each([
		['unit("1$")/h', 'USD / h'], ['unit("1$")^2', 'USD^2'], ['unit("-1.23456789$")/h', 'USD / h'],
		['unit("1usd")/h', 'USD / h'], ['unit("1$")/unit("1£")', 'USD / GBP'],
	])('converts only alias unit tokens: %s', (expression, target) => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		const value = runtime.math.evaluate(expression) as Unit, original = runtime.math.format(value);
		const normalized = currencyAliasesToCodes(value, runtime.mappings, runtime.math);
		expect(normalized.formatUnits()).toBe(target);
		expect(normalized.equals(value)).toBe(true);
		expect(runtime.math.format(value)).toBe(original);
		expect(normalized.toNumber(target)).toBe(value.toNumber(target));
		runtime.dispose();
	});
	it.each([
		['unit("$/h")', 'USD / h'],
		['unit("1$") / unit("1$/h")', '1 h'],
		['unit("1$") / unit("1$")', '1'],
	])('preserves valueless and simplification semantics: %s', (expression, expected) => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		const value: unknown = runtime.math.evaluate(expression);
		const normalized = normalizeCurrencyAliases(value, runtime.mappings, runtime.math);
		expect(runtime.math.format(normalized)).toBe(expected);
		runtime.dispose();
	});
	it('normalizes contained currency Units while retaining collection and physical-unit serialization', () => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('$', 'CUP');
		const runtime = createCurrencyRuntime(settings);
		for (const expression of ['[unit("1$"),unit("2$")]', '{fee: unit("1$"), volume: unit("2 cup")}', '[[unit("1$")],[unit("2$")]]']) {
			const original: unknown = runtime.math.evaluate(expression);
			const normalized = normalizeCurrencyAliases(original, runtime.mappings, runtime.math);
			const expected: unknown = runtime.math.evaluate(expression.replace(/1\$/gu, '1 CUP').replace(/2\$/gu, '2 CUP'));
			expect(runtime.math.format(normalized)).toBe(runtime.math.format(expected));
			expect(runtime.math.format(original)).toContain('$');
		}
		expect(runtime.math.format(normalizeCurrencyAliases(runtime.math.evaluate('2 cup'), runtime.mappings, runtime.math))).toBe('2 cup');
		runtime.dispose();
	});
	it('normalizes repeated references to the same matrix consistently', () => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		const matrix: unknown = runtime.math.evaluate('[unit("1$"),unit("2$")]');
		const value = { left: matrix, right: matrix };
		const normalized = normalizeCurrencyAliases(value, runtime.mappings, runtime.math) as { left: unknown; right: unknown };
		expect(normalized.left).toBe(normalized.right);
		expect(runtime.math.format(normalized)).toBe('{"left": [1 USD, 2 USD], "right": [1 USD, 2 USD]}');
		expect(runtime.math.format(value)).toContain('$');
		runtime.dispose();
	});
	it('retains arbitrary numeric precision, independent of symbol display preference', () => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		const value = runtime.math.evaluate('unit(bignumber("1.234567890123456789"), "$") / h') as Unit;
		const normalized = currencyAliasesToCodes(value, runtime.mappings, runtime.math);
		expect(runtime.math.format(normalized)).toBe('1.234567890123456789 USD / h');
		expect(normalized.equals(value)).toBe(true);
		runtime.dispose();
	});
	it('uses a retained mapping after remaps and handles a custom symbol', () => {
		const settings = createDefaultSettings(), old = createCurrencyRuntime(settings);
		const oldValue = old.math.evaluate('unit("1$")/h') as Unit;
		settings.dollarSymbolCurrency.currency = 'CAD'; settings.customCurrencySymbol = customCurrency('₿', 'BTC');
		const next = createCurrencyRuntime(settings, old);
		expect(currencyAliasesToCodes(oldValue, old.mappings, old.math).formatUnits()).toBe('USD / h');
		expect(currencyAliasesToCodes(next.math.evaluate('unit("1$")/h') as Unit, next.mappings, next.math).formatUnits()).toBe('CAD / h');
		expect(currencyAliasesToCodes(next.math.evaluate('unit("1₿")/h') as Unit, next.mappings, next.math).formatUnits()).toBe('BTC / h');
		old.dispose(); next.dispose();
	});
});
