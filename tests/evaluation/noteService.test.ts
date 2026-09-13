import { all, create } from 'mathjs';
import type { ResultFormatter } from '../../src/formatting/types';
import {
	NoteEvaluationService, type NoteServiceAdapter, type NoteServiceInput, type NoteServiceState,
} from '../../src/evaluation/noteService';
import { createNoteSnapshot, type NoteGeneration, type NoteSnapshot } from '../../src/evaluation/noteSnapshot';

interface FakeInput extends NoteServiceInput {
	readonly payload: { values: number[] };
}

const engine = create(all);
const replacementEngine = create(all);
const formatter = presentation('first:');

function presentation(prefix: string): ResultFormatter {
	return { format: (value: unknown) => ({ text: `${prefix}${String(value)}`, tex: String(value), canonical: String(value) }) };
}

function input(changes: Partial<NoteGeneration> = {}): FakeInput {
	return {
		generation: {
			sourceId: 'editor-A', sourcePath: 'Costs.md', sourceRevision: 1, sourceText: '`#: 2`',
			metadataRevision: 'metadata-1', dependencyRevision: 'dependencies-1',
			evaluationSettingsRevision: 'settings-1', runtimeGeneration: 1, ...changes,
		},
		runtime: { engine, formatter }, payload: { values: [2] },
	};
}

function snapshot(request: FakeInput, metadataStatus: NoteSnapshot['metadataStatus'] = 'native-ready'): NoteSnapshot {
	return createNoteSnapshot({
		generation: request.generation,
		calculations: [{
			calculationId: 'calculation-1', kind: 'inline', span: { start: 0, end: request.generation.sourceText.length },
			dependencies: [], rows: [{ rowIndex: 0, input: '2', processedInput: '2',
				sourceSpans: [{ start: 4, end: 5 }], value: request.payload.values[0], insertion: {canInsert: true} }],
		}],
		diagnostics: [], symbols: [], metadataStatus,
	}, request.runtime.engine, request.runtime.formatter);
}

function harness() {
	const capture = jest.fn((request: FakeInput): FakeInput => ({
		generation: { ...request.generation }, runtime: { ...request.runtime },
		payload: { values: [...request.payload.values] },
	}));
	const evaluate = jest.fn<ReturnType<NoteServiceAdapter<FakeInput>['evaluate']>, [FakeInput, AbortSignal]>(request => snapshot(request));
	const onSubscriberError = jest.fn<void, [unknown]>();
	const service = new NoteEvaluationService({ capture, evaluate, onSubscriberError });
	return { service, capture, evaluate, onSubscriberError };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
	return { promise, resolve, reject };
}

