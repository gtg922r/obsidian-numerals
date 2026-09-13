import { all, create, MathJsInstance } from 'mathjs';
import { CalculationEnvironment, EvaluationSession } from '../../src/evaluation/session';
import { createReferenceScope } from '../../src/processing/referenceBindings';
import type { NumeralsScope } from '../../src/numerals.types';

const generation = { sourceRevision: 'source:1', metadataGeneration: 'metadata:1', runtimeGeneration: 1 };

describe('private note evaluation session', () => {
	let math: MathJsInstance;
	let session: EvaluationSession;

	beforeEach(() => {
		math = create(all);
		session = new EvaluationSession(generation);
	});

	function row(environment: CalculationEnvironment, source: string, scope: NumeralsScope = environment.scope): unknown {
		const transaction = session.beginRow(environment);
		try {
			const result: unknown = math.evaluate(source, scope);
			transaction.commit();
			return result;
		} catch (error: unknown) {
			transaction.discard();
			throw error;
		}
	}

	it('keeps defining block locals and reads the latest successful note globals', () => {
		const blockA = session.createEnvironment('block:A');
		const inlineA = session.createEnvironment('inline:A');
		const blockB = session.createEnvironment('block:B');
		const inlineB = session.createEnvironment('inline:B');
		row(blockA, '$rate=2; local=10; $f(x)=local+x*$rate');
		expect(row(inlineA, '$f(2)')).toBe(14);
		row(blockB, 'local=999; $rate=3');
		expect(row(inlineB, '$f(2)')).toBe(16);
		row(blockA, 'local=20');
		expect(row(inlineB, '$f(2)')).toBe(26);
		expect(blockB.scope.get('local')).toBe(999);
		expect(inlineB.scope.has('local')).toBe(false);
	});

	it('allows a dollar-prefixed function parameter to shadow a free global', () => {
		const definition = session.createEnvironment('definition');
		const caller = session.createEnvironment('caller');
		row(definition, '$rate=50; $f($rate)=$rate+1');
		expect(row(caller, '$f(2)')).toBe(3);
		expect(caller.scope.get('$rate')).toBe(50);
	});

	it('isolates ordinary inline and block assignments and rejects implicit forward references', () => {
		const first = session.createEnvironment('first');
		const second = session.createEnvironment('second');
		expect(() => row(first, '$future+1')).toThrow('Undefined symbol $future');
		row(second, '$future=4; local=10');
		expect(row(first, '$future+1')).toBe(5);
		expect(() => row(first, 'local')).toThrow('Undefined symbol local');
	});

	it('reads staged bindings within a semicolon row and commits hidden results', () => {
		const environment = session.createEnvironment('block');
		const visible = row(environment, '$a=2; b=$a+3; b') as { entries: unknown[] };
		expect(visible.entries).toEqual([5]);
		const hidden = row(environment, '$a=7; b=9;') as { entries: unknown[] };
		expect(hidden.entries).toEqual([]);
		expect(environment.scope.get('$a')).toBe(7);
		expect(environment.scope.get('b')).toBe(9);
	});

	it('discards new and replaced variable/function bindings from a failed row', () => {
		const block = session.createEnvironment('block');
		const later = session.createEnvironment('later');
		row(block, '$x=1; local=2; $f(x)=x+1');
		const originalFunction = block.scope.get('$f');
		expect(() => row(block, '$x=9; local=8; $new=7; $f(x)=x+99; missing')).toThrow('Undefined symbol missing');
		expect(row(later, '$x')).toBe(1);
		expect(row(later, '$f(2)')).toBe(3);
		expect(block.scope.get('local')).toBe(2);
		expect(block.scope.get('$f')).toBe(originalFunction);
		expect(later.scope.has('$new')).toBe(false);
	});

	it('rolls back bindings written in every defining scope reached by nested calls', () => {
		const definition = session.createEnvironment('definition');
		const caller = session.createEnvironment('caller');
		row(definition, 'local=1; $g=2; $setLocal(x)=(local=x); $inner(x)=($g=x); $outer(x)=$setLocal(x)+$inner(x)');
		row(caller, 'local=999');
		expect(() => row(caller, '$outer(10); missing')).toThrow('Undefined symbol missing');
		expect(definition.scope.get('local')).toBe(1);
		expect(caller.scope.get('local')).toBe(999);
		expect(caller.scope.get('$g')).toBe(2);
		expect(row(caller, '$outer(4)')).toBe(8);
		expect(definition.scope.get('local')).toBe(4);
		expect(caller.scope.get('$g')).toBe(4);
	});

	it('preserves aliases, function collections, recursion and higher-order callbacks', () => {
		const definition = session.createEnvironment('definition');
		const caller = session.createEnvironment('caller');
		row(definition, 'local=3; f(x)=x+local; $alias=f; $tools={read:f}; $factorial(n)=n<=1 ? 1 : n*$factorial(n-1)');
		expect(definition.scope.get('f')).toBe(definition.scope.get('$alias'));
		expect(row(caller, '$tools.read(2)')).toBe(5);
		expect(row(caller, '$factorial(5)')).toBe(120);
		const mapped = row(caller, 'map([1,2,3], $alias)') as { toArray(): unknown };
		expect(mapped.toArray()).toEqual([4, 5, 6]);
	});

	it('keeps the native object identity captured by a nested read-only factory', () => {
		const definition = session.createEnvironment('definition');
		const caller = session.createEnvironment('caller');
		row(definition, 'holder={v:1}; reader(a)=read(x)=a.v+x; $read=reader(holder)');
		const holder = definition.scope.get('holder');
		row(definition, 'holder.v=5');
		expect(definition.scope.get('holder')).toBe(holder);
		expect(row(caller, '$read(0)')).toBe(5);
	});

	it('keeps each exported function attached to its defining reference table', () => {
		const sourceBindings = new Map<string, unknown>([['__reference', math.complex(-2, 3)]]);
		const definition = session.createEnvironment('definition', new Map([['local', 1]]), sourceBindings);
		const caller = session.createEnvironment('caller', new Map(), new Map([['__reference', 999]]));
		const definingScope = createReferenceScope(definition.scope, definition.bindings);
		const callerScope = createReferenceScope(caller.scope, caller.bindings);
		row(definition, '$f(x)=__reference*x+local', definingScope);
		sourceBindings.set('__reference', 1000);
		expect(row(caller, '$f(2)', callerScope)).toEqual(math.complex(-3, 6));
		expect(row(caller, '__reference', callerScope)).toBe(999);
	});

	it('copies seed tables once while leaving value detachment to the boundary owner', () => {
		const object = { value: 1 };
		const dollarSeeds = new Map<string, unknown>([['$shared', object]]);
		session = new EvaluationSession(generation, dollarSeeds);
		const locals = new Map<string, unknown>([['local', 2]]);
		const first = session.createEnvironment('first', locals);
		const second = session.createEnvironment('second', locals);
		dollarSeeds.set('$shared', 999);
		locals.set('local', 999);
		expect(first.scope.get('$shared')).toBe(object);
		expect(second.scope.get('local')).toBe(2);
		row(first, 'local=3');
		expect(second.scope.get('local')).toBe(2);
	});

	it('evaluates metadata function declarations in the new owning environment', () => {
		const metadata = session.createEnvironment('metadata', new Map([['offset', 10]]));
		const caller = session.createEnvironment('caller', new Map([['offset', 999]]));
		row(metadata, '$rate=2; $f(x)=offset+x*$rate');
		expect(row(caller, '$f(2)')).toBe(14);
		const previousFunction = metadata.scope.get('$f');
		session.retire();
		session = new EvaluationSession({ ...generation, sourceRevision: 'source:2' });
		const newMetadata = session.createEnvironment('metadata', new Map([['offset', 20]]));
		row(newMetadata, '$rate=3; $f(x)=offset+x*$rate');
		expect(row(newMetadata, '$f(2)')).toBe(26);
		expect(newMetadata.scope.get('$f')).not.toBe(previousFunction);
	});

	it('starts a new generation with no removed values or functions', () => {
		const oldEnvironment = session.createEnvironment('block');
		row(oldEnvironment, '$value=2; $f(x)=x+$value');
		const oldFunction = oldEnvironment.scope.get('$f') as (value: number) => number;
		session.retire();
		session = new EvaluationSession({ ...generation, sourceRevision: 'source:2' });
		const freshEnvironment = session.createEnvironment('block');
		expect(freshEnvironment.scope.size).toBe(0);
		expect(() => row(freshEnvironment, '$f(1)')).toThrow();
		expect(() => oldFunction(1)).toThrow('Evaluation session is retired');
	});

	it('enumerates effective bindings through every Map operation', () => {
		session = new EvaluationSession(generation, new Map([['$global', 1]]));
		const environment = session.createEnvironment('block', new Map([['local', 2]]));
		const scope: NumeralsScope = environment.scope;
		const transaction = session.beginRow(environment);
		expect(scope.set('$added', 3).set('undefined', undefined)).toBe(scope);
		expect(scope.has('undefined')).toBe(true);
		expect(scope.size).toBe(4);
		expect([...scope.keys()]).toEqual(['$global', '$added', 'local', 'undefined']);
		expect([...scope.values()]).toEqual([1, 3, 2, undefined]);
		expect([...scope]).toEqual([...scope.entries()]);
		expect(Object.fromEntries(scope)).toEqual({ $global: 1, $added: 3, local: 2, undefined: undefined });
		const receiver = { entries: [] as [string, unknown][] };
		scope.forEach(function (this: typeof receiver, value, key, callbackScope) {
			expect(callbackScope).toBe(scope);
			this.entries.push([key, value]);
		}, receiver);
		expect(receiver.entries).toEqual([...scope]);
		transaction.commit();
		expect(session.copyBindings(environment)).toEqual(new Map(scope));
		expect(session.copyGlobals()).toEqual(new Map([['$global', 1], ['$added', 3]]));
	});

	it('stages delete/clear over both frames and preserves deletion/reinsertion order', () => {
		session = new EvaluationSession(generation, new Map([['$a', 1], ['$b', 2]]));
		const environment = session.createEnvironment('block', new Map([['a', 1], ['b', 2]]));
		const other = session.createEnvironment('other', new Map([['own', 3]]));
		const first = session.beginRow(environment);
		expect(environment.scope.delete('$a')).toBe(true);
		expect(environment.scope.delete('$a')).toBe(false);
		environment.scope.set('$a', 3);
		environment.scope.delete('a');
		environment.scope.set('a', 4);
		expect([...environment.scope.keys()]).toEqual(['$b', '$a', 'b', 'a']);
		first.commit();
		expect([...environment.scope.keys()]).toEqual(['$b', '$a', 'b', 'a']);
		const second = session.beginRow(environment);
		environment.scope.clear();
		expect(environment.scope.size).toBe(0);
		expect([...other.scope]).toEqual([['own', 3]]);
		second.discard();
		expect(environment.scope.size).toBe(4);
		const third = session.beginRow(environment);
		environment.scope.clear();
		third.commit();
		expect(environment.scope.size).toBe(0);
		expect([...other.scope]).toEqual([['own', 3]]);
	});

	it('returns separate private binding tables without claiming to clone their values', () => {
		const environment = session.createEnvironment('block');
		row(environment, '$object={value:1}');
		const copied = session.copyBindings(environment);
		expect(copied.get('$object')).toBe(environment.scope.get('$object'));
		copied.delete('$object');
		expect(environment.scope.has('$object')).toBe(true);
	});

	it('rejects nested rows, duplicate environments, foreign environments and writes outside rows', () => {
		const environment = session.createEnvironment('block');
		expect(() => session.createEnvironment('block')).toThrow('already exists');
		expect(() => environment.scope.set('a', 1)).toThrow('active evaluation row');
		expect(() => environment.scope.delete('a')).toThrow('active evaluation row');
		const foreign = new EvaluationSession(generation).createEnvironment('block');
		expect(() => session.beginRow(foreign)).toThrow('another evaluation session');
		expect(() => session.copyBindings(foreign)).toThrow('another evaluation session');
		const first = session.beginRow(environment);
		expect(() => session.beginRow(environment)).toThrow('already active');
		expect(() => session.createEnvironment('during-row')).toThrow('during a row');
		first.discard();
		const second = session.beginRow(environment);
		expect(() => first.commit()).toThrow('no longer active');
		expect(() => first.discard()).toThrow('no longer active');
		second.commit();
	});

	it('rejects misrouted metadata seeds rather than resetting shared globals per calculation', () => {
		expect(() => new EvaluationSession(generation, new Map([['ordinary', 1]]))).toThrow('dollar-prefixed globals');
		expect(() => session.createEnvironment('block', new Map([['$global', 1]]))).toThrow('ordinary local names');
		const identity = { ...generation };
		const owned = new EvaluationSession(identity);
		identity.sourceRevision = 'modified';
		expect(owned.generation.sourceRevision).toBe('source:1');
	});

	it('retires active transactions, existing iterators and all scope access', () => {
		const environment = session.createEnvironment('block', new Map([['a', 1], ['b', 2]]));
		const iterator = environment.scope.entries();
		expect(iterator.next().value).toEqual(['a', 1]);
		const transaction = session.beginRow(environment);
		environment.scope.set('$staged', 3);
		session.retire();
		session.retire();
		expect(session.isRetired).toBe(true);
		const guarded: (() => unknown)[] = [
			() => environment.scope.get('a'),
			() => environment.scope.has('a'),
			() => environment.scope.set('a', 1),
			() => environment.scope.delete('a'),
			() => environment.scope.clear(),
			() => environment.scope.size,
			() => [...environment.scope.keys()],
			() => [...environment.scope.values()],
			() => [...environment.scope.entries()],
			() => [...environment.scope],
			() => environment.scope.forEach(() => undefined),
			() => iterator.next(),
			() => session.createEnvironment('new'),
			() => session.beginRow(environment),
			() => session.copyBindings(environment),
			() => session.copyGlobals(),
			() => transaction.commit(),
			() => transaction.discard(),
		];
		for (const operation of guarded) expect(operation).toThrow('Evaluation session is retired');
	});

	describe('explicit binding-only rollback limits', () => {
		it('does not roll back native accessor mutation in a failed row', () => {
			const definition = session.createEnvironment('definition');
			const caller = session.createEnvironment('caller');
			row(definition, '$object={v:1}; $binding=1');
			expect(() => row(caller, '$object.v=2; $binding=2; missing')).toThrow('Undefined symbol missing');
			expect(row(caller, '$object.v')).toBe(2);
			expect(row(caller, '$binding')).toBe(1);
		});

		it('cannot undo opaque captured-object mutation when a nested function fails', () => {
			const definition = session.createEnvironment('definition');
			const caller = session.createEnvironment('caller');
			row(definition, 'maker(a)=inner(x)=(a.v=a.v+x); $inc=maker({v:1})');
			expect(() => row(caller, '$inc(2)+missing')).toThrow('Undefined symbol missing');
			expect(row(caller, '$inc(0)')).toBe(3);
			const opaque = caller.scope.get('$inc') as (value: number) => number;
			session.retire();
			// No free scope access occurs in this closure. Retirement is an ownership
			// boundary, not a promise to revoke executable functions leaked to callers.
			expect(opaque(0)).toBe(3);
		});

		it('preserves createUnit side effects and reports the subsequent collision', () => {
			const environment = session.createEnvironment('block');
			expect(() => row(environment, 'createUnit("failedrowunit", "2 m"); missing')).toThrow('Undefined symbol missing');
			expect(math.number(math.unit('1 failedrowunit'), 'm')).toBe(2);
			expect(() => row(environment, 'createUnit("failedrowunit", "2 m")')).toThrow('already exists');
		});
	});
});
