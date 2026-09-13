import { all, create, type BigNumber, type Matrix, type Unit } from 'mathjs';
import type { App } from 'obsidian';
import { activateMathRuntime, getMathRuntime } from '../../src/mathRuntime';
import { DEFAULT_SETTINGS, NumeralsScope } from '../../src/numerals.types';
import { getScopeFromFrontmatter } from '../../src/processing/scope';
import { mapSourceSpan } from '../../src/processing/expressionScanner';
import {
	cloneReferenceValue, createReferenceScope, evaluateWithReferences, isSupportedReferenceValue,
} from '../../src/processing/referenceBindings';
import {
	bindCrossNoteReferences, evaluateMetadataValue, resolveCrossNoteReferences, resolveSingleReference,
	type ResolvedReference,
} from '../../src/processing/crossNoteResolver';

const initialRuntime = getMathRuntime();
afterEach(() => activateMathRuntime(initialRuntime));

function host(frontmatter: Record<string, unknown>): App {
	return { metadataCache: {
		getFirstLinkpathDest: (name: string) => ({ path: `${name}.md` }),
		getFileCache: () => ({ frontmatter }),
	} } as unknown as App;
}

describe('reference scopes retain their owning runtime and inputs', () => {
	it('captures its default runtime once and keeps using it after the gateway changes', () => {
		const owning = create(all);
		const replacement = create(all);
		activateMathRuntime(owning);
		const value = owning.bignumber('1.23456789012345678901234567890123456789');
		const scope = createReferenceScope(new NumeralsScope(), new Map([['internal', value]]));
		activateMathRuntime(replacement);
		const usedReplacement = jest.spyOn(replacement, 'isBigNumber');
		const first = scope.get('internal') as BigNumber;
		const second = scope.get('internal') as BigNumber;
		expect(first).not.toBe(value);
		expect(second).not.toBe(first);
		expect(first.toString()).toBe(value.toString());
		expect(usedReplacement).not.toHaveBeenCalled();
	});

	it('reports each actual read before cloning and does not report keys or has checks as reads', () => {
		const runtime = create(all);
		const value = runtime.matrix([runtime.bignumber('1.234567890123456789')]);
		const onRead = jest.fn<void, [string, unknown]>();
		const scope = createReferenceScope(new NumeralsScope([['ordinary', 5]]), new Map([['internal', value]]), { runtime, onRead });
		expect([...scope.keys()]).toEqual(['ordinary', 'internal']);
		expect(scope.has('internal')).toBe(true);
		expect(scope.get('ordinary')).toBe(5);
		expect(onRead).not.toHaveBeenCalled();
		const first = scope.get('internal') as Matrix;
		expect(onRead).toHaveBeenLastCalledWith('internal', value);
		expect(first).not.toBe(value);
		first.set([0], 99);
		const second = scope.get('internal') as Matrix;
		expect(runtime.format(second.get([0]) as unknown)).toBe('1.234567890123456789');
		expect(onRead).toHaveBeenCalledTimes(2);
	});

	it('retains the defining table and read callback when exported closures are called through another scope', () => {
		const runtime = create(all);
		const shared = new NumeralsScope();
		const firstBindings = new Map<string, unknown>([['internalA', 2]]);
		const secondBindings = new Map<string, unknown>([['internalB', 5]]);
		const firstRead = jest.fn<void, [string, unknown]>();
		const secondRead = jest.fn<void, [string, unknown]>();
		const definition = createReferenceScope(shared, firstBindings, { runtime, onRead: firstRead });
		const caller = createReferenceScope(shared, secondBindings, { runtime, onRead: secondRead });
		evaluateWithReferences('$f(x) = internalA * x', definition, firstBindings, runtime);
		evaluateWithReferences('$g(x) = internalB * x', caller, secondBindings, runtime);
		firstBindings.set('internalA', 90);
		secondBindings.set('internalB', 99);
		activateMathRuntime(create(all));
		expect(evaluateWithReferences('$f(3) + $g(3)', caller, secondBindings, runtime)).toBe(21);
		expect(firstRead.mock.calls).toEqual([['internalA', 2]]);
		expect(secondRead.mock.calls).toEqual([['internalB', 5]]);
		expect(shared.has('internalA')).toBe(false);
		expect(shared.has('internalB')).toBe(false);
	});

	it('runs the read callback before attempting the clone', () => {
		const runtime = create(all);
		const order: string[] = [];
		const originalCheck = runtime.isComplex;
		jest.spyOn(runtime, 'isComplex').mockImplementation(value => { order.push('clone'); return originalCheck(value); });
		const scope = createReferenceScope(new NumeralsScope(), new Map([['internal', runtime.complex(2, 3)]]), {
			runtime, onRead: () => { order.push('read'); },
		});
		scope.get('internal');
		expect(order[0]).toBe('read');
		expect(order).toContain('clone');
	});

	it.each(['internal = 2', 'internal[1] = 2', 'internal(x) = x', 'f(internal) = 2'])(
		'preserves AST write protection using the injected parser for %s', source => {
			const runtime = create(all);
			const replacement = create(all);
			activateMathRuntime(replacement);
			const replacementParse = jest.spyOn(replacement, 'parse');
			const bindings = new Map([['internal', runtime.matrix([1, 2])]]);
			const scope = createReferenceScope(new NumeralsScope(), bindings, { runtime });
			expect(() => evaluateWithReferences(source, scope, bindings, runtime)).toThrow('Cannot assign to a cross-note reference');
			expect(replacementParse).not.toHaveBeenCalled();
		},
	);

	it('copies nested precision values through public constructors while keeping the reference whitelist', () => {
		const runtime = create(all);
		const precise = runtime.bignumber('1.23456789012345678901234567890123456789');
		const input = runtime.matrix([[precise, runtime.unit(precise, 'cm')]]);
		const result = cloneReferenceValue(input, runtime) as Matrix;
		expect(result).not.toBe(input);
		expect(result.get([0, 0])).not.toBe(precise);
		expect((result.get([0, 0]) as BigNumber).toString()).toBe(precise.toString());
		expect((result.get([0, 1]) as Unit).value).not.toBe((input.get([0, 1]) as Unit).value);
		result.set([0, 0], 99);
		expect(input.get([0, 0])).toBe(precise);
		const cyclic: unknown[] = [];
		cyclic.push(cyclic);
		for (const unsupported of [() => 1, { value: 2 }, [() => 1], cyclic]) {
			expect(isSupportedReferenceValue(unsupported, runtime)).toBe(false);
			expect(() => cloneReferenceValue(unsupported, runtime)).toThrow('cannot be exported');
		}
	});
});

