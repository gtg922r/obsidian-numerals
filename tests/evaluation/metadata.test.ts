import { all, create } from 'mathjs';
import { runInNewContext } from 'node:vm';
import {
	captureDeclarativeMetadataValue, captureNoteMetadata, getMetadataFreshness,
	type CaptureNoteMetadataInput, type DataviewMetadataInput,
	type ExactDataviewBufferEvidence, type MetadataSource,
} from '../../src/evaluation/metadata';
import { createMetadataSession, initializeMetadataEntries } from '../../src/evaluation/metadataEvaluation';
import { runtimeSafetyEpoch } from '../../src/evaluation/runtimeProvenance';
import { getNestedProperty } from '../../src/processing/crossNoteResolver';

const { load: parseYaml } = jest.requireActual<{ load: (text: string) => unknown }>('js-yaml');
const engine = create(all);

function source(text: string, revision: string | number = 1): MetadataSource {
	return { sourceId: 'editor-A', path: 'Costs.md', revision, text };
}

function capture(text: string, options: Partial<CaptureNoteMetadataInput> = {}) {
	return captureNoteMetadata({ source: source(text), engine, parseYaml, ...options });
}

function values(result: ReturnType<typeof capture>, native = false): Record<string, unknown> {
	return Object.fromEntries((native ? result.nativeEntries : result.entries).map(entry => [entry.key, entry.value]));
}

