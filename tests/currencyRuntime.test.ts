import * as sharedMath from 'mathjs';
import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';

describe('private currency runtime candidate', () => {
	it('supports native suffix and string unit aliases, without modifying shared mathjs', () => {
		const original = sharedMath.parse.isAlpha;
		const runtime = createCurrencyRuntime(createDefaultSettings());
		expect(runtime.math.evaluate('1$').toNumber('USD')).toBe(1);
		expect(runtime.math.evaluate('unit("1$")').toNumber('USD')).toBe(1);
		expect(sharedMath.parse.isAlpha).toBe(original);
		expect(sharedMath.Unit.isValuelessUnit('$')).toBe(false);
		runtime.dispose();
	});
	it('remaps dollar and yen together, while preserving old runtime values', () => {
		const old = createCurrencyRuntime(createDefaultSettings());
		const oldValue = old.math.evaluate('unit("1$")');
		const settings = createDefaultSettings();
		settings.dollarSymbolCurrency.currency = 'CAD'; settings.yenSymbolCurrency.currency = 'CNY';
		const next = createCurrencyRuntime(settings);
		expect(next.math.evaluate('1$').toNumber('CAD')).toBe(1);
		expect(next.math.evaluate('unit("1¥")').toNumber('CNY')).toBe(1);
		expect(oldValue.toNumber('USD')).toBe(1);
		expect(old.math.evaluate('1$').toNumber('USD')).toBe(1);
		old.dispose(); next.dispose();
	});
	it('supports custom symbols, replacement, removal and reload', () => {
		const settings = createDefaultSettings();
		settings.customCurrencySymbol = customCurrency('₿', 'BTC');
		const first = createCurrencyRuntime(settings);
		expect(first.math.evaluate('unit("1₿")').toNumber('BTC')).toBe(1);
		expect(first.texSymbols.get('₿')).toBe('\\unicode{x20BF}');
		settings.customCurrencySymbol = customCurrency('$', 'AUD');
		const replaced = createCurrencyRuntime(settings);
		expect(replaced.math.evaluate('1$').toNumber('AUD')).toBe(1);
		settings.customCurrencySymbol = null;
		const removed = createCurrencyRuntime(settings);
		expect(removed.math.Unit.isValuelessUnit('₿')).toBe(false);
		expect(removed.math.evaluate('1$').toNumber('USD')).toBe(1);
		first.dispose(); replaced.dispose(); removed.dispose();
		const reload = createCurrencyRuntime(settings);
		expect(reload.math.evaluate('unit("1$")').toNumber('USD')).toBe(1);
		reload.dispose();
	});
	it.each(['m', 'min', 'mol'])('rejects a code with an incompatible built-in unit %s', code => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('₿', code);
		expect(() => createCurrencyRuntime(settings)).toThrow(/conflicts with an existing/);
	});
	it.each(['pi', 'sin', 'to', 'and', 'true', 'Infinity', 'constructor'])('rejects a canonical code with another expression meaning: %s', code => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('₿', code);
		expect(() => createCurrencyRuntime(settings)).toThrow(/conflicts|unambiguous/);
	});
	it.each(['\u{11FDD}', '\u{1E2FF}'])('supports a supplementary-plane currency symbol %s in native forms', symbol => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency(symbol, 'XYZ');
		const runtime = createCurrencyRuntime(settings);
		expect(runtime.math.evaluate(`1${symbol}`).toNumber('XYZ')).toBe(1);
		expect(runtime.math.evaluate(`unit("1${symbol}")`).toNumber('XYZ')).toBe(1);
		expect(runtime.math.evaluate(`unit(1,"${symbol}")`).toNumber('XYZ')).toBe(1);
		expect(runtime.texSymbols.get(symbol)).toContain(symbol.codePointAt(0)!.toString(16).toUpperCase());
		runtime.dispose();
	});
	it('keeps optional lowercase collisions intact while allowing a distinct canonical code', () => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('$', 'CUP');
		const runtime = createCurrencyRuntime(settings);
		expect(runtime.math.evaluate('1 CUP').toNumber('CUP')).toBe(1);
		expect(runtime.math.evaluate('unit("1$")').toNumber('CUP')).toBe(1);
		expect(runtime.math.evaluate('1 cup').equalBase(runtime.math.unit('ml'))).toBe(true);
		expect(runtime.warnings.join(' ')).toContain('Lowercase cup keeps its existing meaning');
		runtime.dispose();
	});
	it('creates each shared currency code once and restores parser hooks on unload', () => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('₿', 'USD');
		const runtime = createCurrencyRuntime(settings);
		expect(runtime.math.evaluate('unit(1, "₿") + unit(1, "$")').toNumber('USD')).toBe(2);
		expect(runtime.math.parse.isAlpha('₿', '', '')).toBe(true);
		runtime.dispose();
		expect(runtime.math.parse.isAlpha('₿', '', '')).toBe(false);
		const next = createCurrencyRuntime(createDefaultSettings());
		expect(next.math.parse.isAlpha('₿', '', '')).toBe(false);
		next.dispose();
	});
	it.each(['1$', '1 $', '$ 1', '1 USD to $', 'unit("1$")', 'unit(1,"$")'])('remaps native form %s', expression => {
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('₿', 'USD');
		settings.dollarSymbolCurrency.currency = 'CAD';
		const runtime = createCurrencyRuntime(settings);
		if (expression.includes('USD to')) {
			// Different currencies are independent dimensions, with no exchange rate.
			expect(() => runtime.math.evaluate(expression)).toThrow();
			expect(runtime.math.evaluate(expression.replace('USD', 'CAD')).toNumber('CAD')).toBe(1);
		} else expect(runtime.math.evaluate(expression).toNumber('CAD')).toBe(1);
		expect(runtime.math.evaluate('number(1 CAD,"$")')).toBe(1);
		expect(runtime.math.evaluate('1$/h').toNumber('CAD/h')).toBe(1);
		runtime.dispose();
	});
	it('rejects user-defined code collisions while leaving the active runtime intact', () => {
		const active = createCurrencyRuntime(createDefaultSettings());
		active.math.createUnit('BTC', '2 m');
		const settings = createDefaultSettings(); settings.customCurrencySymbol = customCurrency('₿', 'BTC');
		expect(() => createCurrencyRuntime(settings, active)).toThrow('conflicts with an existing mathjs name or unit');
		expect(active.math.evaluate('unit(1, \"$\")').toNumber('USD')).toBe(1);
		expect(active.math.unit(1, 'BTC').toNumber('m')).toBe(2);
		active.dispose();
	});
	it('retains mathjs breadth and leaves user createUnit collisions visible', () => {
		const runtime = createCurrencyRuntime(createDefaultSettings());
		expect(runtime.math.evaluate('det([1,2;3,4])')).toBe(-2);
		expect(runtime.math.evaluate('sqrt(-1)').toString()).toBe('i');
		expect(runtime.math.evaluate('fraction(1/3)').toFraction()).toBe('1/3');
		expect(runtime.math.evaluate('5 cm in m').toNumber('m')).toBe(0.05);
		runtime.math.evaluate('createUnit("widget", "2 m")');
		expect(() => runtime.math.evaluate('createUnit("widget", "2 m")')).toThrow(/already exists/);
		runtime.dispose();
	});
});
