import * as gateway from '../src/mathRuntime';
import * as shared from 'mathjs';
import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { createDefaultSettings } from '../src/settings/normalization';

describe('active mathjs runtime gateway', () => {
	afterEach(() => gateway.resetMathRuntime());
	it('routes existing evaluator calls through the chosen private engine', () => {
		const original = shared.parse.isAlpha;
		const first = createCurrencyRuntime(createDefaultSettings());
		gateway.activateMathRuntime(first.math);
		expect(gateway.evaluate('unit("1$")').toNumber('USD')).toBe(1);
		expect(gateway.parse('det([1,2;3,4])').evaluate()).toBe(-2);
		const settings = createDefaultSettings(); settings.dollarSymbolCurrency.currency = 'CAD';
		const next = createCurrencyRuntime(settings, first);
		gateway.activateMathRuntime(next.math);
		expect(gateway.evaluate('unit("1$")').toNumber('CAD')).toBe(1);
		expect(gateway.unit(1, '$').toNumber('CAD')).toBe(1);
		expect(first.math.evaluate('unit("1$")').toNumber('USD')).toBe(1);
		expect(shared.parse.isAlpha).toBe(original);
		expect(shared.Unit.isValuelessUnit('$')).toBe(false);
		first.dispose(); next.dispose();
	});
	it('resets ad-hoc declarations on runtime replacement without hiding collisions', () => {
		gateway.evaluate('createUnit("widget", "2 m")');
		expect(() => gateway.evaluate('createUnit("widget", "2 m")')).toThrow(/already exists/);
		const runtime = createCurrencyRuntime(createDefaultSettings()); gateway.activateMathRuntime(runtime.math);
		expect(() => gateway.evaluate('1 widget')).toThrow();
		gateway.evaluate('createUnit("widget", "2 m")');
		expect(gateway.evaluate('1 widget').toNumber('m')).toBe(2);
		runtime.dispose();
	});
});