describe('runtime-injected metadata and legacy host adapters', () => {
	it('evaluates source strings and function declarations in the injected unit registry', () => {
		const runtime = create(all);
		runtime.createUnit('runtimeReferenceUnit', '2 m');
		activateMathRuntime(create(all));
		const metadata = getScopeFromFrontmatter({ numerals: 'all', amount: '3 runtimeReferenceUnit', '$f(x)': 'x * amount' },
			undefined, false, [], false, runtime);
		expect(metadata.warnings).toEqual([]);
		expect((metadata.scope.get('amount') as Unit).toNumber('m')).toBe(6);
		expect((evaluateWithReferences('$f(2)', metadata.scope, new Map(), runtime) as Unit).toNumber('m')).toBe(12);
		expect((evaluateMetadataValue([1, '4 runtimeReferenceUnit'], [], runtime).result as Unit).toNumber('m')).toBe(8);
	});

	it('preserves legacy cached-function acceptance and keys-only calls', () => {
		const runtime = create(all);
		const cached = (value: number) => value + 1;
		const metadata = getScopeFromFrontmatter({ numerals: 'all', cached }, undefined, false, [], false, runtime);
		expect(metadata.scope.get('cached')).toBe(cached);
		const evaluate = jest.spyOn(runtime, 'evaluate');
		const keys = getScopeFromFrontmatter({ numerals: 'all', invalid: 'missing_function()' }, undefined, false, [], true, runtime);
		expect([...keys.scope]).toEqual([['invalid', undefined]]);
		expect(evaluate).not.toHaveBeenCalled();
	});

	it('passes the runtime through direct, nested, and complete host reference resolution', () => {
		const runtime = create(all);
		runtime.createUnit('runtimeHostUnit', '3 m');
		activateMathRuntime(create(all));
		const app = host({ numerals: 'all', amount: '2 runtimeHostUnit', nested: { amount: '4 runtimeHostUnit' } });
		const direct = resolveSingleReference({ fullMatch: '[[Data]].amount', noteName: 'Data', propertyPath: 'amount' },
			app, 'Note.md', DEFAULT_SETTINGS, [], runtime);
		const nested = resolveSingleReference({ fullMatch: '[[Data]].nested.amount', noteName: 'Data', propertyPath: 'nested.amount' },
			app, 'Note.md', DEFAULT_SETTINGS, [], runtime);
		expect(direct.status).toBe('resolved');
		expect((direct.value as Unit).toNumber('m')).toBe(6);
		expect((nested.value as Unit).toNumber('m')).toBe(12);
		const complete = resolveCrossNoteReferences('[[Data]].amount to m', app, 'Note.md', DEFAULT_SETTINGS, [], new Map(), runtime);
		expect(complete.error).toBeNull();
		const scope = createReferenceScope(new NumeralsScope(), complete.bindings, { runtime });
		expect((evaluateWithReferences(complete.resolvedSource, scope, complete.bindings, runtime) as Unit).toNumber('m')).toBe(6);
	});

	it('does not read host metadata when reference evaluation is disabled', () => {
		const app = new Proxy({} as App, { get() { throw new Error('Host must not be read'); } });
		const source = '[[Missing]].amount + 1';
		const result = resolveCrossNoteReferences(source, app, 'Note.md', { ...DEFAULT_SETTINGS, enableCrossNoteReferences: false }, [], new Map(), create(all));
		expect(result).toMatchObject({ resolvedSource: source, dependencies: [], referencedPaths: [], error: null });
		expect(result.bindings.size).toBe(0);
	});
});

