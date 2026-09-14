jest.mock('obsidian', () => ({
	loadMathJax: jest.fn().mockResolvedValue(undefined),
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
	renderMath: jest.fn((tex: string) => {
		const span = document.createElement('span');
		span.textContent = `TeX:${tex}`;
		return span;
	}),
	sanitizeHTMLToDom: jest.fn((html: string) => {
		const fragment = document.createDocumentFragment();
		const div = document.createElement('div');
		div.innerHTML = html;
		fragment.appendChild(div);
		return fragment;
	}),
}), { virtual: true });

import type { Unit } from 'mathjs';
import { getMathRuntime } from '../src/mathRuntime';
const math = getMathRuntime();
import {
	CurrencyDisplayMode,
	CurrencyPrecisionMode,
	DEFAULT_SETTINGS,
	NumeralsNumberFormat,
	NumeralsRenderStyle,
	type CurrencyType,
	type LineRenderData,
	type RenderContext,
} from '../src/numerals.types';
import {
	createNumberFormatProfile,
	createResultFormatter,
	CurrencyRegistry,
	type ResultFormatOverrides,
	type ResultFormatter,
} from '../src/formatting';
import { PlainRenderer, TeXRenderer } from '../src/renderers';

const activeCurrencies: CurrencyType[] = [
	{ symbol: '$', unicode: 'x024', name: 'dollar', currency: 'USD' },
	{ symbol: '£', unicode: 'x00A3', name: 'pound', currency: 'GBP' },
	{ symbol: '¥', unicode: 'x00A5', name: 'yen', currency: 'JPY' },
	{ symbol: 'د.ك', unicode: 'x0000', name: 'dinar', currency: 'KWD' },
	{ symbol: '¤', unicode: 'x00A4', name: 'custom', currency: 'XCU' },
];

interface FormatterOptions {
	locale?: string;
	format?: NumeralsNumberFormat;
	precisionMode?: CurrencyPrecisionMode;
	displayMode?: CurrencyDisplayMode;
	currencyMap?: CurrencyType[];
	customDigits?: number;
}

function ensureCurrencyUnit(code: string): void {
	try {
		math.createUnit(code, { aliases: [code.toLowerCase()] });
	} catch {
		// mathjs Unit registration is process-global across the Jest worker.
	}
}

function createFormatter(options: FormatterOptions = {}): ResultFormatter {
	const locale = options.locale ?? 'en-US';
	const currencyMap = options.currencyMap ?? activeCurrencies;
	const fractionDigitsByCode = new Map<string, number>();
	if (options.customDigits !== undefined) {
		fractionDigitsByCode.set('XCU', options.customDigits);
	}

	return createResultFormatter({
		profile: createNumberFormatProfile(
			options.format ?? NumeralsNumberFormat.System,
			locale,
		),
		currencies: CurrencyRegistry.create(currencyMap, {
			locale,
			fractionDigitsByCode,
		}),
		currencyPrecisionMode: options.precisionMode ??
			DEFAULT_SETTINGS.currencyPrecisionMode,
		currencyDisplayMode: options.displayMode ?? CurrencyDisplayMode.Code,
	});
}

function currency(value: number, code: string): Unit {
	return math.unit(value, code);
}

beforeAll(() => {
	for (const { currency: code } of activeCurrencies) {
		ensureCurrencyUnit(code);
	}
	ensureCurrencyUnit('CAD');

	Object.defineProperty(HTMLElement.prototype, 'createEl', {
		configurable: true,
		value: function(
			this: HTMLElement,
			tag: string,
			options?: { cls?: string | string[]; text?: string },
		): HTMLElement {
			const element = document.createElement(tag);
			if (options?.cls) {
				const classes = Array.isArray(options.cls)
					? options.cls
					: [options.cls];
				element.classList.add(...classes);
			}
			if (options?.text !== undefined) {
				element.textContent = options.text;
			}
			this.appendChild(element);
			return element;
		},
	});

	Object.defineProperty(HTMLElement.prototype, 'toggleClass', {
		configurable: true,
		value: function(this: HTMLElement, className: string, enabled: boolean) {
			this.classList.toggle(className, enabled);
		},
	});

	Object.defineProperty(HTMLElement.prototype, 'setText', {
		configurable: true,
		value: function(this: HTMLElement, text: string) {
			this.textContent = text;
		},
	});
});

