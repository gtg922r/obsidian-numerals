jest.mock('obsidian', () => ({
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
	renderMath: jest.fn(),
	sanitizeHTMLToDom: jest.fn(),
}));

import type { Unit } from 'mathjs';
import { getMathRuntime } from '../src/mathRuntime';
const math = getMathRuntime();
import {
	CurrencyDisplayMode,
	CurrencyPrecisionMode,
	NumeralsNumberFormat,
} from '../src/numerals.types';
import {
	createNumberFormatProfile,
	createResultFormatter,
	CurrencyRegistry,
} from '../src/formatting';
import type { CurrencyType } from '../src/numerals.types';
import { resultToTeX } from '../src/rendering/texRendering';

describe('ResultFormatter', () => {
	it('preserves the legacy text, TeX, and canonical contracts by default', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal,
			'en-US'
		);
		const formatter = createResultFormatter({ profile, preProcessors: [] });
		const value = 1234.5;

		const formatted = formatter.format(value);

		expect(formatted.text).toBe(math.format(value, profile.mathjsFormat));
		expect(formatted.tex).toBe(resultToTeX(value, []));
		expect(formatted.canonical).toBe(formatted.text);
	});

	it('formats localized text but raw-value TeX for an exact decimal override', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });

		const formatted = formatter.format(1234.5, { decimalPlaces: 2 });

		expect(formatted.text).toBe('1.234,50');
		expect(formatted.tex).toBe('1234.50');
		expect(formatted.canonical).toBe('1.234,50');
	});

	it('applies number-format and decimal overrides together', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });

		const exponential = formatter.format(1234.5, {
			numberFormat: NumeralsNumberFormat.Exponential,
			decimalPlaces: 2,
		});
		const engineering = formatter.format(123456, {
			numberFormat: NumeralsNumberFormat.Engineering,
			decimalPlaces: 2,
		});

		expect(exponential.text).toBe('1.23e+3');
		expect(exponential.tex).toBe('1.23 \\times 10^{3}');
		expect(engineering.text).toBe('123.46e+3');
		expect(engineering.tex).toBe('123.46 \\times 10^{3}');
	});

	it('preserves exact decimal digits in Unit text and TeX', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });
		const value = math.unit(2, 'm');

		const formatted = formatter.format(value, { decimalPlaces: 2 });

		expect(formatted.text).toBe('2.00 m');
		expect(formatted.tex).toBe('2.00~\\mathrm{m}');
		expect(formatted.canonical).toBe('2.00 m');
	});

	it('does not mutate or computationally round a raw Unit value', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });
		const value = math.unit(1 / 3, 'm');
		const beforeText = value.toString();
		const beforeNumber = value.toNumber('m');

		const formatted = formatter.format(value, { decimalPlaces: 2 });

		expect(formatted.text).toBe('0.33 m');
		expect(value.toString()).toBe(beforeText);
		expect(value.toNumber('m')).toBe(beforeNumber);
		expect(value.toNumber('m')).not.toBe(0.33);
	});

	it('preserves arbitrary-precision Unit values in TeX', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });
		const numericValue = math.bignumber('1e400');
		const value = math.unit(numericValue, 'm');

		const formatted = formatter.format(value, { decimalPlaces: 2 });

		expect(formatted.tex).toBe(`${numericValue.toFixed(2)}~\\mathrm{m}`);
		expect(formatted.tex).not.toContain('infty');
	});

	it('preserves decimal padding in collection and complex TeX', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });

		const matrix = formatter.format(math.matrix([[1, 2], [3, 4]]), {
			decimalPlaces: 2,
		});
		const complex = formatter.format(math.complex(1, -2), {
			decimalPlaces: 2,
		});

		expect(matrix.text).toBe('[[1.00, 2.00], [3.00, 4.00]]');
		expect(matrix.tex).toBe(
			'\\begin{bmatrix}1.00&2.00\\\\3.00&4.00\\end{bmatrix}'
		);
		expect(complex.text).toBe('1.00 - 2.00i');
		expect(complex.tex).toBe('1.00 - 2.00~ i');
	});

	it.each([
		[Number.POSITIVE_INFINITY, '\\infty'],
		[Number.NEGATIVE_INFINITY, '-\\infty'],
		[Number.NaN, '\\mathrm{NaN}'],
	])('renders non-finite override value %s as TeX', (value, expected) => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });

		expect(formatter.format(value, { decimalPlaces: 2 }).tex).toBe(expected);
	});

	it('preserves exact TeX digits for BigNumber and Fraction values', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });

		expect(formatter.format(math.bignumber(2), { decimalPlaces: 2 }).tex)
			.toBe('2.00');
		expect(formatter.format(math.fraction(1, 2), { decimalPlaces: 2 }).tex)
			.toBe('0.50');
		expect(formatter.format(math.bignumber(Number.NaN), {
			decimalPlaces: 2,
		}).tex).toBe('\\mathrm{NaN}');
	});

	it('preserves decimal padding in ragged and nested collection TeX', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const formatter = createResultFormatter({ profile });
		const value = [[[1], [2]], [[3, 4]]];

		const formatted = formatter.format(value, { decimalPlaces: 2 });

		expect(formatted.tex).toContain('1.00');
		expect(formatted.tex).toContain('2.00');
		expect(formatted.tex).toContain('3.00');
		expect(formatted.tex).toContain('4.00');
	});
});

