import { all, create, Matrix, ResultSet, Unit, type MathJsInstance } from 'mathjs';
import { runInNewContext } from 'node:vm';
import { copyEvaluationValue, copyMetadataValue, describeResult, detachResult, isFunctionDescription } from '../../src/evaluation/valueOwnership';
import { runtimeSafetyEpoch } from '../../src/evaluation/runtimeProvenance';

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

describe('metadata copying across native container boundaries', () => {
	let engine: MathJsInstance;
	beforeEach(() => { engine = create(all); });

	function resultSet(entries: unknown[]): ResultSet {
		return new (engine as MathJsInstance & {ResultSet: new (entries: unknown[]) => ResultSet}).ResultSet(entries);
	}

	function wrap(kind: 'matrix' | 'result-set', value: unknown): Matrix | ResultSet {
		if (kind === 'result-set') return resultSet([value]);
		const matrix = engine.matrix([0]);
		matrix.set([0], value);
		return matrix;
	}

	function first(value: Matrix | ResultSet): unknown {
		return engine.isMatrix(value) ? (value.toArray() as unknown[])[0] : value.entries[0];
	}

	it.each(['matrix', 'result-set'] as const)('does not execute inherited array getters or iterators below a native %s', kind => {
		const precision = engine.config({}).precision;
		const numericGetter = jest.fn(() => { engine.config({precision: 2}); return 99; });
		const iteratorGetter = jest.fn(() => Array.prototype[Symbol.iterator]);
		const prototype = Object.create(Array.prototype) as object;
		Object.defineProperty(prototype, '0', {get: numericGetter});
		Object.defineProperty(prototype, Symbol.iterator, {get: iteratorGetter});
		const input: unknown[] = new Array<unknown>(2);
		input[1] = 7;
		Object.setPrototypeOf(input, prototype);
		const copied = copyMetadataValue(wrap(kind, input), engine) as Matrix | ResultSet;
		expect(first(copied)).toEqual([undefined, 7]);
		expect(numericGetter).not.toHaveBeenCalled();
		expect(iteratorGetter).not.toHaveBeenCalled();
		expect(engine.config({}).precision).toBe(precision);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each(['matrix', 'result-set'] as const)('rejects own array hooks and hidden data below a native %s without executing them', kind => {
		const effect = jest.fn(() => { engine.config({precision: 2}); return 99; });
		const inputs: unknown[][] = [];
		const getter = [1, 2];
		Object.defineProperty(getter, '0', {get: effect});
		inputs.push(getter);
		const hiddenFunction = [1, 2];
		Object.defineProperty(hiddenFunction, Symbol('hidden'), {value: effect, enumerable: false});
		inputs.push(hiddenFunction);
		const iterator = [1, 2];
		Object.defineProperty(iterator, Symbol.iterator, {value: effect});
		inputs.push(iterator);
		const plainGetter = Object.defineProperty({}, 'amount', {get: effect, enumerable: true});
		inputs.push([plainGetter]);
		const hiddenPlainFunction = Object.defineProperty({}, Symbol('hidden'), {value: effect, enumerable: false});
		inputs.push([hiddenPlainFunction]);
		for (const input of inputs) expect(() => copyMetadataValue(wrap(kind, input), engine)).toThrow();
		expect(effect).not.toHaveBeenCalled();
		expect(engine.config({}).precision).toBe(64);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('preserves array, object, Matrix and ResultSet aliases and cycles in the same traversal', () => {
		const shared = {amount: 2};
		const entries: unknown[] = [shared, shared];
		const set = resultSet(entries);
		const matrix = wrap('matrix', set);
		const input: unknown[] = [matrix, set, entries, shared];
		entries.push(input, set);
		const copied = copyMetadataValue(input, engine) as [Matrix, ResultSet, unknown[], typeof shared];
		expect(copied[0].get([0])).toBe(copied[1]);
		expect(copied[1].entries).toBe(copied[2]);
		expect(copied[2][0]).toBe(copied[3]);
		expect(copied[2][1]).toBe(copied[3]);
		expect(copied[2][2]).toBe(copied);
		expect(copied[2][3]).toBe(copied[1]);
		expect(copied[2]).not.toBe(entries);
		copied[3].amount = 9;
		expect(shared.amount).toBe(2);
	});

	it.each(['getter', 'missing', 'inherited', 'non-array'] as const)('rejects %s ResultSet entries without reading provider hooks', kind => {
		const effect = jest.fn(() => { engine.config({precision: 2}); return [99]; });
		const input = resultSet([]);
		if (kind === 'getter') Object.defineProperty(input, 'entries', {get: effect});
		else if (kind === 'non-array') Object.defineProperty(input, 'entries', {value: {value: 7}});
		else {
			Reflect.deleteProperty(input, 'entries');
			if (kind === 'inherited') {
				const prototype = Object.create(Object.getPrototypeOf(input)) as object;
				Object.defineProperty(prototype, 'entries', {get: effect});
				Object.setPrototypeOf(input, prototype);
			}
		}
		expect(() => copyMetadataValue(input, engine)).toThrow('own data array');
		expect(effect).not.toHaveBeenCalled();
		expect(engine.config({}).precision).toBe(64);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each(['data', 'accessor'] as const)('never calls a ResultSet entry array’s own %s map hook', kind => {
		const effect = jest.fn(() => { engine.config({precision: 2}); return [99]; });
		const entries = [1, 2];
		Object.defineProperty(entries, 'map', kind === 'data' ? {value: effect} : {get: effect});
		expect(() => copyMetadataValue(resultSet(entries), engine)).toThrow();
		expect(effect).not.toHaveBeenCalled();
		expect(engine.config({}).precision).toBe(64);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('ignores a ResultSet entry array’s inherited map getter without invoking provider code', () => {
		const effect = jest.fn(() => { engine.config({precision: 2}); return () => [99]; });
		const prototype = Object.create(Array.prototype) as object;
		Object.defineProperty(prototype, 'map', {get: effect});
		const entries = [1, 2];
		Object.setPrototypeOf(entries, prototype);
		const copied = copyMetadataValue(resultSet(entries), engine) as ResultSet;
		expect(copied.entries).toEqual([1, 2]);
		expect(effect).not.toHaveBeenCalled();
		expect(engine.config({}).precision).toBe(64);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each(['matrix', 'result-set'] as const)('copies foreign array/plain children below a native %s and rejects their own getters', kind => {
		const input: unknown = runInNewContext('[{amount:7}, [1,2]]');
		expect(first(copyMetadataValue(wrap(kind, input), engine) as Matrix | ResultSet)).toEqual([{amount: 7}, [1, 2]]);
		const effect = jest.fn(() => { engine.config({precision: 2}); return 99; });
		const unsafe: unknown = runInNewContext('const item={}; Object.defineProperty(item,"amount",{get:effect,enumerable:true}); [item]', {effect});
		expect(() => copyMetadataValue(wrap(kind, unsafe), engine)).toThrow('accessor');
		expect(effect).not.toHaveBeenCalled();
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('preserves dense/sparse Matrix and typed numeric values below arrays', () => {
		const sparse = engine.matrix([[0, 2], [0, 0]], 'sparse');
		const dense = engine.matrix([[engine.unit('3 cm'), engine.complex(2, 3)]]);
		const precision = engine.bignumber('1.234567890123456789');
		const copied = copyMetadataValue([sparse, dense, precision], engine) as [Matrix, Matrix, typeof precision];
		expect(copied[0].storage()).toBe('sparse');
		expect(copied[0].toArray()).toEqual([[0, 2], [0, 0]]);
		expect(copied[1].storage()).toBe('dense');
		expect(engine.format(copied[1].get([0, 0]) as unknown)).toBe('3 cm');
		expect(engine.format(copied[1].get([0, 1]) as unknown)).toBe('2 + 3i');
		expect(copied[2].toJSON()).toEqual(precision.toJSON());
		expect(copied[2]).not.toBe(precision);
	});
});