describe('pure captured reference binding', () => {
	it('records every dependency and available binding despite missing, thrown, or unsupported values', () => {
		const runtime = create(all);
		const source = '[[first]].value + [[missing]].value + [[broken]].value + [[badtype]].value + [[last]].value';
		const resolver = jest.fn((reference: { noteName: string }): ResolvedReference => {
			switch (reference.noteName) {
				case 'first': return { status: 'resolved', referencedPath: 'first.md', value: -2 };
				case 'missing': return { status: 'missing-note' };
				case 'broken': throw new Error('provider unavailable');
				case 'badtype': return { status: 'resolved', referencedPath: 'badtype.md', value: () => 2 };
				default: return { status: 'resolved', referencedPath: 'last.md', value: runtime.complex(2, 3) };
			}
		});
		const result = bindCrossNoteReferences(source, 'Note.md', resolver, new Map(), runtime);
		expect(resolver).toHaveBeenCalledTimes(5);
		expect(result.dependencies.map(dependency => dependency.status)).toEqual(['resolved', 'missing-note', 'invalid-value', 'invalid-value', 'resolved']);
		expect(result.referencedPaths).toEqual(['first.md', 'badtype.md', 'last.md']);
		expect(result.dependencies[3].resolvedPath).toBe('badtype.md');
		expect(result.error).toContain('[[missing]].value');
		expect(result.bindings.size).toBe(2);
		expect([...result.bindingNames.values()]).toEqual(['[[first]].value', '[[last]].value']);
		for (const dependency of result.dependencies) {
			expect(source.slice(dependency.start, dependency.end)).toBe(dependency.fullMatch);
			expect(dependency.sourcePath).toBe('Note.md');
		}
		for (const [symbol, original] of result.bindingNames) {
			const start = result.resolvedSource.indexOf(symbol);
			const originalSpan = mapSourceSpan(result.sourceMap, { start, end: start + symbol.length });
			expect(source.slice(originalSpan.start, originalSpan.end)).toBe(original);
		}
	});

	it('detaches captured provider collections and preserves independent duplicate occurrences', () => {
		const runtime = create(all);
		const original = runtime.matrix([runtime.bignumber('1.234567890123456789')]);
		const result = bindCrossNoteReferences('[[Data]].value + [[Data]].value', 'Note.md',
			() => ({ status: 'resolved', referencedPath: 'Data.md', value: original }), new Map(), runtime);
		const [first, second] = [...result.bindings.values()] as Matrix[];
		expect(result.dependencies).toHaveLength(2);
		expect(result.bindings.size).toBe(2);
		expect(first).not.toBe(second);
		expect(first.get([0])).not.toBe(original.get([0]));
		first.set([0], 99);
		expect(runtime.format(original.get([0]) as unknown)).toBe('1.234567890123456789');
		expect(runtime.format(second.get([0]) as unknown)).toBe('1.234567890123456789');
	});

	it('keeps symbols monotonic and avoids both occupied scope names and original source names', () => {
		const runtime = create(all);
		const resolver = (): ResolvedReference => ({ status: 'resolved', value: 2 });
		const initial = bindCrossNoteReferences('[[Data]].value', 'Note.md', resolver, new Map(), runtime);
		const initialSymbol = [...initial.bindings.keys()][0];
		const nextIndex = Number(initialSymbol.replace('__numerals_ref_', '')) + 1;
		const occupied = `__numerals_ref_${nextIndex}`;
		const inSource = `__numerals_ref_${nextIndex + 1}`;
		const result = bindCrossNoteReferences(`${inSource} + [[Data]].value`, 'Note.md', resolver, new Map([[occupied, 9]]), runtime);
		const symbol = [...result.bindings.keys()][0];
		expect(symbol).not.toBe(occupied);
		expect(symbol).not.toBe(inSource);
		expect(Number(symbol.replace('__numerals_ref_', ''))).toBeGreaterThan(nextIndex + 1);
	});

	it('does not resolve literal strings/comments and preserves error-only resolver failures', () => {
		const resolver = jest.fn((): ResolvedReference => ({ status: 'resolved', value: 2, error: 'capture failed' }));
		const result = bindCrossNoteReferences('"[[literal]].value" + [[Data]].value # [[comment]].value', 'Note.md', resolver, new Map(), create(all));
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(result.bindings.size).toBe(0);
		expect(result.dependencies[0].status).toBe('invalid-value');
		expect(result.error).toBe('capture failed');
	});
});
