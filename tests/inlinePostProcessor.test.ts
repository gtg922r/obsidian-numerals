/**
 * Integration tests for the inline Numerals post-processor.
 *
 * Tests the full pipeline: trigger detection → evaluation → DOM rendering.
 */

jest.mock("obsidian", () => ({
	MarkdownRenderChild: class {},
}), { virtual: true });
jest.mock(
	"obsidian-dataview",
	() => ({ getAPI: () => undefined }),
	{ virtual: true }
);

import * as math from 'mathjs';
import { defaultCurrencyMap } from '../src/rendering/displayUtils';
import {
	NumeralsSettings,
	NumeralsScope,
	DEFAULT_SETTINGS,
	StringReplaceMap,
} from '../src/numerals.types';
import { parseInlineExpression } from '../src/inline/inlineParser';
import { evaluateInlineExpression } from '../src/inline/inlineEvaluator';

// ---------------------------------------------------------------------------
// Setup currency (same as other test files)
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
		} catch { /* already exists */ }
	}
}

// ---------------------------------------------------------------------------
// Helper: simulate the full inline pipeline (parse → evaluate → format)
// ---------------------------------------------------------------------------
function simulateInlinePipeline(
	inlineText: string,
	scope: NumeralsScope = new NumeralsScope(),
	settings: NumeralsSettings = DEFAULT_SETTINGS
): { mode: string; expression: string; result: string } | null {
	const parsed = parseInlineExpression(
		inlineText,
		settings.inlineResultTrigger,
		settings.inlineEquationTrigger
	);
	if (!parsed) return null;

	const result = evaluateInlineExpression(
		parsed.expression,
		scope,
		undefined,
		preProcessors
	);

	return { mode: parsed.mode, expression: parsed.expression, result };
}

// ---------------------------------------------------------------------------
// Integration: Full Pipeline Tests
// ---------------------------------------------------------------------------
describe('inline numerals integration', () => {

	describe('result-only mode', () => {
		it('should evaluate "#: 3ft in inches" to a result containing "36"', () => {
			const output = simulateInlinePipeline('#: 3ft in inches');
			expect(output).not.toBeNull();
			expect(output!.mode).toBe('ResultOnly');
			expect(output!.result).toContain('36');
		});

		it('should evaluate "#: $36.03 + $2*3 + $pizza" with scope', () => {
			const scope = new NumeralsScope();
			scope.set('$pizza', math.evaluate('10 USD'));
			const output = simulateInlinePipeline('#: $36.03 + $2*3 + $pizza', scope);
			expect(output).not.toBeNull();
			expect(output!.result).toContain('52.03');
		});
	});

	describe('equation mode', () => {
		it('should evaluate "#=: 3ft + 2ft" and preserve expression', () => {
			const output = simulateInlinePipeline('#=: 3ft + 2ft');
			expect(output).not.toBeNull();
			expect(output!.mode).toBe('Equation');
			expect(output!.expression).toBe('3ft + 2ft');
			expect(output!.result).toContain('5');
		});

		it('should evaluate "#=: sqrt(144)" correctly', () => {
			const output = simulateInlinePipeline('#=: sqrt(144)');
			expect(output).not.toBeNull();
			expect(output!.result).toBe('12');
		});
	});

	describe('scope isolation', () => {
		it('should not mutate the shared scope', () => {
			const scope = new NumeralsScope();
			scope.set('x', 10);

			// This expression assigns y = x + 5 in mathjs
			simulateInlinePipeline('#: y = x + 5', scope);

			// y should NOT leak into the original scope
			expect(scope.has('y')).toBe(false);
			// x should still be 10
			expect(scope.get('x')).toBe(10);
		});
	});

	describe('non-numerals code is untouched', () => {
		it('should return null for regular inline code', () => {
			expect(simulateInlinePipeline('const x = 5')).toBeNull();
			expect(simulateInlinePipeline('npm install')).toBeNull();
			expect(simulateInlinePipeline('')).toBeNull();
		});
	});

	describe('error handling', () => {
		it('should throw on invalid expression', () => {
			const parsed = parseInlineExpression('#: @@invalid@@', '#:', '#=:');
			expect(parsed).not.toBeNull();
			expect(() => {
				evaluateInlineExpression(parsed!.expression, new NumeralsScope(), undefined, []);
			}).toThrow();
		});
	});
});
