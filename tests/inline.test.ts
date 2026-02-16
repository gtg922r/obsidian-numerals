/**
 * Unit tests for inline numerals parsing and evaluation.
 * Written TDD-style — the implementation does not yet exist.
 */

jest.mock("obsidian", () => ({}), { virtual: true });
jest.mock(
	"obsidian-dataview",
	() => {
		return {
			getAPI: () => () => {},
		};
	},
	{ virtual: true }
);

import * as math from 'mathjs';
import { defaultCurrencyMap } from '../src/rendering/displayUtils';
import {
	InlineNumeralsMode,
	NumeralsScope,
	StringReplaceMap,
	mathjsFormat,
} from '../src/numerals.types';
import { parseInlineExpression } from '../src/inline/inlineParser';
import { evaluateInlineExpression } from '../src/inline/inlineEvaluator';

// ---------------------------------------------------------------------------
// Currency setup (mirrors numeralsUtilities.test.ts)
// ---------------------------------------------------------------------------
const currencyPreProcessors: StringReplaceMap[] = defaultCurrencyMap.map(m => ({
	regex: RegExp('\\' + m.symbol + '([\\d\\.]+)', 'g'),
	replaceStr: '$1 ' + m.currency,
}));

const preProcessors: StringReplaceMap[] = [
	{ regex: /,(\d{3})/g, replaceStr: '$1' },
	...currencyPreProcessors,
];

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DEFAULT_RESULT_TRIGGER = '=:';
const DEFAULT_EQUATION_TRIGGER = '==:';

function parse(text: string, resultTrigger = DEFAULT_RESULT_TRIGGER, equationTrigger = DEFAULT_EQUATION_TRIGGER) {
	return parseInlineExpression(text, resultTrigger, equationTrigger);
}

