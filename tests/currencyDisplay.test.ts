/**
 * Unit tests for currency-aware display formatting (displayUtils).
 *
 * Covers pure-currency detection, Intl minor-unit resolution, symbol and
 * code display modes, negatives, locale decimal separators, grouping,
 * compound-unit passthrough, tiny values, and the hasExplicitFormat override.
 */

jest.mock('obsidian', () => ({
	finishRenderMath: jest.fn(),
	renderMath: jest.fn(),
	sanitizeHTMLToDom: jest.fn(),
}), { virtual: true });

import * as math from 'mathjs';
import {
	formatNumeralsResult,
	formatPureCurrencyTeX,
	getPureCurrencyInfo,
	getCurrencyMinorUnits,
	getLocaleFormatter,
	defaultCurrencyMap,
} from '../src/rendering/displayUtils';
import { CurrencyResultDisplay, NumeralsDisplayContext, mathjsFormat } from '../src/numerals.types';
import { makeDisplayContext } from './testHelpers';

// ---------------------------------------------------------------------------
// Currency unit setup (mirrors the plugin's onload createUnit loop)
// ---------------------------------------------------------------------------
for (const moneyType of defaultCurrencyMap) {
	if (moneyType.currency !== '') {
		try {
			math.createUnit(moneyType.currency, {
				aliases: [moneyType.currency.toLowerCase(), moneyType.symbol],
			});
		} catch {
			/* unit already exists */
		}
	}
}

const symbolContext = (numberFormat?: mathjsFormat): NumeralsDisplayContext =>
	makeDisplayContext({ numberFormat, currencyDisplay: CurrencyResultDisplay.Symbol });
const codeContext = (numberFormat?: mathjsFormat): NumeralsDisplayContext =>
	makeDisplayContext({ numberFormat, currencyDisplay: CurrencyResultDisplay.CurrencyCode });

const value = (expr: string): unknown => math.evaluate(expr);