describe('complete note generation identity', () => {
	it('includes own-note metadata and path changes even without cross-note references', async () => {
		const {service} = harness();
		await service.request(input());
		await service.request(input({sourceId: 'editor-B'}));
		expect(service.sourcesAffectedBy({kind: 'metadata', path: 'Costs.md'})).toEqual(['editor-A', 'editor-B']);
		expect(service.sourcesAffectedBy({kind: 'rename', oldPath: 'Costs.md', path: 'Renamed.md'})).toEqual(['editor-A', 'editor-B']);
		expect(service.sourcesAffectedBy({kind: 'delete', path: 'Costs.md'})).toEqual(['editor-A', 'editor-B']);
		expect(service.sourcesAffectedBy({kind: 'metadata', path: 'Other.md'})).toEqual([]);
	});
	it('returns actionable invalid-settings diagnostics without mathematical evaluation and recovers on repair', async () => {
		const {service, evaluate} = harness();
		const inaccessibleEngine = new Proxy(engine, { get() { throw new Error('Blocked engine must not be used'); } });
		const broken: FakeInput = {...input(), runtime: {engine: inaccessibleEngine, formatter,
			configurationError: 'Currency mapping is invalid. Open Numerals settings to edit or remove the mapping.'}};
		const blocked = await service.request(broken);
		expect(evaluate).not.toHaveBeenCalled();
		expect(blocked?.canInsert).toBe(false);
		expect(blocked?.diagnostics).toEqual([{kind: 'configuration', message: broken.runtime.configurationError}]);
		expect((await service.request(input({runtimeGeneration: 2})))?.calculations[0].rows[0].result).toBe(2);
		expect(evaluate).toHaveBeenCalledTimes(1);
	});
	it.each([
		['sourceRevision', 2], ['sourceText', '`#: 20`'], ['sourcePath', 'Renamed.md'],
		['metadataRevision', 'metadata-2'], ['dependencyRevision', 'dependencies-2'],
		['evaluationSettingsRevision', 'settings-2'], ['runtimeGeneration', 2],
	] as const)('reevaluates when %s changes', async (field, value) => {
		const { service, evaluate } = harness();
		const first = await service.request(input());
		const nextInput = input({ [field]: value });
		nextInput.payload.values[0] = 20;
		const next = await service.request(nextInput);
		expect(evaluate).toHaveBeenCalledTimes(2);
		expect(first?.calculations[0].rows[0].result).toBe(2);
		expect(next?.calculations[0].rows[0].result).toBe(20);
		expect(next?.generation[field]).toBe(value);
	});

	it('keeps different buffers for the same path independent', async () => {
		const { service, evaluate } = harness();
		const other = input({ sourceId: 'editor-B' });
		other.payload.values[0] = 8;
		const first = await service.request(input());
		const second = await service.request(other);
		expect(first?.generation.sourcePath).toBe(second?.generation.sourcePath);
		expect(service.current('editor-A')).toEqual({ status: 'ready', snapshot: first });
		expect(service.current('editor-B')).toEqual({ status: 'ready', snapshot: second });
		expect(await service.request(input())).toBe(first);
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('reevaluates for a new engine identity even if the runtime generation number is reused', async () => {
		const { service, evaluate } = harness();
		await service.request(input());
		const next = input();
		const changedRuntime = { ...next, runtime: { ...next.runtime, engine: replacementEngine } };
		const result = await service.request(changedRuntime);
		expect(evaluate).toHaveBeenCalledTimes(2);
		expect(evaluate.mock.calls[1][0].runtime.engine).toBe(replacementEngine);
		expect(result?.generation.runtimeGeneration).toBe(1);
	});

	it('deduplicates identical pending and ready requests', async () => {
		const { service, evaluate } = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValue(evaluation.promise);
		const first = service.request(input());
		const duplicate = service.request(input());
		expect(duplicate).toBe(first);
		await Promise.resolve();
		expect(evaluate).toHaveBeenCalledTimes(1);
		evaluation.resolve(snapshot(input()));
		const result = await first;
		expect(await duplicate).toBe(result);
		expect(await service.request(input())).toBe(result);
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('captures input synchronously and evaluates its detached source and payload after mutations', async () => {
		const { service, capture, evaluate } = harness();
		const original = input();
		const generation = { ...original.generation };
		const runtime = { ...original.runtime };
		const request = { ...original, generation, runtime };
		const barrier = deferred<void>();
		evaluate.mockImplementation(async captured => { await barrier.promise; return snapshot(captured); });
		const resultPromise = service.request(request);
		expect(capture).toHaveBeenCalledTimes(1);
		expect(evaluate).not.toHaveBeenCalled();
		generation.sourceText = 'mutated before evaluate';
		generation.metadataRevision = 'mutated';
		request.payload.values[0] = 90;
		runtime.formatter = presentation('mutated:');
		await Promise.resolve();
		request.payload.values.push(99);
		barrier.resolve();
		const result = await resultPromise;
		expect(result?.generation.sourceText).toBe('`#: 2`');
		expect(result?.generation.metadataRevision).toBe('metadata-1');
		expect(evaluate.mock.calls[0][0].payload.values).toEqual([2]);
		expect(result?.format('calculation-1', 0)).toMatchObject({ value: { text: 'first:2' } });
	});
});

describe('async generation ownership and cancellation', () => {
	it.each(['resolve', 'reject'] as const)('discards obsolete async %s without replacing newer state', async outcome => {
		const { service, evaluate } = harness();
		const oldEvaluation = deferred<NoteSnapshot>();
		const newEvaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValueOnce(oldEvaluation.promise).mockReturnValueOnce(newEvaluation.promise);
		const listener = jest.fn<void, [NoteServiceState]>();
		service.subscribe('editor-A', listener);
		const oldRequest = service.request(input());
		await Promise.resolve();
		const oldSignal = evaluate.mock.calls[0][1];
		const currentInput = input({ sourceRevision: 2 });
		const currentRequest = service.request(currentInput);
		expect(oldSignal.aborted).toBe(true);
		await Promise.resolve();
		newEvaluation.resolve(snapshot(currentInput));
		const current = await currentRequest;
		if (outcome === 'resolve') oldEvaluation.resolve(snapshot(input()));
		else oldEvaluation.reject(new Error('obsolete failure'));
		expect(await oldRequest).toBeUndefined();
		expect(service.current('editor-A')).toEqual({ status: 'ready', snapshot: current });
		expect(listener.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'pending', 'ready']);
	});

	it('cancels a superseded request before its evaluation starts', async () => {
		const { service, evaluate } = harness();
		const old = service.request(input());
		const current = service.request(input({ sourceRevision: 2 }));
		expect(await old).toBeUndefined();
		expect((await current)?.generation.sourceRevision).toBe(2);
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('invalidates an active buffer, aborts its work, and allows a fresh request', async () => {
		const { service, evaluate } = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValueOnce(evaluation.promise);
		const pending = service.request(input());
		await Promise.resolve();
		service.invalidate('editor-A');
		expect(evaluate.mock.calls[0][1].aborted).toBe(true);
		expect(service.current('editor-A')).toBeUndefined();
		evaluation.resolve(snapshot(input()));
		expect(await pending).toBeUndefined();
		expect(await service.request(input())).toBeDefined();
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('disposes all pending buffers and publishes no late completion', async () => {
		const { service, evaluate } = harness();
		const firstEvaluation = deferred<NoteSnapshot>();
		const secondEvaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValueOnce(firstEvaluation.promise).mockReturnValueOnce(secondEvaluation.promise);
		const listener = jest.fn();
		const unsubscribe = service.subscribe('editor-A', listener);
		const first = service.request(input());
		const secondInput = input({ sourceId: 'editor-B' });
		const second = service.request(secondInput);
		await Promise.resolve();
		service.dispose();
		service.dispose();
		unsubscribe();
		expect(evaluate.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
		firstEvaluation.resolve(snapshot(input()));
		secondEvaluation.reject(new Error('cancelled second buffer'));
		expect(await first).toBeUndefined();
		expect(await second).toBeUndefined();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(() => service.request(input())).toThrow('disposed');
		expect(() => service.current('editor-A')).toThrow('disposed');
		expect(() => service.subscribe('editor-A', listener)).toThrow('disposed');
		expect(() => service.updatePresentation('editor-A', input().runtime)).toThrow('disposed');
		expect(() => service.invalidate('editor-A')).toThrow('disposed');
	});

	it('publishes current evaluation failures and permits retrying their generation', async () => {
		const { service, evaluate } = harness();
		evaluate.mockRejectedValueOnce(new Error('reference unavailable'));
		await expect(service.request(input())).rejects.toThrow('reference unavailable');
		expect(service.current('editor-A')).toMatchObject({ status: 'error', message: 'reference unavailable' });
		expect(await service.request(input())).toBeDefined();
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('rejects an evaluator snapshot belonging to a different generation', async () => {
		const { service, evaluate } = harness();
		evaluate.mockReturnValueOnce(snapshot(input({ sourceText: 'a different buffer' })));
		await expect(service.request(input())).rejects.toThrow('different note generation');
		expect(service.current('editor-A')).toMatchObject({ status: 'error' });
	});

	it('returns no obsolete snapshot when a ready subscriber immediately supersedes its generation', async () => {
		const { service } = harness();
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && state.snapshot.generation.sourceRevision === 1) {
				replacement = service.request(input({ sourceRevision: 2 }));
			}
		});
		expect(await service.request(input())).toBeUndefined();
		expect((await replacement)?.generation.sourceRevision).toBe(2);
	});

	it('discards an error when an error subscriber immediately supersedes its generation', async () => {
		const { service, evaluate } = harness();
		evaluate.mockRejectedValueOnce(new Error('superseded failure'));
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (state.status === 'error') replacement = service.request(input({ sourceRevision: 2 }));
		});
		const outcome = await service.request(input()).then(value => ({ value }), (error: unknown) => ({ error }));
		expect((await replacement)?.generation.sourceRevision).toBe(2);
		expect(outcome).toEqual({ value: undefined });
	});
});

describe('presentation reuse without mathematical evaluation', () => {
	it('returns the current snapshot when a ready subscriber immediately reformats it', async () => {
		const {service, evaluate} = harness();
		let updated = false;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && !updated) {
				updated = true;
				service.updatePresentation('editor-A', {engine, formatter: presentation('second:')});
			}
		});
		const result = await service.request(input());
		const current = service.current('editor-A');
		expect(current?.status).toBe('ready');
		if (current?.status === 'ready') expect(result).toBe(current.snapshot);
		expect(result?.format('calculation-1', 0)).toMatchObject({value: {text: 'second:2'}});
		expect(evaluate).toHaveBeenCalledTimes(1);
	});
	it('reformats retained values on explicit updates and identical generation requests', async () => {
		const { service, evaluate } = harness();
		const original = await service.request(input());
		const secondFormatter = presentation('second:');
		const second = service.updatePresentation('editor-A', { engine, formatter: secondFormatter });
		expect(second?.format('calculation-1', 0)).toMatchObject({ value: { text: 'second:2' } });
		expect(original?.format('calculation-1', 0)).toMatchObject({ value: { text: 'first:2' } });
		const third = await service.request({ ...input(), runtime: { engine, formatter: presentation('third:') } });
		expect(third?.format('calculation-1', 0)).toMatchObject({ value: { text: 'third:2' } });
		third?.symbolsAt(0);
		service.current('editor-A');
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('discards a cached request superseded during its presentation notification', async () => {
		const { service, evaluate } = harness();
		await service.request(input());
		let armed = false;
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (armed && state.status === 'ready' && state.snapshot.generation.sourceRevision === 1) {
				armed = false;
				replacement = service.request(input({ sourceRevision: 2 }));
			}
		});
		armed = true;
		const cached = service.request({ ...input(), runtime: { engine, formatter: presentation('new:') } });
		expect(await cached).toBeUndefined();
		const current = await replacement;
		expect(current?.generation.sourceRevision).toBe(2);
		expect(service.current('editor-A')).toEqual({ status: 'ready', snapshot: current });
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('requires a new request for configuration-error changes even when the engine is unchanged', async () => {
		const { service, evaluate } = harness();
		await service.request(input());
		const brokenRuntime = { engine, formatter: presentation('new:'), configurationError: 'Invalid currency mapping' };
		expect(() => service.updatePresentation('editor-A', brokenRuntime)).toThrow('Configuration changes require a new evaluation generation');
		const blocked = await service.request({ ...input(), runtime: brokenRuntime });
		expect(blocked?.diagnostics).toEqual([{ kind: 'configuration', message: 'Invalid currency mapping' }]);
		expect(blocked?.canInsert).toBe(false);
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(() => service.updatePresentation('editor-A', input().runtime)).toThrow('Configuration changes require a new evaluation generation');
		expect((await service.request(input()))?.calculations[0].rows[0].result).toBe(2);
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it('applies the latest presentation while pending without restarting or duplicating evaluation', async () => {
		const { service, evaluate } = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValue(evaluation.promise);
		const pending = service.request(input());
		await Promise.resolve();
		expect(service.updatePresentation('editor-A', { engine, formatter: presentation('second:') })).toBeUndefined();
		const duplicate = service.request({ ...input(), runtime: { engine, formatter: presentation('latest:') } });
		expect(duplicate).toBe(pending);
		expect(evaluate.mock.calls[0][1].aborted).toBe(false);
		evaluation.resolve(snapshot(input()));
		const result = await pending;
		expect(result?.format('calculation-1', 0)).toMatchObject({ value: { text: 'latest:2' } });
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('rejects replacing the engine through a presentation operation', async () => {
		const { service, evaluate } = harness();
		await service.request(input());
		expect(() => service.updatePresentation('editor-A', { engine: replacementEngine, formatter })).toThrow('new evaluation generation');
		expect(service.updatePresentation('unknown-buffer', { engine, formatter })).toBeUndefined();
		expect(evaluate).toHaveBeenCalledTimes(1);
	});
});

describe('per-buffer service subscriptions', () => {
	it.each(['pending', 'ready'] as const)('does not call a subscription removed during %s publication', async phase => {
		const {service} = harness();
		let removeLater!: () => void;
		service.subscribe('editor-A', state => { if (state.status === phase) removeLater(); });
		const later = jest.fn<void, [NoteServiceState]>();
		removeLater = service.subscribe('editor-A', later);
		await service.request(input());
		expect(later.mock.calls.map(([state]) => state.status)).toEqual(phase === 'pending' ? [] : ['pending']);
	});

	it('owns duplicate callback registrations independently, including idempotent removal', async () => {
		const {service} = harness();
		const callback = jest.fn<void, [NoteServiceState]>();
		const removeFirst = service.subscribe('editor-A', callback);
		const removeSecond = service.subscribe('editor-A', callback);
		await service.request(input());
		expect(callback.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'pending', 'ready', 'ready']);
		callback.mockClear();
		removeFirst();
		removeFirst();
		await service.request(input({sourceRevision: 2}));
		expect(callback.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
		callback.mockClear();
		removeSecond();
		await service.request(input({sourceRevision: 3}));
		expect(callback).not.toHaveBeenCalled();
	});

	it('does not deliver an obsolete state after an earlier listener publishes a newer generation', async () => {
		const { service } = harness();
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && state.snapshot.generation.sourceRevision === 1) {
				replacement = service.request(input({ sourceRevision: 2 }));
			}
		});
		const observed: string[] = [];
		service.subscribe('editor-A', state => {
			const generation = state.status === 'ready' ? state.snapshot.generation : state.generation;
			observed.push(`${state.status}:${generation.sourceRevision}`);
		});
		await service.request(input());
		await replacement;
		expect(observed).toEqual(['pending:1', 'pending:2', 'ready:2']);
	});

	it('delivers a current state once to a listener added inside a publication callback', async () => {
		const { service } = harness();
		const added = jest.fn<void, [NoteServiceState]>();
		service.subscribe('editor-A', state => {
			if (state.status === 'pending') service.subscribe('editor-A', added);
		});
		await service.request(input());
		expect(added.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
	});

	it('replays current state once and unsubscribes independently of other listeners or buffers', async () => {
		const { service } = harness();
		const first = jest.fn<void, [NoteServiceState]>();
		const second = jest.fn<void, [NoteServiceState]>();
		const otherBuffer = jest.fn<void, [NoteServiceState]>();
		const unsubscribe = service.subscribe('editor-A', first);
		service.subscribe('editor-B', otherBuffer);
		await service.request(input());
		service.subscribe('editor-A', second);
		expect(second.mock.calls.map(([state]) => state.status)).toEqual(['ready']);
		unsubscribe();
		await service.request(input({ sourceRevision: 2 }));
		expect(first.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
		expect(second.mock.calls.map(([state]) => state.status)).toEqual(['ready', 'pending', 'ready']);
		expect(otherBuffer).not.toHaveBeenCalled();
	});

	it('keeps unsubscribe idempotent after a new subscription replaces an empty listener set', async () => {
		const { service } = harness();
		const unsubscribe = service.subscribe('editor-A', jest.fn());
		unsubscribe();
		const replacement = jest.fn<void, [NoteServiceState]>();
		service.subscribe('editor-A', replacement);
		unsubscribe();
		await service.request(input());
		expect(replacement.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
	});

	it('reports one listener’s exceptions without preventing other listeners or successful evaluation', async () => {
		const { service, onSubscriberError } = harness();
		const error = new Error('broken surface');
		service.subscribe('editor-A', () => { throw error; });
		const healthy = jest.fn<void, [NoteServiceState]>();
		service.subscribe('editor-A', healthy);
		expect(await service.request(input())).toBeDefined();
		expect(healthy.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
		expect(onSubscriberError).toHaveBeenCalledTimes(2);
		expect(onSubscriberError).toHaveBeenCalledWith(error);
		expect(service.current('editor-A')).toMatchObject({ status: 'ready' });
	});

	it('keeps subscriber-error reporting failures isolated from other listeners and math state', async () => {
		const { service, onSubscriberError } = harness();
		onSubscriberError.mockImplementation(() => { throw new Error('broken error reporter'); });
		service.subscribe('editor-A', () => { throw new Error('broken surface'); });
		const healthy = jest.fn<void, [NoteServiceState]>();
		service.subscribe('editor-A', healthy);
		let request: Promise<NoteSnapshot | undefined> | undefined;
		let synchronousError: unknown;
		try { request = service.request(input()); } catch (error: unknown) { synchronousError = error; }
		if (synchronousError) {
			// The service schedules evaluation before publishing pending. Dispose
			// on failure so this regression cannot leave an unobserved rejection.
			service.dispose();
			await Promise.resolve();
		}
		expect(synchronousError).toBeUndefined();
		expect(await request).toBeDefined();
		expect(healthy.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
		expect(service.current('editor-A')).toMatchObject({ status: 'ready' });
	});
});

describe('metadata deadline status publication', () => {
	const expiry = {reason: 'Dataview deadline expired', pendingReason: 'Dataview pending'};

	it('publishes a fresh ready identity and caches it without another evaluation', async () => {
		const {service, evaluate} = harness();
		evaluate.mockImplementation(request => snapshot(request, 'pending'));
		const request = input();
		const first = await service.request(request);
		const expired = service.expireMetadata(request, expiry);
		expect(expired).not.toBe(first);
		expect(expired?.generation).toEqual(first?.generation);
		expect(expired?.metadataStatus).toBe('unverified');
		expect(expired?.calculations).toEqual(first?.calculations);
		expect(first?.metadataStatus).toBe('pending');
		expect(service.current('editor-A')).toEqual({status: 'ready', snapshot: expired});
		expect(await service.request(request)).toBe(expired);
		expect(service.expireMetadata(request, expiry)).toBeUndefined();
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('refreshes a single asynchronous result before publication and retains pending presentation changes', async () => {
		const {service, evaluate} = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValue(evaluation.promise);
		const request = input();
		const pending = service.request(request);
		await Promise.resolve();
		service.expireMetadata(request, expiry);
		const changed = {...request, runtime: {...request.runtime, formatter: presentation('latest:')}};
		service.updatePresentation('editor-A', changed.runtime);
		expect(service.request(changed)).toBe(pending);
		expect(evaluate.mock.calls[0][1].aborted).toBe(false);
		evaluation.resolve(snapshot(request, 'pending'));
		const result = await pending;
		expect(result?.metadataStatus).toBe('unverified');
		expect(result?.format('calculation-1', 0)).toMatchObject({value: {text: 'latest:2'}});
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it.each(['resolve', 'reject'] as const)('suppresses obsolete asynchronous %s after expiry and replacement', async completion => {
		const {service, evaluate} = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValueOnce(evaluation.promise);
		const request = input();
		const obsolete = service.request(request);
		await Promise.resolve();
		service.expireMetadata(request, expiry);
		const current = await service.request(input({sourceRevision: 2}));
		if (completion === 'resolve') evaluation.resolve(snapshot(request, 'pending'));
		else evaluation.reject(new Error('obsolete failure'));
		expect(await obsolete).toBeUndefined();
		expect(service.current('editor-A')).toEqual({status: 'ready', snapshot: current});
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

	it.each(['invalidate', 'dispose'] as const)('does not publish expired pending results after %s', async action => {
		const {service, evaluate} = harness();
		const evaluation = deferred<NoteSnapshot>();
		evaluate.mockReturnValueOnce(evaluation.promise);
		const request = input();
		const pending = service.request(request);
		await Promise.resolve();
		service.expireMetadata(request, expiry);
		if (action === 'invalidate') service.invalidate('editor-A');
		else service.dispose();
		evaluation.resolve(snapshot(request, 'pending'));
		expect(await pending).toBeUndefined();
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('ignores stale generation, engine and configuration deadline updates', async () => {
		const {service, evaluate} = harness();
		evaluate.mockImplementation(request => snapshot(request, 'pending'));
		const request = input();
		const first = await service.request(request);
		for (const obsolete of [input({metadataRevision: 'old'}),
			{...request, runtime: {...request.runtime, engine: replacementEngine}},
			{...request, runtime: {...request.runtime, configurationError: 'changed'}},
		]) expect(service.expireMetadata(obsolete, expiry)).toBeUndefined();
		expect(service.current('editor-A')).toEqual({status: 'ready', snapshot: first});
		expect(service.expireMetadata(request, expiry)?.metadataStatus).toBe('unverified');
		expect(evaluate).toHaveBeenCalledTimes(1);
	});

	it('does not publish stale readiness to later listeners after a reentrant source replacement', async () => {
		const {service, evaluate} = harness();
		evaluate.mockImplementation(request => snapshot(request, 'pending'));
		const request = input();
		await service.request(request);
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && state.snapshot.metadataStatus === 'unverified') {
				replacement = service.request(input({sourceRevision: 2}));
			}
		});
		const later = jest.fn();
		service.subscribe('editor-A', later);
		later.mockClear();
		expect(service.expireMetadata(request, expiry)).toBeUndefined();
		expect((await replacement)?.generation.sourceRevision).toBe(2);
		expect(later.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'ready']);
		expect(evaluate).toHaveBeenCalledTimes(2);
	});
});