describe('initial declarative provider capture', () => {
	it.each(['root', 'nested'] as const)('rejects %s numeric array getters before executing provider code', position => {
		const getter = jest.fn(() => 2);
		const array = [0];
		Object.defineProperty(array, '0', {enumerable: true, get: getter});
		expect(() => captureDeclarativeMetadataValue(position === 'root' ? array : {values: array}, engine)).toThrow('accessor');
		expect(getter).not.toHaveBeenCalled();
	});

	it.each(['data', 'accessor'] as const)('rejects an own %s array iterator without invoking provider code', kind => {
		const iterator = jest.fn(function* () { yield 2; });
		const getter = jest.fn(() => iterator);
		const array = [2];
		Object.defineProperty(array, Symbol.iterator, kind === 'data' ? {value: iterator} : {get: getter});
		expect(() => captureDeclarativeMetadataValue(array, engine)).toThrow('iterator');
		expect(iterator).not.toHaveBeenCalled();
		expect(getter).not.toHaveBeenCalled();
	});

	it.each(['array', 'object'] as const)('rejects hidden executable data properties on a declarative %s', kind => {
		const cached = jest.fn(() => 2);
		for (const key of ['hidden', Symbol('hidden')]) {
			const input = kind === 'array' ? [1, 2] : {value: 2};
			Object.defineProperty(input, key, {value: cached, enumerable: false});
			expect(() => captureDeclarativeMetadataValue(input, engine)).toThrow('executable function');
		}
		expect(cached).not.toHaveBeenCalled();
	});

	it('rejects hidden symbolic accessors without invoking them', () => {
		const getter = jest.fn(() => 2);
		const input = [1, 2];
		Object.defineProperty(input, Symbol('hidden'), {get: getter, enumerable: false});
		expect(() => captureDeclarativeMetadataValue(input, engine)).toThrow('accessor');
		expect(getter).not.toHaveBeenCalled();
	});

	it('detaches native mathjs values without changing their supported types', () => {
		const input = {unit: engine.unit('3 cm'), matrix: engine.matrix([[1, 2]]), complex: engine.complex(2, 3)};
		const captured = captureDeclarativeMetadataValue(input, engine) as typeof input;
		expect(engine.isUnit(captured.unit)).toBe(true);
		expect(engine.isMatrix(captured.matrix)).toBe(true);
		expect(engine.isComplex(captured.complex)).toBe(true);
		expect(captured.unit.toNumber('cm')).toBeCloseTo(3);
		expect(captured.matrix.toArray()).toEqual([[1, 2]]);
		expect(captured.complex.toString()).toBe('2 + 3i');
		captured.unit.value = 9;
		captured.matrix.set([0, 0], 9);
		captured.complex.re = 9;
		expect(input.unit.toNumber('cm')).toBeCloseTo(3);
		expect(input.matrix.get([0, 0])).toBe(1);
		expect(input.complex.re).toBe(2);
	});

	it('preserves cross-realm arrays and nested native values with independent ownership', () => {
		const unit = engine.unit('3 cm');
		const input: unknown = runInNewContext('[value, [1, 2]]', {value: unit});
		expect(Array.isArray(input)).toBe(true);
		expect(input instanceof Array).toBe(false);
		const captured = captureDeclarativeMetadataValue(input, engine) as [typeof unit, number[]];
		expect(captured).not.toBe(input);
		expect(captured[0].toNumber('cm')).toBeCloseTo(3);
		expect(captured[1]).toEqual([1, 2]);
		captured[0].value = 9;
		captured[1][0] = 9;
		expect(unit.toNumber('cm')).toBeCloseTo(3);
		expect((input as unknown[])[1]).toEqual([1, 2]);
	});

	it('never executes inherited numeric array getters or imports their values', () => {
		const runtime = create(all);
		const precision = runtime.config({}).precision;
		const getter = jest.fn(() => { runtime.config({precision: 2}); return 99; });
		const prototype = Object.create(Array.prototype) as object;
		Object.defineProperty(prototype, '0', {get: getter});
		const input: unknown[] = [];
		input[1] = 7;
		Object.setPrototypeOf(input, prototype);
		const captured = captureDeclarativeMetadataValue(input, runtime) as unknown[];
		expect(getter).not.toHaveBeenCalled();
		expect(runtime.config({}).precision).toBe(precision);
		expect(runtimeSafetyEpoch(runtime)).toBe(0);
		expect(captured).toEqual([undefined, 7]);
		expect(getNestedProperty({values: captured}, 'values.0')).toBeUndefined();
	});

	it('keeps inherited array data paths unavailable beneath plain objects', () => {
		const prototype = Object.create(Array.prototype) as object;
		Object.defineProperty(prototype, '0', {value: {amount: 99}});
		const input: unknown[] = [];
		input[1] = {amount: 7};
		Object.setPrototypeOf(input, prototype);
		const captured = captureDeclarativeMetadataValue({values: input}, engine) as Record<string, unknown>;
		expect(getNestedProperty(captured, 'values.0.amount')).toBeUndefined();
		expect(getNestedProperty(captured, 'values.1.amount')).toBe(7);
	});

	it.each(['data', 'accessor'] as const)('ignores an inherited %s array iterator without invoking it', kind => {
		const iterator = jest.fn(function* () { yield 99; });
		const getter = jest.fn(() => iterator);
		const prototype = Object.create(Array.prototype) as object;
		Object.defineProperty(prototype, Symbol.iterator, kind === 'data' ? {value: iterator} : {get: getter});
		const input = [1, 2];
		Object.setPrototypeOf(input, prototype);
		expect(captureDeclarativeMetadataValue(input, engine)).toEqual([1, 2]);
		expect(getter).not.toHaveBeenCalled();
		expect(iterator).not.toHaveBeenCalled();
	});

	it('normalizes foreign plain children and preserves cross-realm sparse arrays and cycles', () => {
		const input: unknown = runInNewContext('const data=[]; data[2]={amount:7}; data[3]=data; data');
		const captured = captureDeclarativeMetadataValue(input, engine) as unknown[];
		expect(captured[0]).toBeUndefined();
		expect(captured[1]).toBeUndefined();
		expect(captured[2]).toEqual({amount: 7});
		expect(captured[3]).toBe(captured);
		expect(captured).not.toBe(input);
	});

	it('rejects own getters below foreign plain children without invoking them', () => {
		const getter = jest.fn(() => 7);
		const input: unknown = runInNewContext('const child={}; Object.defineProperty(child,"amount",{get:getter,enumerable:true}); [child]', {getter});
		expect(() => captureDeclarativeMetadataValue(input, engine)).toThrow('accessor');
		expect(getter).not.toHaveBeenCalled();
	});

	it('preserves an own __proto__ data key without applying prototype assignment semantics', () => {
		const input: Record<string, unknown> = {};
		Object.defineProperty(input, '__proto__', {value: {amount: 7}, enumerable: true});
		const captured = captureDeclarativeMetadataValue(input, engine) as Record<string, unknown>;
		expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
		expect(Object.getOwnPropertyDescriptor(captured, '__proto__')?.value).toEqual({amount: 7});
	});
});

