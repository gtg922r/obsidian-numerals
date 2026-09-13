import type { Unit } from 'mathjs';
import { getMathRuntime } from '../src/mathRuntime';
const math = getMathRuntime();
import { CurrencyRegistry } from '../src/formatting/currencyRegistry';
import type { CurrencyType } from '../src/numerals.types';

function ensureCurrencyUnit(code: string): void {
	try {
		math.createUnit(code, { aliases: [code.toLowerCase()] });
	} catch {
		// mathjs units are global and may have been created by another suite.
	}
}

const currencyMap: CurrencyType[] = [
	{ symbol: '£', unicode: 'x00A3', name: 'pound', currency: 'GBP' },
	{ symbol: '¥', unicode: 'x00A5', name: 'yen', currency: 'JPY' },
	{ symbol: 'د.ك', unicode: 'x0000', name: 'dinar', currency: 'KWD' },
];

describe('CurrencyRegistry', () => {
	beforeAll(() => {
		for (const { currency } of currencyMap) {
			ensureCurrencyUnit(currency);
		}
	});

	it('clones and freezes active definitions', () => {
		const mutableMap = currencyMap.map(entry => ({ ...entry }));
		const registry = CurrencyRegistry.create(mutableMap, { locale: 'en-US' });

		mutableMap[0].symbol = 'changed';
		mutableMap[0].currency = 'CHANGED';

		expect(registry.get('GBP')?.symbol).toBe('£');
		expect(registry.get('CHANGED')).toBeUndefined();
		expect(Object.isFrozen(registry.definitions)).toBe(true);
		expect(Object.isFrozen(registry.get('GBP'))).toBe(true);
	});

	it('gets standard minor-unit digits and honors a configured override', () => {
		const registry = CurrencyRegistry.create(currencyMap, {
			locale: 'en-US',
			fractionDigitsByCode: new Map([['GBP', 4]]),
		});

		expect(registry.get('GBP')?.fractionDigits).toBe(4);
		expect(registry.get('JPY')?.fractionDigits).toBe(0);
		expect(registry.get('KWD')?.fractionDigits).toBe(3);
	});

	it.each([-1, 1.5, 21])(
		'ignores invalid configured fraction digit value %s',
		(configuredDigits) => {
			const registry = CurrencyRegistry.create(currencyMap, {
				locale: 'en-US',
				fractionDigitsByCode: new Map([['GBP', configuredDigits]]),
			});

			expect(registry.get('GBP')?.fractionDigits).toBe(2);
		}
	);

	it('matches scalar-derived currency through public Unit APIs', () => {
		const registry = CurrencyRegistry.create(currencyMap);
		const remaining = math.unit(80, 'GBP');
		const derived = math.divide(remaining, 8) as Unit;
		const equalBase = jest.spyOn(derived, 'equalBase');
		const toNumber = jest.spyOn(derived, 'toNumber');
		const before = derived.toString();

		const match = registry.match(derived);

		expect(match?.definition.code).toBe('GBP');
		expect(match?.amount).toBe(10);
		expect(equalBase).toHaveBeenCalled();
		expect(toNumber).toHaveBeenCalledWith('GBP');
		expect(derived.toString()).toBe(before);
	});

	it('does not classify compound currency rates as pure currency', () => {
		const registry = CurrencyRegistry.create(currencyMap);
		const rate = math.divide(
			math.unit(80, 'GBP'),
			math.unit(2, 'hour')
		) as Unit;

		expect(registry.match(rate)).toBeUndefined();
	});

	it('ignores non-Unit results and inactive unit definitions', () => {
		const registry = CurrencyRegistry.create([
			...currencyMap,
			{ symbol: '¤', unicode: 'x00A4', name: 'missing', currency: 'NOT_CREATED' },
		]);

		expect(registry.match(12)).toBeUndefined();
		expect(registry.get('NOT_CREATED')).toBeUndefined();
	});
});
