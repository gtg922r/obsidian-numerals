import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';
import { CurrencyRegistry, createNumberFormatProfile, createResultFormatter } from '../src/formatting';
import { activateMathRuntime, getMathRuntime, resetMathRuntime } from '../src/mathRuntime';
import { CurrencyDisplayMode, NumeralsNumberFormat } from '../src/numerals.types';
import type { Unit } from 'mathjs';

function context(settings = createDefaultSettings()) {
	const currency = createCurrencyRuntime(settings);
	const registry = CurrencyRegistry.create(currency.mappings, { runtime: currency.math });
	const formatter = createResultFormatter({ runtime: currency.math, currencies: registry,
		profile: createNumberFormatProfile(NumeralsNumberFormat.Fixed), currencyDisplayMode: settings.currencyDisplayMode });
	return { currency, registry, formatter };
}

describe('retained currency formatter context', () => {
	afterEach(() => resetMathRuntime());
	it('formats old raw values with their own engine after a mapping remap', () => {
		const old = context(), value = old.currency.math.evaluate('unit("1$")') as Unit;
		const settings = createDefaultSettings(); settings.dollarSymbolCurrency.currency = 'CAD';
		settings.customCurrencySymbol = customCurrency('₿', 'BTC');
		const next = context(settings); activateMathRuntime(next.currency.math);
		expect(old.formatter.format(value)).toEqual({ text: '$1.00', canonical: '1.00 USD', tex: '\\unicode{x0024} 1.00' });
		expect(next.formatter.format(next.currency.math.evaluate('unit("1₿")')).tex).toBe('\\unicode{x20BF} 1.00');
		expect(getMathRuntime()).toBe(next.currency.math);
		expect(value.toNumber('USD')).toBe(1);
		old.currency.dispose(); next.currency.dispose();
	});
	it('captures the engine for compound TeX overrides without switching active bindings', () => {
		const old = context(), value = old.currency.math.evaluate('unit("1.23456789$")/h') as Unit;
		const next = context(); activateMathRuntime(next.currency.math);
		const parse = jest.spyOn(old.currency.math, 'parse');
		const formatted = old.formatter.format(value, { decimalPlaces: 3 });
		expect(formatted.text).toBe('1.235 USD / h');
		expect(formatted.canonical).toBe('1.235 USD / h');
		expect(parse).toHaveBeenCalled();
		expect(getMathRuntime()).toBe(next.currency.math);
		expect(value.toNumber('USD/h')).toBe(1.23456789);
		old.currency.dispose(); next.currency.dispose();
	});
	it('uses the captured engine for ordinary legacy TeX conversion after remapping', () => {
		const old = context(), value = old.currency.math.evaluate('unit("1.23456789$")/h');
		const settings = createDefaultSettings(); settings.dollarSymbolCurrency.currency = 'CAD';
		const next = context(settings); activateMathRuntime(next.currency.math);
		const oldParse = jest.spyOn(old.currency.math, 'parse');
		const activeParse = jest.spyOn(next.currency.math, 'parse');
		const formatted = old.formatter.format(value);
		expect(formatted.canonical).toBe('1.23456789 USD / h');
		expect(formatted.tex).toContain('USD');
		expect(oldParse).toHaveBeenCalled();
		expect(activeParse).not.toHaveBeenCalled();
		expect(getMathRuntime()).toBe(next.currency.math);
		old.currency.dispose(); next.currency.dispose();
	});
	it('rejects a registry from another engine', () => {
		const first = context(), second = context();
		expect(() => createResultFormatter({ currencies: first.registry, runtime: second.currency.math, profile: createNumberFormatProfile(NumeralsNumberFormat.Fixed) })).toThrow('same mathjs runtime');
		first.currency.dispose(); second.currency.dispose();
	});
	it('keeps compound code policy independent of pure symbol preference', () => {
		const settings = createDefaultSettings(), symbols = context(settings);
		settings.currencyDisplayMode = CurrencyDisplayMode.Code; const codes = context(settings);
		for (const current of [symbols, codes]) {
			const value = current.currency.math.evaluate('unit("-1.23456789$")/h');
			expect(current.formatter.format(value).canonical).toBe('-1.23456789 USD / h');
			current.currency.dispose();
		}
	});
});