const activeCurrencies: CurrencyType[] = [
	{ symbol: '$', unicode: 'x024', name: 'dollar', currency: 'USD' },
	{ symbol: '£', unicode: 'x00A3', name: 'pound', currency: 'GBP' },
	{ symbol: '¥', unicode: 'x00A5', name: 'yen', currency: 'JPY' },
	{ symbol: 'د.ك', unicode: 'x0000', name: 'dinar', currency: 'KWD' },
	{ symbol: '¤', unicode: 'x00A4', name: 'custom', currency: 'XCU' },
];

function ensureCurrencyUnit(code: string): void {
	try {
		math.createUnit(code, { aliases: [code.toLowerCase()] });
	} catch {
		// mathjs units are global and another suite may already have created it.
	}
}

describe('ResultFormatter currency presentation', () => {
	beforeAll(() => {
		for (const { currency } of activeCurrencies) {
			ensureCurrencyUnit(currency);
		}
		ensureCurrencyUnit('CAD');
	});

	function registry(
		currencyMap: CurrencyType[] = activeCurrencies,
		fractionDigitsByCode: ReadonlyMap<string, number> = new Map([
			['XCU', 4],
		])
	): CurrencyRegistry {
		return CurrencyRegistry.create(currencyMap, {
			locale: 'en-US',
			fractionDigitsByCode,
		});
	}

	it('supports rendered-number precision as an explicit compatibility policy', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'en-US'
		);
		const formatter = createResultFormatter({
			profile,
			currencies: registry(),
			currencyDisplayMode: CurrencyDisplayMode.Code,
			currencyPrecisionMode: CurrencyPrecisionMode.FollowNumberFormat,
		});
		const value = math.unit(1234.5, 'GBP');

		const formatted = formatter.format(value);

		expect(formatted.text).toBe(math.format(value, profile.mathjsFormat));
		expect(formatted.tex).toBe(resultToTeX(value, []));
		expect(formatted.canonical).toBe(formatted.text);
	});

	it('normalizes a pure currency alias under the default currency policy', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'en-US'
		);
		const formatter = createResultFormatter({
			profile,
			currencies: registry(),
			currencyDisplayMode: CurrencyDisplayMode.Code,
		});
		const formatted = formatter.format(math.unit(12, 'gbp'));

		expect(formatted.text).toBe('12.00 GBP');
		expect(formatted.canonical).toBe('12.00 GBP');
	});

	it('uses standard currency digits with code-suffix text and canonical output', () => {
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Code,
		});

		const formatted = formatter.format(math.unit(1234.5, 'GBP'));

		expect(formatted.text).toBe('1,234.50 GBP');
		expect(formatted.tex).toBe('1234.50~\\mathrm{GBP}');
		expect(formatted.canonical).toBe('1234.50 GBP');
	});

	it.each([
		['USD', 1234.5, '1,234.50 USD'],
		['JPY', 1234.5, '1,235 JPY'],
		['KWD', 1.2345, '1.235 KWD'],
		['XCU', 1.23454, '1.2345 XCU'],
	])('uses registered standard/custom digits for %s', (code, value, expected) => {
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(),
			currencyDisplayMode: CurrencyDisplayMode.Code,
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
		});

		expect(formatter.format(math.unit(value, code)).text).toBe(expected);
	});

	it('gives @decimalPlaces precedence over currency-standard digits', () => {
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(),
			currencyDisplayMode: CurrencyDisplayMode.Code,
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
		});

		const formatted = formatter.format(math.unit(1.2345, 'GBP'), {
			decimalPlaces: 3,
		});

		expect(formatted.text).toBe('1.235 GBP');
		expect(formatted.tex).toBe('1.235~\\mathrm{GBP}');
		expect(formatted.canonical).toBe('1.235 GBP');
	});

	it('places the configured symbol by locale and keeps canonical code output', () => {
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});

		const formatted = formatter.format(math.unit(1234.5, 'GBP'));

		expect(formatted.text).toBe('£1,234.50');
		expect(formatted.tex).toBe('\\unicode{x00A3} 1234.50');
		expect(formatted.canonical).toBe('1234.50 GBP');
	});

	it('uses locale suffix placement and locale digits without replacing the configured symbol', () => {
		const frenchFormatter = createResultFormatter({
			profile: createNumberFormatProfile(
				NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal,
				'en-US'
			),
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});
		const arabicProfile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'ar-EG'
		);
		const arabicFormatter = createResultFormatter({
			profile: arabicProfile,
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});

		expect(frenchFormatter.format(math.unit(1234.5, 'GBP')).text).toBe(
			'1\u202f234,50\u00a0£'
		);

		const arabic = arabicFormatter.format(math.unit(-1234.5, 'GBP')).text;
		const expectedArabic = new Intl.NumberFormat('ar-EG', {
			style: 'currency',
			currency: 'GBP',
			currencyDisplay: 'symbol',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).formatToParts(-1234.5).map((part) =>
			part.type === 'currency' ? '£' : part.value
		).join('');
		expect(arabic).toBe(expectedArabic);
	});

	it('rounds negative midpoints consistently across symbol, TeX, and canonical output', () => {
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});

		const formatted = formatter.format(math.unit(-1.255, 'GBP'));

		expect(formatted.text).toBe('-£1.26');
		expect(formatted.tex).toBe('-\\unicode{x00A3} 1.26');
		expect(formatted.canonical).toBe('-1.26 GBP');
	});

	it('uses the configured remapped symbol instead of the Intl-selected symbol', () => {
		const remappedMap: CurrencyType[] = [{
			symbol: '$',
			unicode: 'x024',
			name: 'dollar',
			currency: 'CAD',
		}];
		const formatter = createResultFormatter({
			profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			currencies: registry(remappedMap),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});

		const formatted = formatter.format(math.unit(12.5, 'CAD'));

		expect(formatted.text).toBe('$12.50');
		expect(formatted.text).not.toContain('CA$');
		expect(formatted.canonical).toBe('12.50 CAD');
	});

	it('formats scalar-derived currency but leaves compound currency Units general', () => {
		const profile = createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US');
		const formatter = createResultFormatter({
			profile,
			currencies: registry(),
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: CurrencyDisplayMode.Symbol,
		});
		const derived = math.divide(math.unit(10, 'GBP'), 8) as Unit;
		const compound = math.divide(
			math.unit(1.234, 'GBP'),
			math.unit(1, 'hour')
		) as Unit;

		expect(formatter.format(derived).text).toBe('£1.25');
		expect(formatter.format(compound).text).toBe(
			math.format(compound, profile.mathjsFormat)
		);
		expect(formatter.format(compound).text).toContain('GBP / hour');
	});
});