// ---------------------------------------------------------------------------
// parseInlineExpression
// ---------------------------------------------------------------------------
describe('parseInlineExpression', () => {

	// --- Trigger matching ---------------------------------------------------
	describe('trigger matching', () => {
		it('should parse result-only trigger "=: 3+2"', () => {
			const result = parse('=: 3+2');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.ResultOnly);
			expect(result!.expression).toBe('3+2');
		});

		it('should parse equation trigger "==: 3+2"', () => {
			const result = parse('==: 3+2');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.Equation);
			expect(result!.expression).toBe('3+2');
		});

		it('should return null for unrecognized text', () => {
			expect(parse('some random code')).toBeNull();
		});

		it('should parse trigger with no space before expression "=:3+2"', () => {
			const result = parse('=:3+2');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.ResultOnly);
			expect(result!.expression).toBe('3+2');
		});

		it('should return null when trigger is followed only by whitespace', () => {
			expect(parse('==: ')).toBeNull();
			expect(parse('=:  ')).toBeNull();
		});

		it('should return null for an empty string', () => {
			expect(parse('')).toBeNull();
		});
	});

	// --- Trigger precedence (critical!) ------------------------------------
	describe('trigger precedence', () => {
		it('should check "==:" before "=:" so "==: 5*3" is Equation mode', () => {
			const result = parse('==: 5*3');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.Equation);
			expect(result!.expression).toBe('5*3');
		});

		it('should NOT mis-parse "==: 5*3" as ResultOnly with leftover "=: 5*3"', () => {
			const result = parse('==: 5*3');
			expect(result!.mode).not.toBe(InlineNumeralsMode.ResultOnly);
		});

		it('should still correctly parse "=: 5*3" as ResultOnly', () => {
			const result = parse('=: 5*3');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.ResultOnly);
			expect(result!.expression).toBe('5*3');
		});
	});

	// --- Whitespace handling ------------------------------------------------
	describe('whitespace handling', () => {
		it('should trim leading and trailing whitespace from the expression', () => {
			const result = parse('=:  3 + 2  ');
			expect(result).not.toBeNull();
			expect(result!.expression).toBe('3 + 2');
		});

		it('should trim expression for equation trigger without space', () => {
			const result = parse('==:3ft in inches');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.Equation);
			expect(result!.expression).toBe('3ft in inches');
		});
	});

	// --- Custom triggers ----------------------------------------------------
	describe('custom triggers', () => {
		it('should match custom result trigger "@$:"', () => {
			const result = parse('@$: 100', '@$:', '@=:');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.ResultOnly);
			expect(result!.expression).toBe('100');
		});

		it('should match custom equation trigger "@=:"', () => {
			const result = parse('@=: 3+2', '@$:', '@=:');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.Equation);
			expect(result!.expression).toBe('3+2');
		});

		it('should match custom triggers "nm:" and "nm=:"', () => {
			const result = parse('nm=: 3+2', 'nm:', 'nm=:');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.Equation);
			expect(result!.expression).toBe('3+2');
		});

		it('should return null when text does not match custom triggers', () => {
			expect(parse('=: 100', '@$:', '@=:')).toBeNull();
		});
	});

	// --- Empty trigger safety -----------------------------------------------
	describe('empty trigger safety', () => {
		it('should ignore empty result trigger', () => {
			// Empty trigger would match everything — must be filtered out
			const result = parse('some code', '', '==:');
			expect(result).toBeNull();
		});

		it('should ignore empty equation trigger', () => {
			const result = parse('some code', '=:', '');
			expect(result).toBeNull();
		});

		it('should still match valid trigger when the other is empty', () => {
			const result = parse('=: 3+2', '=:', '');
			expect(result).not.toBeNull();
			expect(result!.mode).toBe(InlineNumeralsMode.ResultOnly);
		});

		it('should return null when both triggers are empty', () => {
			expect(parse('anything', '', '')).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// evaluateInlineExpression
// ---------------------------------------------------------------------------
describe('evaluateInlineExpression', () => {
	const emptyScope = new NumeralsScope();
	const defaultFormat: mathjsFormat = undefined;
	const noPreProcessors: StringReplaceMap[] = [];

	// --- Basic arithmetic ---------------------------------------------------
	describe('basic arithmetic', () => {
		it('should evaluate "3 + 2" to "5"', () => {
			const result = evaluateInlineExpression('3 + 2', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toBe('5');
		});

		it('should evaluate "10 / 3" with fixed format containing "3.333"', () => {
			const fixedFormat: mathjsFormat = { notation: 'fixed', precision: 4 };
			const result = evaluateInlineExpression('10 / 3', emptyScope, fixedFormat, noPreProcessors);
			expect(result).toContain('3.333');
		});

		it('should evaluate multiplication', () => {
			const result = evaluateInlineExpression('7 * 6', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toBe('42');
		});

		it('should evaluate subtraction', () => {
			const result = evaluateInlineExpression('100 - 37', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toBe('63');
		});

		it('should evaluate exponentiation', () => {
			const result = evaluateInlineExpression('2^10', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toBe('1024');
		});
	});

	// --- Units --------------------------------------------------------------
	describe('units', () => {
		it('should convert "3 ft to inches" and contain "36"', () => {
			const result = evaluateInlineExpression('3 ft to inches', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toContain('36');
		});

		it('should convert "100 km/hr in mi/hr" to approximately 62.137', () => {
			const result = evaluateInlineExpression('100 km/hr in mi/hr', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toMatch(/62\.137/);
		});

		it('should convert "1 kg to lb"', () => {
			const result = evaluateInlineExpression('1 kg to lb', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toContain('2.20');
		});
	});

	// --- Currency ------------------------------------------------------------
	describe('currency', () => {
		it('should evaluate "$100 * 2" and produce result with "200" and "USD"', () => {
			const result = evaluateInlineExpression('$100 * 2', emptyScope, defaultFormat, preProcessors);
			expect(result).toContain('200');
			expect(result).toContain('USD');
		});

		it('should evaluate "€50 + €25" with EUR currency', () => {
			const result = evaluateInlineExpression('€50 + €25', emptyScope, defaultFormat, preProcessors);
			expect(result).toContain('75');
			expect(result).toContain('EUR');
		});
	});

	// --- Scope access --------------------------------------------------------
	describe('scope access', () => {
		it('should access variable from scope: x = 5, evaluate "x * 2" to "10"', () => {
			const scope = new NumeralsScope();
			scope.set('x', 5);
			const result = evaluateInlineExpression('x * 2', scope, defaultFormat, noPreProcessors);
			expect(result).toBe('10');
		});

		it('should access currency variable from scope', () => {
			const scope = new NumeralsScope();
			scope.set('$pizza', math.evaluate('10 USD'));
			const result = evaluateInlineExpression(
				'$36.03 + $2 * 3 + $pizza',
				scope,
				defaultFormat,
				preProcessors
			);
			expect(result).toContain('52.03');
		});

		it('should access multiple variables from scope', () => {
			const scope = new NumeralsScope();
			scope.set('a', 10);
			scope.set('b', 20);
			const result = evaluateInlineExpression('a + b', scope, defaultFormat, noPreProcessors);
			expect(result).toBe('30');
		});

		it('should use scope values that were set by prior evaluations', () => {
			const scope = new NumeralsScope();
			scope.set('totalCost', math.evaluate('250 USD'));
			scope.set('taxRate', 0.08);
			const result = evaluateInlineExpression(
				'totalCost * taxRate',
				scope,
				defaultFormat,
				preProcessors
			);
			expect(result).toContain('20');
			expect(result).toContain('USD');
		});
	});

	// --- Error cases ---------------------------------------------------------
	describe('error cases', () => {
		it('should throw on invalid expression "definitely not math @@@@"', () => {
			expect(() => {
				evaluateInlineExpression('definitely not math @@@@', emptyScope, defaultFormat, noPreProcessors);
			}).toThrow();
		});

		it('should return "Infinity" for "1/0"', () => {
			const result = evaluateInlineExpression('1/0', emptyScope, defaultFormat, noPreProcessors);
			expect(result).toBe('Infinity');
		});

		it('should throw when referencing an undefined variable', () => {
			expect(() => {
				evaluateInlineExpression('undefinedVar * 2', emptyScope, defaultFormat, noPreProcessors);
			}).toThrow();
		});

		it('should throw when expression evaluates to undefined (e.g. comment)', () => {
			expect(() => {
				evaluateInlineExpression('# just a comment', emptyScope, defaultFormat, noPreProcessors);
			}).toThrow('Expression produced no result');
		});
	});

	// --- Preprocessing -------------------------------------------------------
	describe('preprocessing', () => {
		it('should handle thousands separators: "$1,000 * 2" → contains "2000" and "USD"', () => {
			const result = evaluateInlineExpression('$1,000 * 2', emptyScope, defaultFormat, preProcessors);
			expect(result).toContain('2000');
			expect(result).toContain('USD');
		});

		it('should handle multiple thousands separators: "$1,000,000"', () => {
			const result = evaluateInlineExpression('$1,000,000 + $0', emptyScope, defaultFormat, preProcessors);
			// mathjs uses exponential notation for large numbers by default
			expect(result).toMatch(/1e\+6|1000000/);
		});

		it('should apply custom preprocessors', () => {
			const customPreProcessors: StringReplaceMap[] = [
				{ regex: /apples/g, replaceStr: '3' },
			];
			const result = evaluateInlineExpression('apples + 2', emptyScope, defaultFormat, customPreProcessors);
			expect(result).toBe('5');
		});
	});

	// --- Number format -------------------------------------------------------
	describe('number formatting', () => {
		it('should respect exponential notation format', () => {
			const expFormat: mathjsFormat = { notation: 'exponential', precision: 3 };
			const result = evaluateInlineExpression('1234567', emptyScope, expFormat, noPreProcessors);
			expect(result).toMatch(/1\.23.*e\+6/);
		});

		it('should respect engineering notation format', () => {
			const engFormat: mathjsFormat = { notation: 'engineering', precision: 3 };
			const result = evaluateInlineExpression('1234567', emptyScope, engFormat, noPreProcessors);
			expect(result).toMatch(/1\.23.*e\+6/);
		});

		it('should use default format when format is undefined', () => {
			const result = evaluateInlineExpression('2 + 2', emptyScope, undefined, noPreProcessors);
			expect(result).toBe('4');
		});
	});
});
