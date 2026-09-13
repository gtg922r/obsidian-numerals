import { all, create, type MathJsInstance, type Matrix } from 'mathjs';
import { EvaluationSession, type CalculationEnvironment, type RowTransaction, type ValueProvenance } from '../../src/evaluation/session';
import { isVerifiedProvenance, mergeProvenance, VERIFIED_PROVENANCE } from '../../src/evaluation/provenance';

const generation = { sourceRevision: 'source:1', metadataGeneration: 'metadata:1', runtimeGeneration: 1 };
const dataview: ValueProvenance = { unverified: ['dataview:A.md:price'], ambiguous: false };

describe('private row input provenance', () => {
	let math: MathJsInstance;
	let session: EvaluationSession;
	let environment: CalculationEnvironment;

	beforeEach(() => {
		math = create(all);
		session = new EvaluationSession(generation, new Map([['$dv', 5]]), { seeds: new Map([['$dv', dataview]]) });
		environment = session.createEnvironment('block');
	});

	function row(source: string, target = environment, before?: () => void): { value: unknown; provenance: ValueProvenance } {
		const transaction = session.beginRow(target);
		try {
			before?.();
			const value: unknown = math.evaluate(source, target.scope);
			transaction.commit(value);
			return { value, provenance: transaction.provenance };
		} catch (error: unknown) {
			transaction.discard();
			throw error;
		}
	}

	function nativeContainer(value: unknown): Matrix {
		const result = math.matrix([0]);
		result.set([0], value);
		return result;
	}

	it('tracks actual Dataview reads without disabling independent constants and native scalars', () => {
		expect(row('1+2')).toEqual({ value: 3, provenance: VERIFIED_PROVENANCE });
		expect(row('$dv+2')).toEqual({ value: 7, provenance: dataview });
		expect(row('complex(1,2)').provenance).toEqual(VERIFIED_PROVENANCE);
		expect(row('unit("2 m")').provenance).toEqual(VERIFIED_PROVENANCE);
		expect(row('bignumber("1.234567890123456789")').provenance).toEqual(VERIFIED_PROVENANCE);
	});

	it('can initialize ordinary metadata without committing staged globals or changing their provenance', () => {
		row('$native=9');
		const transaction = session.beginRow(environment, {publishGlobals: false});
		const value: unknown = math.evaluate('local=($native=$dv); $new=2; local', environment.scope);
		expect(environment.scope.get('$native')).toBe(5);
		transaction.commit(value);
		expect(environment.scope.get('local')).toBe(5);
		expect(environment.scope.has('$new')).toBe(false);
		expect(row('$native')).toEqual({value: 9, provenance: VERIFIED_PROVENANCE});
		expect(row('local').provenance).toEqual(dataview);
	});

	it('does not count existence checks, key enumeration or orchestration copies as value reads', () => {
		const transaction = session.beginRow(environment);
		expect(environment.scope.has('$dv')).toBe(true);
		expect([...environment.scope.keys()]).toContain('$dv');
		expect(session.copyBindings(environment).get('$dv')).toBe(5);
		expect(session.copyGlobals().get('$dv')).toBe(5);
		expect(transaction.provenance).toEqual(VERIFIED_PROVENANCE);
		transaction.commit(3);
		expect(transaction.provenance).toEqual(VERIFIED_PROVENANCE);
	});

	it('attaches successful row reads to all new bindings and removes taint on a later scalar overwrite', () => {
		row('a=1; $export=$dv; b=2');
		expect(row('a').provenance).toEqual(dataview);
		expect(row('b').provenance).toEqual(dataview);
		expect(row('$export').provenance).toEqual(dataview);
		row('$export=8');
		expect(row('$export')).toEqual({ value: 8, provenance: VERIFIED_PROVENANCE });
		expect(row('$dv').provenance).toEqual(dataview);
	});

	it('rolls back failed binding provenance with the failed values', () => {
		row('$stable=2');
		const transaction = session.beginRow(environment);
		expect(() => math.evaluate('$stable=$dv; $added=$dv; missing', environment.scope)).toThrow('Undefined symbol missing');
		transaction.discard();
		expect(transaction.provenance).toEqual(dataview);
		expect(row('$stable')).toEqual({ value: 2, provenance: VERIFIED_PROVENANCE });
		expect(environment.scope.has('$added')).toBe(false);
	});

	it('keeps provenance on bindings when an independent overwrite has the identical scalar value', () => {
		row('$copied=$dv');
		row('$dv=5');
		expect(row('$dv')).toEqual({ value: 5, provenance: VERIFIED_PROVENANCE });
		expect(row('$copied')).toEqual({ value: 5, provenance: dataview });
	});

	it('collects seed reads through the function defining environment, not the caller locals', () => {
		const definition = session.createEnvironment('definition', new Map([['local', 7]]), new Map(), new Map([['local', dataview]]));
		const caller = session.createEnvironment('caller', new Map([['local', 999]]));
		row('$f(x)=local+x', definition);
		const call = row('$f(2)', caller);
		expect(call.value).toBe(9);
		expect(call.provenance.unverified).toEqual(dataview.unverified);
		expect(isVerifiedProvenance(call.provenance)).toBe(false);
	});

	it('resolves free dollar inputs at call time after verified overwrites', () => {
		row('$f(x)=x*$dv');
		row('$dv=3');
		const caller = session.createEnvironment('caller');
		expect(row('$f(2)', caller)).toEqual({ value: 6, provenance: VERIFIED_PROVENANCE });
	});

	it('retains captured factory arguments and aliases even when no free input is read during invocation', () => {
		row('maker(a)=inner(x)=a+x');
		const created = row('$f=maker($dv)');
		expect(created.provenance.unverified).toEqual(dataview.unverified);
		row('$dv=100');
		row('$alias=$f');
		const later = session.createEnvironment('later');
		const called = row('$alias(2)', later);
		expect(called.value).toBe(7);
		expect(called.provenance.unverified).toEqual(dataview.unverified);
		expect(called.provenance.ambiguous).toBe(true);
	});

	it('retains provenance on returned identities even when the result was not assigned to a binding', () => {
		const result = row('[$dv]');
		const transaction = session.beginRow(environment);
		environment.scope.set('$saved', result.value);
		transaction.commit();
		expect(row('$saved[1]').provenance.unverified).toEqual(dataview.unverified);
	});

	it('keeps explicit borrowed provenance dormant until the borrowed helper is read', () => {
		const unused = row('2+3', environment, () => {
			session.borrow(environment, '__prev', 5, dataview);
			session.borrow(environment, '__total', 6, { unverified: ['dataview:B.md:total'], ambiguous: false });
		});
		expect(unused.provenance).toEqual(VERIFIED_PROVENANCE);
		expect(row('__prev+1')).toEqual({ value: 6, provenance: dataview });
		expect(row('__total+1').provenance.unverified).toEqual(['dataview:B.md:total']);
	});

	it('does not stamp a borrowed verified helper with unrelated reads in its preparation row', () => {
		row('$dv', environment, () => session.borrow(environment, '__prev', 2, VERIFIED_PROVENANCE));
		expect(row('__prev')).toEqual({ value: 2, provenance: VERIFIED_PROVENANCE });
		const failed = session.beginRow(environment);
		session.borrow(environment, '__prev', 5, dataview);
		failed.discard();
		expect(row('__prev')).toEqual({ value: 2, provenance: VERIFIED_PROVENANCE });
	});

	it('records reference input provenance only when the defining reference adapter reads it', () => {
		const reference = { unverified: ['reference:Other.md:price'], ambiguous: false };
		const definition = session.createEnvironment('reference-definition');
		// An evaluator-owned callback represents D's read-only get hook. It retains
		// its defining reference context while callers use a different scope.
		const seed = session.beginRow(definition);
		definition.scope.set('reference', () => { session.recordInput(reference, 12); return 12; });
		seed.commit();
		row('$f(x)=reference()+x', definition);
		expect(row('1').provenance).toEqual(VERIFIED_PROVENANCE);
		const call = row('$f(2)');
		expect(call.value).toBe(14);
		expect(call.provenance.unverified).toEqual(reference.unverified);
	});

	it('conservatively invalidates sibling closures after an unverified opaque mutation, including failure', () => {
		row('holder={v:1}; reader(a)=read(x)=a.v+x; writer(a)=write(x)=(a.v=x); $read=reader(holder); $write=writer(holder); $stable=4');
		expect(row('$read(0)').provenance).toEqual(VERIFIED_PROVENANCE);
		const before = environment.scope.get('holder');
		expect(() => row('$write($dv); $stable=$dv; missing')).toThrow('Undefined symbol missing');
		expect(environment.scope.get('holder')).toBe(before);
		const called = row('$read(0)');
		expect(called.value).toBe(5); // Native mutation is not rolled back.
		expect(called.provenance.ambiguous).toBe(true);
		expect(called.provenance.unverified).toEqual(dataview.unverified);
		expect(row('$stable')).toEqual({ value: 4, provenance: VERIFIED_PROVENANCE });
		expect(row('9+1')).toEqual({ value: 10, provenance: VERIFIED_PROVENANCE });
		expect(row('complex(2,3)').provenance).toEqual(VERIFIED_PROVENANCE);
	});

	it('invalidates aliases when a collection accessor mutates without a binding write', () => {
		row('$object={v:1}; $alias=$object');
		row('$object.v=$dv');
		const result = row('$alias.v');
		expect(result.value).toBe(5);
		expect(result.provenance.ambiguous).toBe(true);
		expect(result.provenance.unverified).toEqual(dataview.unverified);
		row('$alias={v:9}');
		expect(row('$alias.v')).toEqual({ value: 9, provenance: VERIFIED_PROVENANCE });
	});

	it('finds an invalidated nested closure through a freshly copied plain collection borrow', () => {
		row('holder={v:1}; reader(a)=read(x)=a.v+x; writer(a)=write(x)=(a.v=x); $read=reader(holder); $write=writer(holder)');
		const captured = environment.scope.get('$read');
		row('$write($dv)');
		const copiedWrapper = { nested: [captured] };
		const called = row('__prev.nested[1](0)', environment,
			() => session.borrow(environment, '__prev', copiedWrapper, VERIFIED_PROVENANCE));
		expect(called.value).toBe(5);
		expect(called.provenance.ambiguous).toBe(true);
		expect(called.provenance.unverified).toEqual(dataview.unverified);
	});

	it('uses public native-container traversal to find old closures inside newly copied matrices', () => {
		session = new EvaluationSession(generation, new Map([['$dv', 5]]), {
			seeds: new Map([['$dv', dataview]]),
			children: value => {
				if (!math.isMatrix(value)) return undefined;
				const entries: unknown[] = [];
				value.forEach(entry => entries.push(entry));
				return entries;
			},
		});
		environment = session.createEnvironment('block');
		row('holder={v:1}; reader(a)=read(x)=a.v+x; writer(a)=write(x)=(a.v=x); $read=reader(holder); $write=writer(holder)');
		const captured = environment.scope.get('$read');
		row('$write($dv)');
		const copiedWrapper = nativeContainer(captured);
		const called = row('__prev[1](0)', environment,
			() => session.borrow(environment, '__prev', copiedWrapper, VERIFIED_PROVENANCE));
		expect(called.value).toBe(5);
		expect(called.provenance.ambiguous).toBe(true);
	});

	it('withholds opaque borrowed wrappers when traversal is unavailable, including a later effect in the same row', () => {
		row('holder={v:1}; reader(a)=read(x)=a.v+x; writer(a)=write(x)=(a.v=x); $read=reader(holder); $write=writer(holder)');
		const captured = environment.scope.get('$read');
		const copiedWrapper = nativeContainer(captured);
		const called = row('$write($dv); __prev[1](0)', environment,
			() => session.borrow(environment, '__prev', copiedWrapper, VERIFIED_PROVENANCE));
		expect(called.provenance.ambiguous).toBe(true);
		expect(called.provenance.unverified).toEqual(dataview.unverified);
		// A fresh unknown wrapper created after the opaque effect is also unsafe
		// to certify just because its older recorded row provenance was clean.
		const later = row('__prev[1](0)', environment,
			() => session.borrow(environment, '__prev', nativeContainer(captured), VERIFIED_PROVENANCE));
		expect(later.value).toBe(5);
		expect(later.provenance.ambiguous).toBe(true);
	});

	it('accepts a caller classifier without excluding functions from opaque invalidation', () => {
		// A frozen application value with no mutable children/methods can be
		// classified separately. Mutable Unit/Complex values get no exemption.
		const immutable = Object.freeze({ value: 1 });
		session = new EvaluationSession(generation, new Map<string, unknown>([['$dv', 5], ['$immutable', immutable]]), {
			seeds: new Map([['$dv', dataview]]),
			isOpaqueValue: value => value !== immutable && (typeof value === 'function' || value !== null && typeof value === 'object'),
		});
		environment = session.createEnvironment('block');
		row('$f(x)=x+1');
		row('$f($dv)');
		expect(row('$immutable.value').provenance).toEqual(VERIFIED_PROVENANCE);
		expect(row('$f(1)').provenance.ambiguous).toBe(true);
	});

	it('makes explicit engine-only effects ambiguous without contaminating independent primitive rows', () => {
		row('$f(x)=x+1');
		const failed = session.beginRow(environment);
		session.recordOpaqueEffect();
		expect(() => math.evaluate('createUnit("provenanceunit", "2 m"); missing', environment.scope)).toThrow('Undefined symbol missing');
		failed.discard();
		expect(failed.provenance.ambiguous).toBe(true);
		expect(row('$f(1)').provenance.ambiguous).toBe(true);
		expect(row('1+1').provenance).toEqual(VERIFIED_PROVENANCE);
		expect(math.number(math.unit('1 provenanceunit'), 'm')).toBe(2);
	});

	it('owns seed/borrow provenance arrays, merges identifiers and retains completed summaries', () => {
		const identifiers = ['z', 'a', 'z'];
		const merged = mergeProvenance({ unverified: identifiers, ambiguous: false }, dataview);
		identifiers.push('later');
		expect(merged.unverified).toEqual(['a', 'dataview:A.md:price', 'z']);
		expect(Object.isFrozen(merged.unverified)).toBe(true);
		let transaction: RowTransaction = session.beginRow(environment);
		session.recordInput(merged, 1);
		transaction.commit(1);
		const recorded = transaction.provenance;
		transaction = session.beginRow(environment);
		session.recordInput({ unverified: ['other'], ambiguous: false });
		transaction.discard();
		expect(recorded).toEqual(merged);
		session.retire();
		expect(transaction.provenance.unverified).toEqual(['other']);
		expect(() => session.recordInput(dataview)).toThrow('retired');
		expect(() => session.recordOpaqueEffect()).toThrow('retired');
		expect(() => session.borrow(environment, '__prev', 1, dataview)).toThrow('retired');
	});
});
