import { all, create, type MathJsInstance, type Matrix } from 'mathjs';
import { resolveCapturedMetadataReferences, type CapturedMetadataReferenceRequest } from '../../src/evaluation/metadataReferences';
import { EvaluationSession } from '../../src/evaluation/session';
import { isVerifiedProvenance } from '../../src/evaluation/provenance';
import { isRuntimeSafetyCurrent, runtimeSafetyEpoch } from '../../src/evaluation/runtimeProvenance';
import * as referenceBindings from '../../src/processing/referenceBindings';

const {load: parseYaml} = jest.requireActual<{load: (text: string) => unknown}>('js-yaml');

describe('captured target metadata reference batches', () => {
	let engine: MathJsInstance;
	beforeEach(() => { engine = create(all); });
	afterEach(() => { jest.restoreAllMocks(); });
	function request(yaml: string, propertyPaths: readonly string[], overrides: Partial<CapturedMetadataReferenceRequest> = {}): CapturedMetadataReferenceRequest {
		return {source: {sourceId: 'target-buffer', path: 'Target.md', revision: 1, text: `---\n${yaml}\n---`},
			engine, parseYaml, metadataGeneration: 'metadata:1', runtimeGeneration: 1, preProcessors: [], propertyPaths, ...overrides};
	}
	function resolve(yaml: string, propertyPaths: readonly string[], overrides: Partial<CapturedMetadataReferenceRequest> = {}) {
		return resolveCapturedMetadataReferences(request(yaml, propertyPaths, overrides));
	}

	it('keeps current native YAML and opt-in authoritative over cached Dataview', () => {
		const results = resolve('numerals: price\nprice: 2\nhidden: 99\n$tax: 3', ['price', '$tax', 'hidden', 'deleted'], {
			dataview: {status: 'projection', revision: 2, metadata: {numerals: 'all', price: 100, hidden: 101, deleted: 10,
				file: {frontmatter: {numerals: 'all', price: 100, hidden: 101, deleted: 10}}}},
		});
		expect(results.map(item => item.result.value)).toEqual([2, 3, undefined, undefined]);
		expect(results.slice(0, 2).every(item => isVerifiedProvenance(item.provenance))).toBe(true);
		expect(results.slice(2).map(item => item.result.status)).toEqual(['unavailable-property', 'unavailable-property']);
	});

	it.each([false, true])('tracks transitive Dataview reads through native metadata functions; verified=%s', verified => {
		const input = request('numerals: all\n$f(x): "x + $dv"\ntotal: "$f(2)"\nindependent: 7', ['total', 'independent']);
		const results = resolveCapturedMetadataReferences({...input, dataview: {status: 'projection', origin: 'inline-fields',
			revision: 'dv1', metadata: {$dv: 3}, ...(verified ? {evidence: {...input.source, kind: 'exact-buffer-capture' as const, projectionRevision: 'dv1'}} : {})}});
		expect(results.map(item => item.result.value)).toEqual([5, 7]);
		expect(isVerifiedProvenance(results[0].provenance)).toBe(verified);
		// Existing F policy treats an unverified opaque function call as possible
		// runtime mutation; a later constant also respects that sticky uncertainty.
		expect(isVerifiedProvenance(results[1].provenance)).toBe(verified);
		if (!verified) expect(results[0].provenance.unverified).toContain('Dataview field $dv');
	});

	it('keeps unrelated native roots verified when a scalar expression reads Dataview', () => {
		const results = resolve('numerals: all\ntotal: "$dv+2"\nindependent: 7', ['total', 'independent'], {
			dataview: {status: 'projection', origin: 'inline-fields', revision: 'dv1', metadata: {$dv: 3}},
		});
		expect(results.map(item => item.result.value)).toEqual([5, 7]);
		expect(results[0].provenance.unverified).toContain('Dataview field $dv');
		expect(isVerifiedProvenance(results[1].provenance)).toBe(true);
	});

	it.each([[], ['missing'], ['missing', 'missing', 'hidden.cost']].map(paths => ({paths})))('does not initialize metadata for unavailable requests: $paths', ({paths}) => {
		const evaluate = jest.spyOn(engine, 'evaluate');
		const results = resolve('numerals: none\nhidden: 7\n$random: "random()"\n$unit: \'createUnit("unusedunit","2 m")\'', paths);
		expect(results.every(item => item.result.status === 'unavailable-property')).toBe(true);
		expect(evaluate).not.toHaveBeenCalled();
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('does not initialize unrelated root metadata for a nested-only batch', () => {
		const evaluate = jest.spyOn(engine, 'evaluate');
		const results = resolve('numerals: all\nnoise: \'createUnit("unusedunit","2 m")\'\nbox:\n  value: "2+3"', ['box.value', 'box.value']);
		expect(results.map(item => item.result.value)).toEqual([5, 5]);
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(evaluate.mock.calls[0][0]).toBe('2+3');
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('preserves raw root indexing and selects only the reached leaf array once', () => {
		const results = resolve('numerals: all\nrows: [[1, 2], [3, 4]]\nrates: [{cost: 1}, {cost: 2}]\nbox:\n  rows: [[5, 6], [7, 8]]',
			['rows', 'rows.0', 'rows.0.0', 'rows.1', 'rates.cost', 'rates.0.cost', 'box.rows']);
		expect(results.map(item => item.result.value)).toEqual([[3, 4], 2, 1, 4, undefined, 1, [7, 8]]);
		expect(results[4].result.status).toBe('unavailable-property');
	});

	it('retains evaluated matrix results and gives duplicates independent typed clones', () => {
		const results = resolve('numerals: all\nbox:\n  value: "[1, 2]"', ['box.value', 'box.value']);
		const first = results[0].result.value as Matrix, second = results[1].result.value as Matrix;
		expect(engine.isMatrix(first)).toBe(true);
		expect(first.toArray()).toEqual([1, 2]);
		expect(first).not.toBe(second);
		first.set([0], 99);
		expect(second.toArray()).toEqual([1, 2]);
	});

	it('detaches raw provider arrays and each top-level returned copy', () => {
		const raw = {numerals: 'all', rows: [[1, 2], [3, 4]]};
		const results = resolve('', ['rows', 'rows'], {parseYaml: () => raw});
		(results[0].result.value as number[])[0] = 99;
		expect(results[1].result.value).toEqual([3, 4]);
		expect(raw.rows).toEqual([[1, 2], [3, 4]]);
	});

	it.each([['price', 'box.value'], ['box.value', 'price']].map(paths => ({paths})))('preserves empty-scope nested expressions in mixed order: $paths', ({paths}) => {
		const results = resolve('numerals: all\nprice: 3\n$rate: 4\nbox:\n  value: "price + $rate"', paths);
		expect(results.find(item => item.propertyPath === 'price')!.result.value).toBe(3);
		const nested = results.find(item => item.propertyPath === 'box.value')!;
		expect(nested.result.status).toBe('invalid-value');
		expect(nested.result.error).toContain('Undefined symbol price');
	});

	it('does not publish leaf assignments to another path, including dollar globals', () => {
		const results = resolve('numerals: all\nbox:\n  first: "$x=7"\n  second: "$x"', ['box.first', 'box.second', 'box.first']);
		expect(results.map(item => item.result.value)).toEqual([7, undefined, 7]);
		expect(results[1].result.error).toContain('Undefined symbol $x');
	});

	it('uses first-use order and initializes roots only when the first available root is reached', () => {
		let count = 0;
		engine.import({tick: () => ++count});
		const results = resolve('numerals: all\nseed: "tick()"\ntotal: "seed+10"\nbox:\n  first: "tick()"\n  second: "tick()"',
			['missing', 'box.first', 'seed', 'box.second', 'total', 'seed', 'box.first']);
		expect(results.map(item => item.result.value)).toEqual([undefined, 1, 2, 3, 12, 2, 1]);
		expect(count).toBe(3);
	});

	it('samples seeded random once per target capture and resamples a new generation', () => {
		engine.config({randomSeed: 'captured-references'});
		const evaluate = jest.spyOn(engine, 'evaluate');
		const input = request('numerals: all\nsample: "random()"\nderived: "sample*2"', ['sample', 'sample', 'derived']);
		const first = resolveCapturedMetadataReferences(input);
		expect(first[0].result.value).toBe(first[1].result.value);
		expect(first[2].result.value).toBe((first[0].result.value as number) * 2);
		expect(evaluate.mock.calls.filter(call => String(call[0]) === 'random()')).toHaveLength(1);
		const next = resolveCapturedMetadataReferences({...input, source: {...input.source, revision: 2}, metadataGeneration: 'metadata:2'});
		expect(next[0].result.value).not.toBe(first[0].result.value);
		expect(evaluate.mock.calls.filter(call => String(call[0]) === 'random()')).toHaveLength(2);
	});

	it('samples a repeated nested random expression once', () => {
		engine.config({randomSeed: 'nested-references'});
		const evaluate = jest.spyOn(engine, 'evaluate');
		const results = resolve('numerals: all\nbox:\n  sample: "random()"', ['box.sample', 'box.sample']);
		expect(results[0].result.value).toBe(results[1].result.value);
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('never retries forward or cyclic metadata declarations after initialization', () => {
		const evaluate = jest.spyOn(engine, 'evaluate');
		const results = resolve('numerals: all\nforward: "later+1"\nlater: 3\na: "b+1"\nb: "a+1"', ['forward', 'a', 'b', 'later', 'forward']);
		expect(results.map(item => item.result.status)).toEqual(['invalid-value', 'invalid-value', 'invalid-value', 'resolved', 'invalid-value']);
		expect(results[0].result.error).toBe(results[4].result.error);
		expect(evaluate.mock.calls.map(call => call[0])).toEqual(['later+1', 'b+1', 'a+1']);
	});

	it('does not retry a failed nondeterministic field', () => {
		let count = 0;
		engine.import({tick: () => ++count});
		const results = resolve('numerals: all\nbad: "tick()+missing"', ['bad', 'bad']);
		expect(results.every(item => item.result.status === 'invalid-value')).toBe(true);
		expect(count).toBe(1);
	});

	it('shares an output-copy failure without retrying the field or its later copies', () => {
		let samples = 0, copies = 0;
		engine.import({sample: () => ++samples});
		const clone = referenceBindings.cloneReferenceValue;
		jest.spyOn(referenceBindings, 'cloneReferenceValue').mockImplementation((value, runtime) => {
			if (++copies === 3) throw new Error('Native copy failed');
			return clone(value, runtime);
		});
		const results = resolve('numerals: all\nvalue: "sample()"', ['value', 'value', 'value']);
		expect(results.every(item => item.result.status === 'invalid-value' && item.result.error === 'Native copy failed')).toBe(true);
		expect(samples).toBe(1);
		expect(copies).toBe(3);
	});

	it.each(['config({precision:2})', 'config({precision:2}) + missing'])('records native root effects even when resolution fails: %s', source => {
		const results = resolve('', ['effect', 'effect'], {parseYaml: () => ({numerals: 'all', effect: source})});
		expect(results.every(item => item.result.status === 'invalid-value')).toBe(true);
		expect(results[0].provenance.ambiguous).toBe(true);
		expect(engine.config({}).precision).toBe(2);
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it.each(['config({precision:2})', 'config({precision:2}) + missing'])('records native leaf effects even on clone rejection or native failure: %s', source => {
		const results = resolve('', ['box.effect'], {parseYaml: () => ({numerals: 'all', box: {effect: source}})});
		expect(results[0].result.status).toBe('invalid-value');
		expect(results[0].provenance.ambiguous).toBe(true);
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('does not rerun a createUnit declaration for multiple available roots', () => {
		const evaluate = jest.spyOn(engine, 'evaluate');
		const results = resolve('numerals: all\ndefine: \'createUnit("batchunit", "2 m")\'\na: "2 batchunit"\nb: "3 batchunit"', ['a', 'b', 'a']);
		expect(results.every(item => item.result.status === 'resolved')).toBe(true);
		expect(results.map(item => engine.format(item.result.value))).toEqual(['2 batchunit', '3 batchunit', '2 batchunit']);
		expect(evaluate.mock.calls.filter(call => String(call[0]).startsWith('createUnit'))).toHaveLength(1);
	});

	it('rejects inherited paths, raw accessors, cached closures and executable exports', () => {
		const getter = jest.fn(() => 7);
		const accessor = Object.defineProperty({}, 'secret', {get: getter, enumerable: true});
		const results = resolve('', ['box.toString', 'box.constructor', 'bad.secret', 'cached', 'fn', 'object'], {
			parseYaml: () => ({numerals: 'all', box: {value: 2}, bad: accessor, cached: () => 2, fn: 'f(x)=x+1', object: {x: 2}}),
		});
		expect(results.slice(0, 4).every(item => item.result.status === 'unavailable-property')).toBe(true);
		expect(results.slice(4).every(item => item.result.status === 'invalid-value')).toBe(true);
		expect(getter).not.toHaveBeenCalled();
	});

	it('rejects cyclic reference values using the existing clone whitelist', () => {
		const value: unknown[] = []; value.push(value);
		const results = resolve('', ['box.value'], {parseYaml: () => ({numerals: 'all', box: {value: [value]}})});
		expect(results[0].result.status).toBe('invalid-value');
	});

	it('never resolves another note while evaluating a nested string', () => {
		const results = resolve('numerals: all\nbox:\n  value: "[[Another]].price"', ['box.value']);
		expect(results[0].result.status).toBe('invalid-value');
	});

	it('retires root and leaf environments after successful and rejected captures', () => {
		const retire = jest.spyOn(EvaluationSession.prototype, 'retire');
		resolve('numerals: all\nprice: 2\nbox:\n  good: "3+4"\n  bad: "f(x)=x+1"', ['price', 'box.good', 'box.bad']);
		expect(retire).toHaveBeenCalledTimes(2);
		for (const session of retire.mock.contexts) expect(session.isRetired).toBe(true);
	});

	it('cancellation returns no partial result, records preceding native effects and retires every session', () => {
		const controller = new AbortController();
		engine.import({cancel: () => { controller.abort(); return 1; }});
		const retire = jest.spyOn(EvaluationSession.prototype, 'retire');
		const input = request('numerals: all\neffect: "cancel(config({precision:2}))"\nbox:\n  value: 4', ['box.value', 'effect']);
		expect(() => resolveCapturedMetadataReferences(input, controller.signal)).toThrow(/superseded/);
		expect(retire).toHaveBeenCalledTimes(2);
		for (const session of retire.mock.contexts) expect(session.isRetired).toBe(true);
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('cancellation during a typed output clone exposes no partial batch and retires the session', () => {
		const controller = new AbortController();
		const clone = referenceBindings.cloneReferenceValue;
		jest.spyOn(referenceBindings, 'cloneReferenceValue').mockImplementation((value, runtime) => {
			const result = clone(value, runtime); controller.abort(); return result;
		});
		const retire = jest.spyOn(EvaluationSession.prototype, 'retire');
		expect(() => resolveCapturedMetadataReferences(request('numerals: all\nprice: 2', ['price']), controller.signal)).toThrow(/superseded/);
		expect(retire).toHaveBeenCalledTimes(1);
		expect(retire.mock.contexts[0].isRetired).toBe(true);
	});

	it('pre-cancelled capture performs no parsing or evaluation', () => {
		const controller = new AbortController(); controller.abort();
		const parser = jest.fn(parseYaml), evaluate = jest.spyOn(engine, 'evaluate');
		expect(() => resolveCapturedMetadataReferences(request('numerals: all\nprice: "random()"', ['price'], {parseYaml: parser}), controller.signal)).toThrow(/superseded/);
		expect(parser).not.toHaveBeenCalled();
		expect(evaluate).not.toHaveBeenCalled();
	});
});