describe('currency formatting compatibility matrix', () => {
	it('uses currency-standard precision and symbol display by default', () => {
		const profile = createNumberFormatProfile(
			NumeralsNumberFormat.System,
			'en-US',
		);
		const formatter = createResultFormatter({
			profile,
			currencies: CurrencyRegistry.create(activeCurrencies, {
				locale: 'en-US',
			}),
		});

		expect(DEFAULT_SETTINGS.currencyPrecisionMode).toBe(
			CurrencyPrecisionMode.CurrencyStandard,
		);
		expect(DEFAULT_SETTINGS.currencyDisplayMode).toBe(CurrencyDisplayMode.Symbol);
		expect(formatter.format(currency(120, 'GBP'))).toEqual({
			text: '£120.00',
			tex: '\\unicode{x00A3} 120.00',
			canonical: '120.00 GBP',
		});
	});

	it.each([
		['GBP', 1234.5, '1,234.50 GBP', '1234.50~\\mathrm{GBP}', '1234.50 GBP'],
		['USD', 1234.5, '1,234.50 USD', '1234.50~\\mathrm{USD}', '1234.50 USD'],
		['JPY', 1234.5, '1,235 JPY', '1235~\\mathrm{JPY}', '1235 JPY'],
		['KWD', 1234.5, '1,234.500 KWD', '1234.500~\\mathrm{KWD}', '1234.500 KWD'],
	])(
		'uses currency-standard precision across all output forms for %s',
		(code, amount, text, tex, canonical) => {
			const formatter = createFormatter({
				precisionMode: CurrencyPrecisionMode.CurrencyStandard,
				displayMode: CurrencyDisplayMode.Code,
			});

			expect(formatter.format(currency(amount, code))).toEqual({
				text,
				tex,
				canonical,
			});
		},
	);

	it('threads the custom-currency decimal setting through the registry', () => {
		const settings = {
			...DEFAULT_SETTINGS,
			currencyPrecisionMode: CurrencyPrecisionMode.CurrencyStandard,
			customCurrencyDecimalPlaces: 4,
		};
		const formatter = createFormatter({
			precisionMode: settings.currencyPrecisionMode,
			customDigits: settings.customCurrencyDecimalPlaces,
		});

		expect(formatter.format(currency(1.2, 'XCU'))).toEqual({
			text: '1.2000 XCU',
			tex: '1.2000~\\mathrm{XCU}',
			canonical: '1.2000 XCU',
		});
	});

	it('uses the configured symbol for a remapped dollar without changing canonical code', () => {
		const remappedDollar: CurrencyType[] = [{
			symbol: '$',
			unicode: 'x024',
			name: 'dollar',
			currency: 'CAD',
		}];
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
			currencyMap: remappedDollar,
		});
		const formatted = formatter.format(currency(1234.5, 'CAD'));

		expect(formatted.text).toBe('$1,234.50');
		expect(formatted.text).not.toContain('CA$');
		expect(formatted.tex).toBe('\\unicode{x0024} 1234.50');
		expect(formatted.canonical).toBe('1234.50 CAD');
	});
});