// ---------------------------------------------------------------------------
// getCurrencyMinorUnits
// ---------------------------------------------------------------------------
describe('getCurrencyMinorUnits', () => {
	it('resolves standard currencies to 2 minor units', () => {
		expect(getCurrencyMinorUnits('USD')).toBe(2);
		expect(getCurrencyMinorUnits('GBP')).toBe(2);
		expect(getCurrencyMinorUnits('EUR')).toBe(2);
		expect(getCurrencyMinorUnits('INR')).toBe(2);
	});

	it('resolves JPY to 0 minor units', () => {
		expect(getCurrencyMinorUnits('JPY')).toBe(0);
	});

	it('falls back to 2 for unknown/custom codes', () => {
		expect(getCurrencyMinorUnits('XYZ')).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// getPureCurrencyInfo
// ---------------------------------------------------------------------------
describe('getPureCurrencyInfo', () => {
	it('detects a pure currency unit', () => {
		expect(getPureCurrencyInfo(value('100 USD'), defaultCurrencyMap))
			.toEqual({ code: 'USD', symbol: '$', unitName: 'USD' });
	});

	it('detects a lowercase-alias unit and returns the canonical code', () => {
		expect(getPureCurrencyInfo(value('100 usd'), defaultCurrencyMap))
			.toEqual({ code: 'USD', symbol: '$', unitName: 'usd' });
	});

	it('returns null for compound currency units', () => {
		expect(getPureCurrencyInfo(value('100 USD / hr'), defaultCurrencyMap)).toBeNull();
	});

	it('returns null for non-currency units', () => {
		expect(getPureCurrencyInfo(value('3 ft'), defaultCurrencyMap)).toBeNull();
	});

	it('returns null for plain numbers', () => {
		expect(getPureCurrencyInfo(120, defaultCurrencyMap)).toBeNull();
	});

	it('returns null for a currency unit with a null value', () => {
		// `USD` on its own is a valueless unit
		expect(getPureCurrencyInfo(value('USD'), defaultCurrencyMap)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// formatNumeralsResult — symbol mode
// ---------------------------------------------------------------------------
describe('formatNumeralsResult (symbol mode)', () => {
	it('pads whole values to conventional decimals: $120 → $120.00', () => {
		expect(formatNumeralsResult(value('120 USD'), symbolContext())).toBe('$120.00');
	});

	it('pads single-decimal values: $120.1 → $120.10', () => {
		expect(formatNumeralsResult(value('120.1 USD'), symbolContext())).toBe('$120.10');
	});

	it('rounds to conventional decimals: $120.3499 → $120.35', () => {
		expect(formatNumeralsResult(value('120.3499 USD'), symbolContext())).toBe('$120.35');
	});

	it('formats GBP division: 100 GBP / 3 → £33.33', () => {
		expect(formatNumeralsResult(value('100 GBP / 3'), symbolContext())).toBe('£33.33');
	});

	it('keeps the sign outside the symbol for negatives: -£33.33', () => {
		expect(formatNumeralsResult(value('-100 GBP / 3'), symbolContext())).toBe('-£33.33');
	});

	it('uses 0 minor units for JPY with grouping: ¥1234 → ¥1,234', () => {
		const ctx = symbolContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('1234 JPY'), ctx)).toBe('¥1,234');
	});

	it('groups large values: 1000000 USD → $1,000,000.00', () => {
		const ctx = symbolContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('1000000 USD'), ctx)).toBe('$1,000,000.00');
	});

	it('respects a locale decimal separator: de-DE €120 → €120,00', () => {
		const ctx = symbolContext(getLocaleFormatter('de-DE'));
		expect(formatNumeralsResult(value('120 EUR'), ctx)).toBe('€120,00');
	});

	it('formats tiny values to $0.00', () => {
		expect(formatNumeralsResult(value('0.0001 USD'), symbolContext())).toBe('$0.00');
	});

	it('rounds negative half-boundary values away from zero (locale format)', () => {
		// Regression: Math.round breaks ties toward +∞, which under-rounded
		// negative currency values at the half-minor-unit boundary.
		const ctx = symbolContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('-5.35 USD / 2'), ctx)).toBe('-$2.68');
		expect(formatNumeralsResult(value('-5.005 USD'), ctx)).toBe('-$5.01');
		expect(formatNumeralsResult(value('-120.345 USD'), ctx)).toBe('-$120.35');
		expect(formatNumeralsResult(value('-10.01 USD / 2'), ctx)).toBe('-$5.01');
	});

	it('rounds negative half-boundary values away from zero (fixed format)', () => {
		expect(formatNumeralsResult(value('-5.35 USD / 2'), symbolContext())).toBe('-$2.68');
		expect(formatNumeralsResult(value('-120.345 USD'), symbolContext())).toBe('-$120.35');
	});

	it('shows no stray minus when a negative value rounds to zero', () => {
		expect(formatNumeralsResult(value('-0.0001 USD'), symbolContext())).toBe('$0.00');
		const ctx = symbolContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('-0.0001 USD'), ctx)).toBe('$0.00');
		expect(formatNumeralsResult(value('-0 USD'), ctx)).toBe('$0.00');
	});

	it('formats lowercase-alias units with the symbol: 100 usd → $100.00', () => {
		expect(formatNumeralsResult(value('100 usd'), symbolContext())).toBe('$100.00');
		expect(formatNumeralsResult(value('100 USD to usd'), symbolContext())).toBe('$100.00');
	});
});

// ---------------------------------------------------------------------------
// formatNumeralsResult — code mode
// ---------------------------------------------------------------------------
describe('formatNumeralsResult (code mode)', () => {
	it('renders the ISO code with conventional decimals: 120 USD', () => {
		expect(formatNumeralsResult(value('120 USD'), codeContext())).toBe('120.00 USD');
	});

	it('uses 0 minor units for JPY in code mode: 1234 JPY', () => {
		const ctx = codeContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('1234 JPY'), ctx)).toBe('1,234 JPY');
	});

	it('groups large values in code mode: 1,000,000.00 USD', () => {
		const ctx = codeContext(getLocaleFormatter('en-US'));
		expect(formatNumeralsResult(value('1000000 USD'), ctx)).toBe('1,000,000.00 USD');
	});

	it('renders lowercase-alias units with the canonical code: 100 usd → 100.00 USD', () => {
		expect(formatNumeralsResult(value('100 usd'), codeContext())).toBe('100.00 USD');
		expect(formatNumeralsResult(value('100 USD to usd'), codeContext())).toBe('100.00 USD');
	});
});