describe('authoritative note metadata capture', () => {
	it('parses the current full buffer, then removes obsolete fields in the next revision', () => {
		const first = capture('---\nnumerals: all\nprice: 2\n$old: 10\n---\n`#: price`');
		const nextSource = source('---\nnumerals: all\nprice: 7\n---\n`#: price`', 2);
		const next = captureNoteMetadata({ source: nextSource, engine, parseYaml });
		expect(values(first)).toEqual({ price: 2, $old: 10 });
		expect(values(next)).toEqual({ price: 7 });
		expect(first.freshness.status).toBe('native-ready');
		expect(next.freshness.allowsAutomaticInsertion).toBe(true);
	});

	it('passes only frontmatter YAML to the injected parser, preserving CRLF and UTF-16 offsets', () => {
		const text = '\uFEFF---\r\nnumerals: all\r\nlabel: "😀"\r\n---\r\nBody';
		const parser = jest.fn(parseYaml);
		const result = capture(text, { parseYaml: parser });
		expect(parser).toHaveBeenCalledWith('numerals: all\r\nlabel: "😀"\r\n');
		expect(values(result)).toEqual({ label: '😀' });
		expect(result.frontmatter).toEqual({ status: 'parsed', start: 0, end: text.lastIndexOf('---') + 3 });
	});

	it.each([
		['none', false, { $global: 5 }],
		['all', false, { x: 1, y: 2, $global: 5 }],
		['x', false, { x: 1, $global: 5 }],
		['[x, y]', false, { x: 1, y: 2, $global: 5 }],
		[undefined, false, { $global: 5 }],
		[undefined, true, { x: 1, y: 2, $global: 5 }],
		['none', true, { $global: 5 }],
	] as const)('keeps opt-in %s and forceAll %s semantics', (policy, forceAll, expected) => {
		const policyLine = policy === undefined ? '' : `numerals: ${policy}\n`;
		expect(values(capture(`---\n${policyLine}x: 1\ny: 2\n$global: 5\n---`, { forceAll }))).toEqual(expected);
	});

	it('retains unevaluated function declarations and expression strings', () => {
		const result = capture('---\nnumerals: all\n$f(x): "x + $rate"\n$rate: "2 + 3"\n---');
		expect(values(result)).toEqual({ '$f(x)': 'x + $rate', $rate: '2 + 3' });
		expect(result.entries.every(entry => typeof entry.value !== 'function')).toBe(true);
	});

	it('uses the last native array entry without flattening nested array values', () => {
		const result = capture('---\nnumerals: all\nrate: [1, 3]\nrows: [[1, 2], [3, 4]]\nempty: []\n---');
		expect(values(result)).toEqual({ rate: 3, rows: [3, 4], empty: undefined });
		expect(Object.fromEntries(result.entries.map(entry => [entry.key, entry.rawValue])))
			.toEqual({rate: [1, 3], rows: [[1, 2], [3, 4]], empty: []});
	});

	it('treats non-leading YAML, missing frontmatter, and unclosed frontmatter without cached fallback', () => {
		const parser = jest.fn(parseYaml);
		expect(capture('Text\n---\nnumerals: all\nx: 2\n---', { parseYaml: parser }).frontmatter.status).toBe('absent');
		expect(capture('No properties', { parseYaml: parser }).entries).toEqual([]);
		const unclosed = capture('---\nnumerals: all\n$gone: 4', { parseYaml: parser });
		expect(unclosed.frontmatter.status).toBe('unclosed');
		expect(unclosed.entries).toEqual([]);
		expect(capture('---', { parseYaml: parser }).frontmatter.status).toBe('unclosed');
		expect(parser).not.toHaveBeenCalled();
	});

	it('reports malformed/nonmapping frontmatter and still permits native calculation without seeds', () => {
		const invalid = capture('---\nx: [broken\n---');
		expect(invalid.frontmatter.status).toBe('invalid');
		expect(invalid.warnings[0]).toMatch(/^Frontmatter:/);
		expect(invalid.nativeEntries).toEqual([]);
		expect(invalid.freshness.nativeReady).toBe(true);
		expect(capture('---\n- a\n- b\n---').frontmatter.status).toBe('invalid');
	});

	it('supports empty YAML and the declared YAML closing-marker policy', () => {
		expect(capture('---\n---').frontmatter.status).toBe('parsed');
		expect(values(capture('---\nnumerals: all\nx: 2\n...\nBody'))).toEqual({ x: 2 });
	});
});

