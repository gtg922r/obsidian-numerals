import { getExpectedMathJsSymbols } from '../scripts/mathjs-symbols';
import { getMathJsSymbols } from '../src/mathjsUtilities';

describe('getMathJsSymbols', () => {
	it('matches mathjs docs except for intentional exclusions and legacy undocumented symbols', () => {
		expect([...getMathJsSymbols()].sort()).toEqual([...getExpectedMathJsSymbols()].sort());
	});

	it('includes mathjs functions and constants added after the old static autocomplete list', () => {
		expect(getMathJsSymbols()).toEqual(expect.arrayContaining([
			'f|bernoulli()',
			'f|isBounded()',
			'f|isFinite()',
			'f|num()',
			'f|den()',
			'f|toBest()',
			'p|coulombConstant',
		]));
	});

	it('does not suggest mathjs internals that are not expression helpers', () => {
		expect(getMathJsSymbols()).not.toEqual(expect.arrayContaining([
			'c|version',
			'f|bignumber()',
			'f|config()',
			'f|createBernoulli()',
			'f|createUnit()',
			'f|bernoulliDependencies()',
			'f|import()',
			'f|mapSlices()',
			'f|parse()',
			'f|typed()',
		]));
	});
});
