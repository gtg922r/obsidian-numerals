jest.mock('obsidian', () => ({
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
	renderMath: jest.fn(),
	sanitizeHTMLToDom: jest.fn(),
}));

import { getMathRuntime } from '../src/mathRuntime';
const math = getMathRuntime();
import { NumeralsNumberFormat } from '../src/numerals.types';
import {
	createNumberFormatProfile,
	formatNumberWithProfile,
	formatWithNumberFormatProfile,
	isValidDecimalPlaces,
	resolveNumberFormatProfile,
} from '../src/formatting/numberFormat';

describe('number format profiles', () => {
	it('preserves legacy output when no explicit decimal override is present', () => {
		const value = 123456.789;
		const formats = Object.values(NumeralsNumberFormat);

		for (const format of formats) {
			const profile = createNumberFormatProfile(format, 'en-US');
			expect(formatWithNumberFormatProfile(value, profile)).toBe(
				math.format(value, profile.mathjsFormat)
			);
		}
	});

	it('retains both active locale identity and the system locale', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
			'en-GB'
		);

		expect(profile.locale).toBe('de-DE');
		expect(profile.systemLocale).toBe('en-GB');

		const systemOverride = resolveNumberFormatProfile(profile, {
			numberFormat: NumeralsNumberFormat.System,
		});
		expect(systemOverride.locale).toBe('en-GB');
		expect(systemOverride.systemLocale).toBe('en-GB');
	});

	it.each([
		[
			NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal,
			'1,234.50',
		],
		[
			NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
			'1.234,50',
		],
		[
			NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal,
			'1\u202f234,50',
		],
		[NumeralsNumberFormat.Format_Indian, '1,234.50'],
		[NumeralsNumberFormat.Fixed, '1234.50'],
	])('formats exact decimal places without losing profile identity for %s', (
		format,
		expected
	) => {
		const profile = createNumberFormatProfile(format, 'en-US');
		expect(formatWithNumberFormatProfile(1234.5, profile, 2)).toBe(expected);
	});

	it('keeps exponential notation while applying exact coefficient decimals', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Exponential,
			'en-US'
		);

		expect(formatNumberWithProfile(1234.5, profile, 2)).toBe('1.23e+3');
		expect(formatWithNumberFormatProfile(1234.5, profile, 2)).toBe('1.23e+3');
	});

	it('keeps engineering notation while applying exact coefficient decimals', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.Engineering,
			'en-US'
		);

		expect(formatNumberWithProfile(123456, profile, 2)).toBe('123.46e+3');
		expect(formatNumberWithProfile(0, profile, 2)).toBe('0.00e+0');
		expect(formatNumberWithProfile(999.999, profile, 2)).toBe('1.00e+3');
	});

	it.each([
		[NumeralsNumberFormat.Fixed, '1.01'],
		[NumeralsNumberFormat.Exponential, '1.01e+0'],
		[NumeralsNumberFormat.Engineering, '1.01e+0'],
	])('rounds decimal midpoints consistently for %s notation', (
		format,
		expected
	) => {
		const profile = createNumberFormatProfile(format, 'en-US');

		expect(formatNumberWithProfile(1.005, profile, 2)).toBe(expected);
		expect(formatWithNumberFormatProfile(1.005, profile, 2)).toBe(expected);
	});

	it('rounds negative decimal midpoints consistently', () => {
		const fixed = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);
		const exponential = createNumberFormatProfile(
			NumeralsNumberFormat.Exponential,
			'en-US'
		);

		expect(formatNumberWithProfile(-1.255, fixed, 2)).toBe('-1.26');
		expect(formatNumberWithProfile(-1.255, exponential, 2)).toBe('-1.26e+0');
	});

	it('supports the documented 20-place limit', () => {
		const fixed = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);

		expect(formatNumberWithProfile(1.005, fixed, 20)).toBe(
			'1.00500000000000000000'
		);
	});

	it('formats subnormal numbers without exponent underflow', () => {
		const exponential = createNumberFormatProfile(
			NumeralsNumberFormat.Exponential,
			'en-US'
		);
		const engineering = createNumberFormatProfile(
			NumeralsNumberFormat.Engineering,
			'en-US'
		);

		expect(formatNumberWithProfile(Number.MIN_VALUE, exponential, 2)).toBe(
			'5.00e-324'
		);
		expect(formatNumberWithProfile(Number.MIN_VALUE, engineering, 2)).toBe(
			'5.00e-324'
		);
	});

	it('applies exact decimals and locale profiles to BigNumber values', () => {
		const localized = createNumberFormatProfile(
			NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
			'en-US'
		);
		const exponential = createNumberFormatProfile(
			NumeralsNumberFormat.Exponential,
			'en-US'
		);
		const value = math.bignumber('1234.505');

		expect(formatWithNumberFormatProfile(value, localized, 2)).toBe('1.234,51');
		expect(formatWithNumberFormatProfile(value, exponential, 2)).toBe('1.23e+3');
	});

	it('preserves locale-specific sign and bidi parts for BigNumber values', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'ar-EG'
		);
		const value = math.bignumber('-1234.5');
		const expected = new Intl.NumberFormat('ar-EG', {
			useGrouping: true,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(-1234.5);

		expect(formatWithNumberFormatProfile(value, profile, 2)).toBe(expected);
	});

	it('applies decimal overrides to Fraction values', () => {
		const fixed = createNumberFormatProfile(
			NumeralsNumberFormat.Fixed,
			'en-US'
		);

		expect(formatWithNumberFormatProfile(math.fraction(1, 3), fixed, 2)).toBe(
			'0.33'
		);
	});

	it('accepts only the supported decimal-place range', () => {
		expect(isValidDecimalPlaces(0)).toBe(true);
		expect(isValidDecimalPlaces(20)).toBe(true);
		expect(isValidDecimalPlaces(-1)).toBe(false);
		expect(isValidDecimalPlaces(1.5)).toBe(false);
		expect(isValidDecimalPlaces(21)).toBe(false);
	});
});