describe('Dataview fields and detached declarative inputs', () => {
	it('preserves native values, removes canonical aliases, and uses repeated inline fields’ last array values', () => {
		const result = capture('---\nnumerals: all\nprice: 1\nlocal: 6\n---', {
			dataview: { status: 'projection', revision: 4, metadata: {
				price: [1, 4], 'f(x)': 'x + 2', fx: 'x + 2', '$g(x)': 'x * 3', gx: 'x * 3',
				'Hourly Rate': [5, 10], 'hourly-rate': [5, 10], file: { frontmatter: { price: 1, local: 6 } }, position: {},
			} },
		});
		expect(values(result)).toEqual({ price: 1, local: 6, 'f(x)': 'x + 2', '$g(x)': 'x * 3', 'Hourly Rate': 10 });
		expect(values(result, true)).toEqual({ price: 1, local: 6 });
		expect(result.entries.find(entry => entry.key === 'price')?.provenance).toBe('native');
		expect(result.entries.find(entry => entry.key === 'local')?.provenance).toBe('native');
		expect(result.freshness.status).toBe('unverified');
	});

	it('uses the current buffer’s opt-in when a stale projection claims all or none', () => {
		const metadata = { numerals: 'all', price: 40, hidden: 90, $global: 8, file: { frontmatter: {} } };
		expect(values(capture('---\nnumerals: price\nprice: 2\n---', {
			dataview: { status: 'projection', revision: 2, metadata },
		}))).toEqual({ price: 2, $global: 8 });
		expect(values(capture('No frontmatter', {
			dataview: { status: 'projection', revision: 2, metadata },
		}))).toEqual({ $global: 8 });
		expect(values(capture('---\nnumerals: all\n---', {
			dataview: { status: 'projection', revision: 3, metadata: { ...metadata, numerals: 'none' } },
		}))).toEqual({ price: 40, hidden: 90, $global: 8 });
	});

	it('detaches nested values and mathjs types from providers and from native fallback entries', () => {
		const property = { nested: { cost: 2 }, matrix: engine.matrix([[1, 2]]), unit: engine.unit('3 cm') };
		const result = capture('---\nnumerals: all\n---', {
			parseYaml: () => ({ numerals: 'all', property }),
			dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata: { extra: 5 } },
		});
		const output = values(result).property as typeof property;
		output.nested.cost = 99;
		output.matrix.set([0, 0], 99);
		output.unit.value = 99;
		expect(property.nested.cost).toBe(2);
		expect(property.matrix.get([0, 0])).toBe(1);
		expect(property.unit.toNumber('cm')).toBeCloseTo(3);
		expect((values(result, true).property as typeof property).nested.cost).toBe(2);
	});

	it('owns raw root arrays separately from selected values, provider values, and native fallback entries', () => {
		const rows = [[{cost: 1}], [{cost: 3}]];
		const repeated = [[1, 2], [3, 4]];
		const result = capture('---\nnumerals: all\n---', {
			parseYaml: () => ({numerals: 'all', rows}),
			dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {repeated}},
		});
		const native = result.entries.find(entry => entry.key === 'rows')!;
		const projected = result.entries.find(entry => entry.key === 'repeated')!;
		expect(native.rawValue).toEqual([[{cost: 1}], [{cost: 3}]]);
		expect(native.value).toEqual([{cost: 3}]);
		expect(projected.rawValue).toEqual([[1, 2], [3, 4]]);
		expect(projected.value).toEqual([3, 4]);
		(native.rawValue as typeof rows)[1][0].cost = 50;
		(native.value as {cost: number}[])[0].cost = 70;
		(projected.rawValue as number[][])[1][0] = 60;
		expect(rows[1][0].cost).toBe(3);
		expect(repeated[1][0]).toBe(3);
		expect(projected.value).toEqual([3, 4]);
		expect(result.nativeEntries.find(entry => entry.key === 'rows')?.rawValue).toEqual(rows);
		expect(result.nativeEntries.find(entry => entry.key === 'rows')?.value).toEqual(rows[1]);
	});

	it('rejects cached executable functions even inside collections, preserving other fields', () => {
		const cached = () => 2;
		const functionMatrix = engine.matrix([0]);
		functionMatrix.set([0], cached);
		const result = capture('---\nnumerals: all\n---', {
			dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata: {
				bad: cached, nested: { f: cached }, repeated: [cached, 5], matrix: functionMatrix, good: 7,
			} },
		});
		expect(values(result)).toEqual({ good: 7 });
		expect(result.warnings).toHaveLength(4);
		expect(result.warnings.every(warning => warning.includes('executable function'))).toBe(true);
	});

	it('does not invoke external metadata accessors', () => {
		const accessor = jest.fn(() => 7);
		const metadata: Record<string, unknown> = { good: 3 };
		Object.defineProperty(metadata, 'bad', { enumerable: true, get: accessor });
		const result = capture('---\nnumerals: all\n---', { dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata } });
		expect(values(result)).toEqual({ good: 3 });
		expect(accessor).not.toHaveBeenCalled();
		expect(result.warnings[0]).toContain('accessor');
	});

	it.each(['root', 'nested'] as const)('rejects numeric array accessors before copying a %s raw value', position => {
		const accessor = jest.fn(() => 1);
		const array = [0, 2];
		Object.defineProperty(array, '0', {enumerable: true, get: accessor});
		const result = capture('---\nnumerals: all\n---', {dataview: {
			status: 'projection', origin: 'inline-fields', revision: 1,
			metadata: {bad: position === 'root' ? array : {values: array}, good: 7},
		}});
		expect(values(result)).toEqual({good: 7});
		expect(accessor).not.toHaveBeenCalled();
		expect(result.warnings[0]).toContain('accessor');
	});

	it.each(['data', 'accessor'] as const)('rejects an array’s own %s iterator without reading or calling it', kind => {
		const iterator = jest.fn(function* () { yield 1; yield 2; });
		const getter = jest.fn(() => iterator);
		const array = [1, 2];
		Object.defineProperty(array, Symbol.iterator, kind === 'data' ? {value: iterator} : {get: getter});
		const result = capture('---\nnumerals: all\n---', {dataview: {
			status: 'projection', origin: 'inline-fields', revision: 1, metadata: {bad: {values: array}, good: 7},
		}});
		expect(values(result)).toEqual({good: 7});
		expect(iterator).not.toHaveBeenCalled();
		expect(getter).not.toHaveBeenCalled();
		expect(result.warnings[0]).toContain('iterator');
	});

	it('retains sparse and cyclic arrays plus nested native values during declarative copying', () => {
		const sparse: unknown[] = [];
		sparse[2] = [3, 4];
		const cycle: unknown[] = [];
		cycle.push(cycle);
		const nested = {matrix: engine.matrix([[1, 2]]), unit: engine.unit('3 cm')};
		const result = capture('---\nnumerals: all\n---', {parseYaml: () => ({numerals: 'all', sparse, cycle, nested})});
		expect(result.warnings).toEqual([]);
		const sparseEntry = result.entries.find(entry => entry.key === 'sparse')!;
		expect(sparseEntry.rawValue).toEqual([undefined, undefined, [3, 4]]);
		expect(sparseEntry.value).toEqual([3, 4]);
		const cycleEntry = result.entries.find(entry => entry.key === 'cycle')!;
		expect((cycleEntry.rawValue as unknown[])[0]).toBe(cycleEntry.rawValue);
		expect((cycleEntry.value as unknown[])[0]).toBe(cycleEntry.value);
		expect(cycleEntry.rawValue).not.toBe(cycleEntry.value);
		const nestedEntry = result.entries.find(entry => entry.key === 'nested')!;
		expect((nestedEntry.value as typeof nested).matrix.toArray()).toEqual([[1, 2]]);
		expect((nestedEntry.value as typeof nested).unit.toNumber('cm')).toBeCloseTo(3);
	});
});

