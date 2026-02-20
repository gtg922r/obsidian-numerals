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

	const { formatted } = evaluateInlineExpression(
		parsed.expression,
		scope,
		undefined,
		preProcessors
	);

	return { mode: parsed.mode, expression: parsed.expression, result: formatted };
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

// ---------------------------------------------------------------------------
// Note-global ($) variable chaining
// ---------------------------------------------------------------------------
describe('inline note-global ($) variable chaining', () => {

	describe('globals extracted from inline evaluation', () => {
		it('should return $x in globals when assigning $x = 10', () => {
			const result = evaluateInlineExpression('$x = 10', new NumeralsScope(), undefined, []);
			expect(result.globals.size).toBe(1);
			expect(result.globals.get('$x')).toBe(10);
		});

		it('should return no globals for non-$ assignment', () => {
			const result = evaluateInlineExpression('y = 10', new NumeralsScope(), undefined, []);
			expect(result.globals.size).toBe(0);
		});
	});

	describe('inline → inline chaining via shared scope', () => {
		it('should allow second expression to use $x defined in first', () => {
			// Simulate what the post-processor does: shared scope, sequential evaluation
			const scope = new NumeralsScope();

			// First expression defines $apples
			const r1 = evaluateInlineExpression('$apples = 100', scope, undefined, []);
			// Post-processor would inject globals into shared scope
			for (const [k, v] of r1.globals) { scope.set(k, v); }

			// Second expression uses $apples
			const r2 = evaluateInlineExpression('$apples * 2', scope, undefined, []);
			expect(r2.formatted).toBe('200');
		});

		it('should chain three globals sequentially', () => {
			const scope = new NumeralsScope();

			const r1 = evaluateInlineExpression('$a = 10', scope, undefined, []);
			for (const [k, v] of r1.globals) { scope.set(k, v); }

			const r2 = evaluateInlineExpression('$b = $a * 3', scope, undefined, []);
			for (const [k, v] of r2.globals) { scope.set(k, v); }

			const r3 = evaluateInlineExpression('$a + $b', scope, undefined, []);
			expect(r3.formatted).toBe('40');
		});
	});

	describe('scopeCache integration', () => {
		it('should populate scopeCache when inline defines a global', () => {
			const scopeCache = new Map<string, NumeralsScope>();
			const scope = new NumeralsScope();

			const result = evaluateInlineExpression('$price = 42', scope, undefined, []);
			
			// Simulate what the post-processor does after evaluation
			if (result.globals.size > 0) {
				const path = 'test.md';
				let pageScope = scopeCache.get(path);
				if (!pageScope) {
					pageScope = new NumeralsScope();
					scopeCache.set(path, pageScope);
				}
				for (const [k, v] of result.globals) {
					pageScope.set(k, v);
				}
			}

			expect(scopeCache.has('test.md')).toBe(true);
			expect(scopeCache.get('test.md')?.get('$price')).toBe(42);
		});
	});

	describe('$-global combined with @prev', () => {
		it('should support $total = @prev pattern', () => {
			const scope = new NumeralsScope();

			const r1 = evaluateInlineExpression('100 * 1.2', scope, undefined, []);
			const r2 = evaluateInlineExpression('$total = @prev * 1.08', scope, undefined, [], r1.raw);
			
			expect(r2.globals.has('$total')).toBe(true);
			// 100 * 1.2 * 1.08 = 129.6
			expect(r2.formatted).toContain('129.6');
		});
	});
});
