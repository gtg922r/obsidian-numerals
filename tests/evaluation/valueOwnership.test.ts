import { all, create, Matrix, ResultSet, Unit } from 'mathjs';
import { copyEvaluationValue, copyMetadataValue, describeResult, detachResult, isFunctionDescription } from '../../src/evaluation/valueOwnership';

describe('note value ownership', () => {
	const engine = create(all);

	it('detaches native matrices, units and precision values immediately', () => {
		const matrix = engine.matrix([[engine.unit('2 m'), engine.complex(1, 2)]]);
		const detached = detachResult(matrix, engine) as Matrix;
		matrix.set([0, 0], engine.unit('4 m'));
		expect(engine.format(detached.get([0, 0]) as unknown)).toBe('2 m');
		const precision = engine.bignumber('1.2345678901234567890123456789');
		expect(detachResult(precision, engine)).not.toBe(precision);
		expect(engine.format(detachResult(precision, engine))).toBe(precision.toString());
	});

	it('copies nested ResultSets and immutable matrices using public matrix construction', () => {
		const nested: unknown = engine.evaluate('[evaluate("1;2")]');
		expect(() => detachResult(nested, engine)).not.toThrow();
		const immutable: unknown = engine.evaluate('index([1, 2]).dimension(0)');
		expect(() => detachResult(immutable, engine)).not.toThrow();
		expect(describeResult(nested, engine)).toMatchObject({kind: 'numerals-matrix', entries: [
			{value: {kind: 'numerals-collection', type: 'result-set', entries: [2]}},
		]});
	});

	it('retains raw Unit precision and flags in private copies', () => {
		const original = engine.unit(engine.bignumber('1.234567890123456789'), 'cm');
		original.fixPrefix = true;
		const copy = detachResult(original, engine) as Unit;
		expect(copy.value).not.toBe(original.value);
		expect(copy.fixPrefix).toBe(true);
		expect(engine.format(copy)).toBe(engine.format(original));
		copy.value = 8;
		expect(engine.format(original)).toBe('1.234567890123456789 cm');
	});

	it('retains offsets and native Unit operations after the owning runtime gains a base dimension', () => {
		const runtime = create(all);
		const original = runtime.unit('12 degC');
		original.fixPrefix = true;
		original.skipAutomaticSimplification = true;
		const recorded = detachResult(original, runtime) as Unit;
		runtime.createUnit('evaluationTestDimension');
		expect(recorded.equals(original)).toBe(true);
		expect(recorded.toNumber('degC')).toBeCloseTo(12);
		expect(recorded.to('K').toNumber('K')).toBeCloseTo(285.15);
		expect(recorded.fixPrefix).toBe(true);
		expect(recorded.skipAutomaticSimplification).toBe(true);
	});

	it.each(['-0', 'Infinity', '-Infinity', 'NaN', '1.23456789012345678901234567890123456789'])(
		'copies BigNumber %s exactly through its public constructor', text => {
			const original = engine.bignumber(text);
			const copy = detachResult(original, engine);
			expect(copy).not.toBe(original);
			expect(engine.isBigNumber(copy)).toBe(true);
			if (engine.isBigNumber(copy)) {
				expect(copy.toJSON()).toEqual(original.toJSON());
				expect(copy.isNegative()).toBe(original.isNegative());
			}
		},
	);

	it('handles semicolon ResultSets and recursively removes executable functions', () => {
		const scope = new Map<string, unknown>();
		const result: unknown = engine.evaluate('f(x)=x+1; [f, {nested:f}]', scope);
		expect(() => engine.clone(result)).toThrow();
		const detached = detachResult(result, engine) as ResultSet;
		expect(engine.isResultSet(detached)).toBe(true);
		const matrix = detached.entries[0] as Matrix;
		expect(isFunctionDescription(matrix.get([0]) as unknown)).toBe(true);
		expect(isFunctionDescription((matrix.get([1]) as {nested: unknown}).nested)).toBe(true);
		expect(typeof matrix.get([0])).toBe('object');
		expect(detachResult(engine.evaluate('a=1; b=2;') as unknown, engine)).toMatchObject({entries: []});
	});

	it('keeps live private closure identity while rejecting cached metadata functions', () => {
		const fn: unknown = engine.evaluate('f(x)=x+1');
		expect(copyEvaluationValue({fn}, engine)).toEqual({fn});
		expect(() => copyMetadataValue({nested: [fn]}, engine)).toThrow('executable function');
	});

	it('preserves plain-object aliases and cycles without sharing the source graph', () => {
		const child = {value: 2};
		const input: Record<string, unknown> = {left: child, right: child};
		input.self = input;
		const copy = detachResult(input, engine) as typeof input;
		expect(copy.left).toBe(copy.right);
		expect(copy.self).toBe(copy);
		expect(copy.left).not.toBe(child);
		(copy.left as typeof child).value = 9;
		expect(child.value).toBe(2);
	});

	it('does not invoke provider getters when capturing metadata', () => {
		const getter = jest.fn(() => 7);
		const value = Object.defineProperty({}, 'x', {get: getter, enumerable: true});
		expect(() => copyMetadataValue(value, engine)).toThrow('accessor');
		expect(getter).not.toHaveBeenCalled();
	});
});