describe('shared captured metadata initialization', () => {
	const generation = {sourceRevision: '1', metadataGeneration: 'metadata:1', runtimeGeneration: 1};

	it('returns ordered row outcomes with actual dependency provenance and binding rollback', () => {
		const runtime = create(all);
		const captured = capture('---\nnumerals: all\n$derived: "$dv+1"\n$failed: "$temporary=9;missing"\n$constant: 5\n---', {
			engine: runtime, dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$dv: 2}},
		});
		const session = createMetadataSession(runtime, generation);
		const environment = session.createEnvironment('metadata');
		try {
			const outcomes = initializeMetadataEntries({engine: runtime, session, environment, entries: captured.entries,
				freshness: captured.freshness, preProcessors: []});
			expect(outcomes.map(outcome => [outcome.key, outcome.status])).toEqual([
				['$dv', 'committed'], ['$derived', 'committed'], ['$failed', 'discarded'], ['$constant', 'committed'],
			]);
			expect(outcomes[1].provenance.unverified).toEqual(['Dataview field $dv']);
			expect(outcomes[2].warnings[0]).toContain('Frontmatter: error evaluating "$failed"');
			expect(outcomes[3].provenance).toEqual({unverified: [], ambiguous: false});
			expect(session.copyBindings(environment).get('$derived')).toBe(3);
			expect(session.copyBindings(environment).has('$temporary')).toBe(false);
		} finally { session.retire(); }
	});

	it('records runtime effects after failed native evaluation and still initializes later rows', () => {
		const runtime = create(all);
		const captured = capture('---\n$effect: "config({precision:2});missing"\n$after: 5\n---', {engine: runtime});
		const session = createMetadataSession(runtime, generation);
		const environment = session.createEnvironment('metadata');
		try {
			const outcomes = initializeMetadataEntries({engine: runtime, session, environment, entries: captured.entries,
				freshness: captured.freshness, preProcessors: []});
			expect(outcomes.map(outcome => outcome.status)).toEqual(['discarded', 'committed']);
			expect(outcomes[0].provenance.ambiguous).toBe(true);
			expect(session.copyBindings(environment).has('$effect')).toBe(false);
			expect(session.copyBindings(environment).get('$after')).toBe(5);
			expect(runtime.config({}).precision).toBe(2);
			expect(runtimeSafetyEpoch(runtime)).toBeGreaterThan(0);
		} finally { session.retire(); }
	});

	it('discards rejected copy inputs without leaving an active row', () => {
		const runtime = create(all);
		const session = createMetadataSession(runtime, generation);
		const environment = session.createEnvironment('metadata');
		const cachedFunction = () => 9;
		try {
			const outcomes = initializeMetadataEntries({engine: runtime, session, environment, entries: [
				{key: '$bad', rawValue: cachedFunction, value: cachedFunction, provenance: 'native'},
				{key: '$good', rawValue: 5, value: 5, provenance: 'native'},
			], freshness: getMetadataFreshness(source('')), preProcessors: []});
			expect(outcomes.map(outcome => outcome.status)).toEqual(['discarded', 'committed']);
			expect(outcomes[0].warnings[0]).toContain('executable function');
			expect(session.copyBindings(environment).get('$good')).toBe(5);
		} finally { session.retire(); }
	});

	it('propagates cancellation after recording native effects and discarding staged bindings', () => {
		const runtime = create(all);
		const controller = new AbortController();
		const stop = jest.fn(() => { controller.abort(); return 0; });
		runtime.import({stop});
		const captured = capture('---\n$cancel: "config({precision:2});stop();$leaked=9"\n$never: "stop()"\n---', {engine: runtime});
		const session = createMetadataSession(runtime, generation);
		const environment = session.createEnvironment('metadata');
		try {
			expect(() => initializeMetadataEntries({engine: runtime, session, environment, entries: captured.entries,
				freshness: captured.freshness, preProcessors: [], signal: controller.signal})).toThrow('superseded');
			expect(stop).toHaveBeenCalledTimes(1);
			expect(session.copyBindings(environment).has('$leaked')).toBe(false);
			expect(runtimeSafetyEpoch(runtime)).toBeGreaterThan(0);
		} finally { session.retire(); }
	});
});