describe('currency formatting policy precedence', () => {
	it('gives an explicit decimal override precedence over JPY standard digits', () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
		});

		expect(formatter.format(currency(1234.5, 'JPY'), {
			decimalPlaces: 3,
		})).toEqual({
			text: '1,234.500 JPY',
			tex: '1234.500~\\mathrm{JPY}',
			canonical: '1234.500 JPY',
		});
	});

	it('composes @format locale selection with standard currency precision', () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
		});
		const overrides: ResultFormatOverrides = {
			numberFormat: NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal,
		};
		const formatted = formatter.format(currency(1234.5, 'GBP'), overrides);

		expect(formatted.text).toBe('1.234,50\u00a0£');
		expect(formatted.tex).toBe('\\unicode{x00A3} 1234.50');
		expect(formatted.canonical).toBe('1234.50 GBP');
	});

	it('preserves @format notation while currency precision controls coefficient digits', () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
		});
		const formatted = formatter.format(currency(1250, 'GBP'), {
			numberFormat: NumeralsNumberFormat.Exponential,
		});

		expect(formatted.text).toBe('1.25e+3 GBP');
		expect(formatted.tex).toBe('1.25 \\times 10^{3}~\\mathrm{GBP}');
		expect(formatted.canonical).toBe('1.25e+3 GBP');
	});

	it('formats pure derived currency but leaves compound currency on the profile', () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
		});
		const remaining = currency(80, 'GBP');
		const derived = math.divide(remaining, 8) as Unit;
		const compound = math.divide(
			currency(0.00416, 'GBP'),
			math.unit(1, 'hour'),
		) as Unit;

		expect(formatter.format(derived)).toEqual({
			text: '£10.00',
			tex: '\\unicode{x00A3} 10.00',
			canonical: '10.00 GBP',
		});
		expect(formatter.format(compound).text).toBe('0.004 GBP / hour');
		expect(formatter.format(compound).text).not.toContain('£');
		expect(derived.toNumber('GBP')).toBe(10);
	});

	it('rounds a negative midpoint consistently without mutating the Unit', () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
		});
		const value = currency(-1.255, 'GBP');
		const before = value.toNumber('GBP');

		expect(formatter.format(value)).toEqual({
			text: '-£1.26',
			tex: '-\\unicode{x00A3} 1.26',
			canonical: '-1.26 GBP',
		});
		expect(value.toNumber('GBP')).toBe(before);
	});
});

describe('localized currency text with stable TeX and canonical output', () => {
	it.each([
		['en-US', '£1,234.50'],
		['fr-FR', '1\u202f234,50\u00a0£'],
		['ar-EG', '\u200f١٬٢٣٤٫٥٠\u00a0£'],
	])('preserves locale digits, spacing, and bidi marks for %s', (locale, expectedText) => {
		const formatter = createFormatter({
			locale,
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
		});
		const formatted = formatter.format(currency(1234.5, 'GBP'));

		expect(formatted.text).toBe(expectedText);
		expect(formatted.tex).toBe('\\unicode{x00A3} 1234.50');
		expect(formatted.canonical).toBe('1234.50 GBP');
	});
});

describe('formatter consumers', () => {
	it('keeps Plain and TeX block consumers on the same formatted result', async () => {
		const formatter = createFormatter({
			precisionMode: CurrencyPrecisionMode.CurrencyStandard,
			displayMode: CurrencyDisplayMode.Symbol,
		});
		const value = currency(1234.5, 'GBP');
		const formatted = formatter.format(value);
		const lineData: LineRenderData = {
			index: 0,
			rawInput: 'total = 1234.5 GBP',
			processedInput: 'total = 1234.5 GBP',
			formattedResult: formatted,
			isEmpty: false,
			isEmitter: false,
			isHidden: false,
			comment: null,
		};
		const context: RenderContext = {
			renderStyle: NumeralsRenderStyle.Plain,
			settings: DEFAULT_SETTINGS,
			signal: new AbortController().signal,
		};
		const plainContainer = document.createElement('div');
		const texContainer = document.createElement('div');

		new PlainRenderer().renderLine(plainContainer, lineData, context);
		new TeXRenderer().renderLine(texContainer, lineData, {
			...context,
			renderStyle: NumeralsRenderStyle.TeX,
		});
		await Promise.resolve(); await Promise.resolve();

		expect(plainContainer.querySelector('.numerals-result')?.textContent)
			.toBe(`${DEFAULT_SETTINGS.resultSeparator}${formatted.text}`);
		expect(texContainer.querySelector('.numerals-result')?.textContent)
			.toBe(`TeX:${formatted.tex}`);
	});
});