// ---------------------------------------------------------------------------
// Passthrough / non-currency
// ---------------------------------------------------------------------------
describe('formatNumeralsResult (non-currency passthrough)', () => {
	it('leaves compound currency rates on existing formatting: $100/hr', () => {
		expect(formatNumeralsResult(value('100 USD / hr'), symbolContext())).toBe('100 USD / hr');
	});

	it('leaves plain numbers unchanged', () => {
		expect(formatNumeralsResult(120, symbolContext())).toBe('120');
	});

	it('leaves non-currency units unchanged', () => {
		expect(formatNumeralsResult(value('3 ft'), symbolContext())).toBe('3 ft');
	});

	it('formats a valueless currency unit with mathjs defaults', () => {
		expect(formatNumeralsResult(value('USD'), symbolContext())).toBe('USD');
	});
});

// ---------------------------------------------------------------------------
// hasExplicitFormat override (PR B compatibility)
// ---------------------------------------------------------------------------
describe('formatNumeralsResult (hasExplicitFormat)', () => {
	it('suppresses convention decimals but keeps symbol display', () => {
		const ctx = makeDisplayContext({
			numberFormat: { notation: 'fixed', precision: 4 },
			hasExplicitFormat: true,
			currencyDisplay: CurrencyResultDisplay.Symbol,
		});
		expect(formatNumeralsResult(value('100 USD / 3'), ctx)).toBe('$33.3333');
	});

	it('suppresses convention decimals in code mode too', () => {
		const ctx = makeDisplayContext({
			numberFormat: { notation: 'fixed', precision: 4 },
			hasExplicitFormat: true,
			currencyDisplay: CurrencyResultDisplay.CurrencyCode,
		});
		expect(formatNumeralsResult(value('100 USD / 3'), ctx)).toBe('33.3333 USD');
	});
});

// ---------------------------------------------------------------------------
// formatPureCurrencyTeX
// ---------------------------------------------------------------------------
describe('formatPureCurrencyTeX', () => {
	it('builds symbol-mode TeX: \\pound 12.50', () => {
		expect(formatPureCurrencyTeX(value('12.5 GBP'), symbolContext())).toBe('\\pound 12.50');
	});

	it('keeps the sign outside the symbol: -\\pound 12.50', () => {
		expect(formatPureCurrencyTeX(value('-12.5 GBP'), symbolContext())).toBe('-\\pound 12.50');
	});

	it('builds code-mode TeX: 12.50~\\mathrm{GBP}', () => {
		expect(formatPureCurrencyTeX(value('12.5 GBP'), codeContext())).toBe('12.50~\\mathrm{GBP}');
	});

	it('uses no grouping in the numeric part (TeX path constraint)', () => {
		const ctx = symbolContext(getLocaleFormatter('en-US'));
		expect(formatPureCurrencyTeX(value('1000000 USD'), ctx)).toBe('\\dollar 1000000.00');
	});

	it('renders lowercase-alias units with the canonical code in TeX', () => {
		const ctx = codeContext();
		expect(formatPureCurrencyTeX(value('100 usd'), ctx)).toBe('100.00~\\mathrm{USD}');
	});

	it('returns null for non-currency values', () => {
		expect(formatPureCurrencyTeX(value('3 ft'), symbolContext())).toBeNull();
	});
});