describe('Dataview page provenance and YAML quarantine', () => {
	it('never resurrects a deleted YAML dollar field or its canonical alias from a cached page', () => {
		const result = capture('---\nnumerals: all\ncurrent: 2\n---', {
			dataview: { status: 'projection', revision: 1, metadata: {
				$old: 10, old: 10, '$f(x)': 'x + 1', fx: 'x + 1', inline: [1, 3],
				file: { frontmatter: { $old: 10, '$f(x)': 'x + 1' } },
			} },
		});
		expect(values(result)).toEqual({ current: 2, inline: 3 });
		expect(result.quarantinedFields).toEqual(['$old', 'old', '$f(x)', 'fx']);
		expect(result.warnings).toHaveLength(4);
		expect(result.warnings[0]).toContain('"$old"');
		expect(result.warnings[0]).toContain('Refresh Dataview');
		expect(result.freshness).toMatchObject({ status: 'unverified', allowsAutomaticInsertion: false, projectionUsed: true });
	});

	it('keeps the current YAML field and suppresses all of its cached canonical variants', () => {
		const result = capture('---\nnumerals: all\n"$Hourly Rate": 5\n---', {
			dataview: { status: 'projection', revision: 1, metadata: {
				'$Hourly Rate': [4, 99], 'hourly-rate': 99, '$hourly-rate': 99,
				file: { frontmatter: { '$Hourly Rate': 4 } },
			} },
		});
		expect(values(result)).toEqual({ '$Hourly Rate': 5 });
		expect(result.entries[0].provenance).toBe('native');
	});

	it('quarantines the whole ambiguous overlay when a default page lacks its YAML key provenance', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', {
			dataview: { status: 'projection', revision: 1, metadata: { price: 90, $old: 10, extra: 8 } },
		});
		expect(values(result)).toEqual({ price: 2 });
		expect(result.quarantinedFields).toEqual(['$old', 'extra']);
		expect(result.warnings.every(warning => warning.includes('complete YAML key set'))).toBe(true);
		expect(result.freshness).toMatchObject({ status: 'unverified', projectionUsed: false, allowsAutomaticInsertion: false });
	});

	it.each([{ frontmatter: {} }, { frontmatter: [] }])('distinguishes known empty YAML provenance %j from missing provenance', ({ frontmatter }) => {
		const known = capture('No frontmatter', { dataview: {
			status: 'projection', revision: 1, metadata: { $inline: [1, 7], file: { frontmatter } },
		} });
		const unknown = capture('No frontmatter', { dataview: {
			status: 'projection', revision: 1, metadata: { $inline: [1, 7], file: {} },
		} });
		expect(values(known)).toEqual({ $inline: 7 });
		expect(known.quarantinedFields).toEqual([]);
		expect(values(unknown)).toEqual({});
		expect(unknown.quarantinedFields).toEqual(['$inline']);
	});

	it('reads complete raw mappings with null prototypes without reading their values', () => {
		const frontmatter: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		frontmatter.$old = 5;
		const result = capture('No YAML', { dataview: {
			status: 'projection', revision: 1, metadata: { $old: 5, $inline: 8, file: { frontmatter } },
		} });
		expect(values(result)).toEqual({ $inline: 8 });
		expect(result.quarantinedFields).toEqual(['$old']);
	});

	it('reads the documented legacy key/value list and quarantines its deleted keys', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', { dataview: {
			status: 'projection', revision: 1, metadata: { price: 40, $old: 5, old: 5, inline: [1, 9],
				file: { frontmatter: ['price | 40', '$old | 5'] } },
		} });
		expect(values(result)).toEqual({ price: 2, inline: 9 });
		expect(result.quarantinedFields).toEqual(['$old', 'old']);
	});

	it.each([null, undefined, 'key | 1', new Date(0), ['key | 1', 7], ['missing separator'],
		['ambiguous | key | value'], [' key | value'], [' | value']].map(frontmatter => ({ frontmatter })))('rejects an incomplete or ambiguous provenance shape %j', ({ frontmatter }) => {
		const result = capture('No YAML', { dataview: {
			status: 'projection', revision: 1, metadata: { $ambiguous: 5, file: { frontmatter } },
		} });
		expect(values(result)).toEqual({});
		expect(result.quarantinedFields).toEqual(['$ambiguous']);
	});

	it('never invokes getters on file, frontmatter, legacy list items, or YAML key values', () => {
		const accessor = jest.fn(() => ({}));
		const fileGetter = Object.defineProperty({ $inline: 8 }, 'file', { enumerable: true, get: accessor });
		const frontmatterGetter = { $inline: 8, file: Object.defineProperty({}, 'frontmatter', { get: accessor }) };
		const legacy = Object.defineProperty(['key | 2'], '0', { get: accessor });
		const raw = Object.defineProperty({}, '$key', { enumerable: true, get: accessor });
		for (const metadata of [fileGetter, frontmatterGetter, { $inline: 8, file: { frontmatter: legacy } },
			{ $inline: 8, file: { frontmatter: raw } }]) {
			const result = capture('No YAML', { dataview: { status: 'projection', revision: 1, metadata } });
			expect(values(result)).toEqual({});
			expect(result.quarantinedFields).toEqual(['$inline']);
		}
		expect(accessor).not.toHaveBeenCalled();
	});

	it('does not accept an inherited frontmatter field as complete provenance', () => {
		const file = Object.create({ frontmatter: {} }) as Record<string, unknown>;
		const result = capture('No YAML', { dataview: { status: 'projection', revision: 1, metadata: { $old: 4, file } } });
		expect(values(result)).toEqual({});
		expect(result.quarantinedFields).toEqual(['$old']);
	});

	it('permits separately captured inline fields while keeping YAML authoritative and insertion unavailable', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', { dataview: {
			status: 'projection', origin: 'inline-fields', revision: 1, metadata: { price: [1, 90], $inline: [2, 6], ordinary: [1, 3] },
		} });
		expect(values(result)).toEqual({ price: 2, $inline: 6, ordinary: 3 });
		expect(result.quarantinedFields).toEqual([]);
		expect(result.freshness).toMatchObject({ status: 'unverified', allowsAutomaticInsertion: false, projectionUsed: true });
	});

	it('can use exact buffer evidence for an otherwise known page without allowing it to overwrite YAML', () => {
		const buffer = source('---\nnumerals: all\nprice: 2\n---');
		const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 1 };
		const result = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview: {
			status: 'projection', revision: 1, evidence, metadata: { price: [1, 90], extra: [1, 4] },
		} });
		expect(values(result)).toEqual({ price: 2, extra: 4 });
		expect(result.quarantinedFields).toEqual([]);
		expect(result.freshness).toMatchObject({ status: 'verified', allowsAutomaticInsertion: true });
	});

	it('downgrades contradictory exact evidence when a page still contains deleted cached YAML fields', () => {
		const buffer = source('No YAML');
		const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 1 };
		const result = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview: {
			status: 'projection', revision: 1, evidence, metadata: { $old: 5, file: { frontmatter: { $old: 5 } } },
		} });
		expect(values(result)).toEqual({});
		expect(result.freshness).toMatchObject({ status: 'unverified', projectionUsed: false, allowsAutomaticInsertion: false });
	});
});

describe('metadata buffer freshness', () => {
	const buffer = source('---\nnumerals: all\nprice: 7\n---', 'edit-7');
	const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 'dv-7' };
	const projection: DataviewMetadataInput = { status: 'projection', revision: 'dv-7', metadata: { price: 7 }, evidence };

	it('is immediately native-ready when Dataview is absent', () => {
		expect(getMetadataFreshness(buffer)).toEqual({ status: 'native-ready', nativeReady: true, projectionUsed: false, allowsAutomaticInsertion: true });
		expect(getMetadataFreshness(buffer, { status: 'absent' }).status).toBe('native-ready');
	});

	it('keeps native inputs available during the bounded wait and after timeout', () => {
		const dataview: DataviewMetadataInput = { status: 'pending', startedAtMs: 100, maxWaitMs: 250 };
		const pending = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview, nowMs: 349 });
		const expired = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview, nowMs: 350 });
		expect(pending.freshness.status).toBe('pending');
		expect(pending.freshness.retryAtMs).toBe(350);
		expect(expired.freshness.status).toBe('unverified');
		expect(values(pending)).toEqual({ price: 7 });
		expect(values(expired)).toEqual({ price: 7 });
		expect(expired.freshness.allowsAutomaticInsertion).toBe(false);
	});

	it('never waits indefinitely on invalid clocks or an excessive requested wait', () => {
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0 }).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: NaN }, 1).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 100 }, 99).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0, maxWaitMs: Infinity }, 1).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0, maxWaitMs: 100000 }, 5000).status).toBe('unverified');
	});

	it('does not treat matching mtime/event/index revision signals as exact buffer proof', () => {
		expect(getMetadataFreshness(buffer, {
			status: 'projection', revision: buffer.revision, metadata: { price: 7 },
			invalidation: { mtimeMs: 7, metadataEventRevision: buffer.revision, indexRevision: buffer.revision },
		}, 7)).toMatchObject({ status: 'unverified', projectionUsed: true, allowsAutomaticInsertion: false });
	});

	it('accepts an explicitly attested exact capture and checks every source and projection identity', () => {
		expect(getMetadataFreshness(buffer, projection)).toMatchObject({ status: 'verified', allowsAutomaticInsertion: true });
		for (const changed of [
			{ sourceId: 'editor-B' }, { revision: 'edit-8' }, { path: 'Renamed.md' },
			{ text: buffer.text.replace('7', '8') }, { projectionRevision: 'dv-8' },
		]) {
			expect(getMetadataFreshness(buffer, { ...projection, evidence: { ...evidence, ...changed } }).status).toBe('unverified');
		}
	});
});
