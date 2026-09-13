import { all, create, type MathJsInstance } from 'mathjs';
import type { ResultFormatter } from '../../src/formatting/types';
import { activateMathRuntime, getMathRuntime } from '../../src/mathRuntime';
import * as driver from '../../src/evaluation/evaluateNote';
import type { NoteEvaluationRequest } from '../../src/evaluation/evaluateNote';
import type { NoteSnapshot } from '../../src/evaluation/noteSnapshot';
import { createNoteEvaluationService, type NoteEvaluationClock } from '../../src/evaluation/service';

const { load: parseYaml } = jest.requireActual<{ load: (text: string) => unknown }>('js-yaml');
const initialRuntime = getMathRuntime();
afterEach(() => { activateMathRuntime(initialRuntime); jest.restoreAllMocks(); });

async function flush(): Promise<void> {
	for (let step = 0; step < 4; step++) await Promise.resolve();
}

class FakeClock implements NoteEvaluationClock {
	time = 0;
	private nextId = 0;
	readonly callbacks = new Map<number, { at: number; callback: () => void }>();
	readonly cleared: number[] = [];
	now(): number { return this.time; }
	setTimeout(callback: () => void, delayMs: number): number {
		const id = ++this.nextId;
		this.callbacks.set(id, { at: this.time + delayMs, callback });
		return id;
	}
	clearTimeout(handle: unknown): void {
		this.callbacks.delete(handle as number);
		this.cleared.push(handle as number);
	}
	async advanceTo(time: number): Promise<void> {
		this.time = time;
		for (;;) {
			const due = [...this.callbacks].find(([, timer]) => timer.at <= time);
			if (!due) break;
			this.callbacks.delete(due[0]);
			due[1].callback();
		}
		await flush();
	}
}

function mockScalarRandom(engine: MathJsInstance, value: number) {
	// These expressions use the public no-argument scalar overload.
	return jest.spyOn(engine as unknown as { random: () => number }, 'random').mockReturnValue(value);
}

function makeFormatter(prefix = ''): ResultFormatter {
	return { format: value => ({ text: `${prefix}${String(value)}`, tex: String(value), canonical: String(value) }) };
}

function request(sourceText = '```math\nrandom()\n```'): NoteEvaluationRequest {
	return {
		generation: { sourceId: 'editor-A', sourcePath: 'Note.md', sourceRevision: 1, sourceText,
			metadataRevision: 'metadata-1', dependencyRevision: 'dependencies-1', evaluationSettingsRevision: 'settings-1', runtimeGeneration: 1 },
		runtime: { engine: create(all), formatter: makeFormatter() }, parseYaml, preProcessors: [],
	};
}

function formatted(snapshot: NoteSnapshot | undefined): string | undefined {
	if (!snapshot) return undefined;
	const value = snapshot.format(snapshot.calculations[0].calculationId, 0);
	return 'value' in value ? value.value.text : value.diagnostic.message;
}

describe('complete note service using the real note evaluator', () => {
	it('does not reevaluate math for duplicate requests, cursor inspection, or presentation changes', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = request();
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		const first = await service.request(input);
		expect(first?.calculations[0].rows[0].result).toBe(0.5);
		expect(await service.request({ ...input })).toBe(first);
		first?.symbolsAt(0);
		first?.symbolsAt(input.generation.sourceText.length);
		service.current('editor-A');
		const second = service.updatePresentation('editor-A', { ...input.runtime, formatter: makeFormatter('second:') });
		expect(formatted(second)).toBe('second:0.5');
		const third = await service.request({ ...input, runtime: { ...input.runtime, formatter: makeFormatter('third:') } });
		expect(formatted(third)).toBe('third:0.5');
		expect(random).toHaveBeenCalledTimes(1);
		expect(clock.callbacks.size).toBe(0);
		await clock.advanceTo(10000);
		expect(random).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('expires pending metadata without replaying captured YAML, preprocessing or mathematics', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const provider = { numerals: 'all', value: 7 };
		const yaml = jest.fn(() => provider);
		const pending = { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 };
		const processor = { regex: /TOKEN/g, replaceStr: '1' };
		const input = { ...request('---\nnumerals: all\nvalue: 7\n---\n```math\nvalue + TOKEN + random()\n```'),
			parseYaml: yaml, dataview: pending, preProcessors: [processor] };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		const first = await service.request(input);
		expect(first?.metadataStatus).toBe('pending');
		expect(first?.calculations[0].rows[0].result).toBe(8.5);
		expect(first?.calculations[0].rows[0].insertion.canInsert).toBe(true);
		provider.value = 99;
		processor.replaceStr = '100';
		processor.regex.lastIndex = 100;
		pending.startedAtMs = 10000;
		pending.maxWaitMs = 5000;
		const replacement = create(all);
		const wrongRandom = mockScalarRandom(replacement, 99);
		activateMathRuntime(replacement);
		await clock.advanceTo(99);
		expect(service.current('editor-A')).toMatchObject({ status: 'ready', snapshot: { metadataStatus: 'pending' } });
		await clock.advanceTo(100);
		const state = service.current('editor-A');
		expect(state?.status).toBe('ready');
		if (state?.status !== 'ready') throw new Error('Expected completed deadline snapshot');
		expect(state.snapshot.metadataStatus).toBe('unverified');
		expect(state.snapshot).not.toBe(first);
		expect(first?.metadataStatus).toBe('pending');
		expect(state.snapshot.generation).toEqual(input.generation);
		expect(state.snapshot.diagnostics).toContainEqual({kind: 'metadata', message: 'Dataview deadline elapsed without verified buffer metadata; using the captured native metadata.'});
		expect(state.snapshot.diagnostics.some(item => item.message === 'Dataview is pending; native metadata is available now.')).toBe(false);
		expect(state.snapshot.calculations[0].rows[0].result).toBe(8.5);
		expect(state.snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(yaml).toHaveBeenCalledTimes(1);
		expect(random).toHaveBeenCalledTimes(1);
		expect(wrongRandom).not.toHaveBeenCalled();
		const duplicate = await service.request(input);
		expect(duplicate).toBe(state.snapshot);
		expect(duplicate?.metadataStatus).toBe('unverified');
		await clock.advanceTo(20000);
		expect(random).toHaveBeenCalledTimes(1);
		expect(yaml).toHaveBeenCalledTimes(1);
		expect(clock.callbacks.size).toBe(0);
		service.dispose();
	});

	it('carries presentation changes made by a ready subscriber into the deadline status refresh', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		let updated = false;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && !updated) {
				updated = true;
				service.updatePresentation('editor-A', { ...input.runtime, formatter: makeFormatter('updated:') });
			}
		});
		expect(formatted(await service.request(input))).toBe('updated:0.5');
		await clock.advanceTo(100);
		const state = service.current('editor-A');
		expect(state?.status).toBe('ready');
		if (state?.status === 'ready') expect(formatted(state.snapshot)).toBe('updated:0.5');
		expect(random).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('does not let presentation reentry restore a retired capture or timer', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		let armed = false;
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (armed && state.status === 'ready' && state.snapshot.generation.sourceRevision === 1) {
				armed = false;
				replacement = service.request({ ...input, dataview: undefined, generation: { ...input.generation, sourceRevision: 2 } });
			}
		});
		armed = true;
		expect(await service.request({ ...input, runtime: { ...input.runtime, formatter: makeFormatter('old:') } })).toBeUndefined();
		expect((await replacement)?.generation.sourceRevision).toBe(2);
		expect(clock.callbacks.size).toBe(0);
		await clock.advanceTo(100);
		expect(random).toHaveBeenCalledTimes(2);
		expect(service.current('editor-A')).toMatchObject({ status: 'ready', snapshot: { generation: { sourceRevision: 2 } } });
		service.dispose();
	});

	it('retains the innermost presentation update when the deadline refreshes readiness', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		let armed = false;
		service.subscribe('editor-A', state => {
			if (armed && state.status === 'ready') {
				armed = false;
				service.updatePresentation('editor-A', { ...input.runtime, formatter: makeFormatter('inner:') });
			}
		});
		armed = true;
		expect(formatted(service.updatePresentation('editor-A', { ...input.runtime, formatter: makeFormatter('outer:') }))).toBe('inner:0.5');
		expect(random).toHaveBeenCalledTimes(1);
		await clock.advanceTo(100);
		const state = service.current('editor-A');
		expect(state?.status).toBe('ready');
		if (state?.status === 'ready') expect(formatted(state.snapshot)).toBe('inner:0.5');
		expect(random).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('returns the current snapshot when initial ready publication expires and reformats through nested subscribers', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = {...request(), dataview: {status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100}};
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		let expired = false;
		let reformatted = false;
		service.subscribe('editor-A', state => {
			if (state.status !== 'ready') return;
			if (state.snapshot.metadataStatus === 'pending' && !expired) {
				expired = true;
				void clock.advanceTo(100);
			} else if (state.snapshot.metadataStatus === 'unverified' && !reformatted) {
				reformatted = true;
				service.updatePresentation('editor-A', {...input.runtime, formatter: makeFormatter('nested:')});
			}
		});
		const result = await service.request(input);
		expect(result?.metadataStatus).toBe('unverified');
		expect(formatted(result)).toBe('nested:0.5');
		expect(service.current('editor-A')).toEqual({status: 'ready', snapshot: result});
		expect(random).toHaveBeenCalledTimes(1);
		expect(clock.callbacks.size).toBe(0);
		service.dispose();
	});

	it('cancels a pending deadline when a newer metadata generation arrives', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		const oldCallback = [...clock.callbacks.values()][0].callback;
		const next = await service.request({ ...input, generation: { ...input.generation, metadataRevision: 'metadata-2' },
			dataview: { status: 'projection', origin: 'inline-fields', revision: 2, metadata: { $extra: 4 } } });
		expect(clock.callbacks.size).toBe(0);
		oldCallback();
		await clock.advanceTo(100);
		expect(service.current('editor-A')).toEqual({ status: 'ready', snapshot: next });
		expect(random).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it('evaluates new projection inputs after deadline expiry while repeated old inputs stay cached', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = {...request(), dataview: {status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100}};
		const random = mockScalarRandom(input.runtime.engine, 0.5).mockReturnValueOnce(0.25);
		await service.request(input);
		await clock.advanceTo(100);
		expect((await service.request(input))?.calculations[0].rows[0].result).toBe(0.25);
		const updated = await service.request({...input, generation: {...input.generation, metadataRevision: 'metadata-2'},
			dataview: {status: 'projection', origin: 'inline-fields', revision: 2, metadata: {$extra: 4}}});
		expect(updated?.calculations[0].rows[0].result).toBe(0.5);
		expect(updated?.metadataSymbols).toContainEqual({name: '$extra', origin: 'global', value: 4});
		expect(random).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it.each(['invalidate', 'dispose'] as const)('cancels deadline work on %s, including a late callback', async action => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		const oldCallback = [...clock.callbacks.values()][0].callback;
		if (action === 'invalidate') service.invalidate('editor-A');
		else service.dispose();
		expect(clock.callbacks.size).toBe(0);
		oldCallback();
		await clock.advanceTo(100);
		expect(random).toHaveBeenCalledTimes(1);
		if (action === 'invalidate') expect(service.current('editor-A')).toBeUndefined();
		else expect(() => service.current('editor-A')).toThrow('disposed');
		service.dispose();
	});

	it('keeps deadline ownership separate for different buffers using the same file path', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		await service.request({ ...input, generation: { ...input.generation, sourceId: 'editor-B' } });
		expect(clock.callbacks.size).toBe(2);
		service.invalidate('editor-A');
		await clock.advanceTo(100);
		expect(service.current('editor-A')).toBeUndefined();
		expect(service.current('editor-B')).toMatchObject({ status: 'ready', snapshot: { metadataStatus: 'unverified' } });
		expect(random).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it('evaluates once with final readiness when the deadline expires before math starts', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		const pending = service.request(input);
		await clock.advanceTo(100);
		expect((await pending)?.metadataStatus).toBe('unverified');
		expect(random).toHaveBeenCalledTimes(1);
		expect(service.current('editor-A')).toMatchObject({ status: 'ready', snapshot: { metadataStatus: 'unverified' } });
		service.dispose();
	});

	it('reschedules an early timer callback against the original deadline', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		const [id, scheduled] = [...clock.callbacks][0];
		clock.callbacks.delete(id);
		clock.time = 50;
		scheduled.callback();
		expect([...clock.callbacks.values()][0].at).toBe(100);
		expect(random).toHaveBeenCalledTimes(1);
		await clock.advanceTo(100);
		expect(random).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('never repeats createUnit or changes a random result when readiness expires', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = {...request('```math\ncreateUnit("deadlinewidget", "2 m")\nrandom()\n```'),
			dataview: {status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100}};
		const random = mockScalarRandom(input.runtime.engine, 0.5).mockReturnValueOnce(0.25);
		const createUnit = jest.spyOn(input.runtime.engine, 'createUnit');
		const first = await service.request(input);
		expect(first?.calculations[0].rows[1].result).toBe(0.25);
		expect(createUnit).toHaveBeenCalledTimes(1);
		await clock.advanceTo(100);
		const state = service.current('editor-A');
		expect(state?.status).toBe('ready');
		if (state?.status !== 'ready') throw new Error('Expected ready status');
		expect(state.snapshot.metadataStatus).toBe('unverified');
		expect(state.snapshot.calculations).toEqual(first?.calculations);
		expect(await service.request(input)).toBe(state.snapshot);
		expect(random).toHaveBeenCalledTimes(1);
		expect(createUnit).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('accepts the one already evaluated result when its timer expires during asynchronous completion', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = {...request(), dataview: {status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100}};
		const random = mockScalarRandom(input.runtime.engine, 0.5).mockReturnValueOnce(0.25);
		let complete!: () => void;
		const barrier = new Promise<void>(resolve => { complete = resolve; });
		const realEvaluate = driver.evaluateNote;
		// The generic service supports asynchronous adapters; delay only delivery
		// of the real driver's already calculated snapshot.
		const evaluate = jest.spyOn(driver as unknown as {
			evaluateNote: (input: driver.CapturedNoteEvaluationInput, signal?: AbortSignal) => NoteSnapshot | Promise<NoteSnapshot>;
		}, 'evaluateNote').mockImplementation(async (captured, signal) => {
			const result = realEvaluate(captured, signal);
			await barrier;
			return result;
		});
		const pending = service.request(input);
		await Promise.resolve();
		expect(random).toHaveBeenCalledTimes(1);
		await clock.advanceTo(100);
		expect(service.current('editor-A')?.status).toBe('pending');
		service.updatePresentation('editor-A', {...input.runtime, formatter: makeFormatter('latest:')});
		complete();
		const result = await pending;
		expect(result?.metadataStatus).toBe('unverified');
		expect(formatted(result)).toBe('latest:0.25');
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(random).toHaveBeenCalledTimes(1);
		service.dispose();
	});

	it('does not revive a retired capture when an overdue repeated request publishes readiness', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = {...request(), dataview: {status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100}};
		const random = mockScalarRandom(input.runtime.engine, 0.5);
		await service.request(input);
		let replacement: Promise<NoteSnapshot | undefined> | undefined;
		service.subscribe('editor-A', state => {
			if (state.status === 'ready' && state.snapshot.metadataStatus === 'unverified') {
				replacement = service.request({...input, dataview: undefined, generation: {...input.generation, sourceRevision: 2}});
			}
		});
		clock.time = 100;
		expect(await service.request(input)).toBeUndefined();
		expect((await replacement)?.generation.sourceRevision).toBe(2);
		expect(service.current('editor-A')).toMatchObject({status: 'ready', snapshot: {generation: {sourceRevision: 2}}});
		expect(clock.callbacks.size).toBe(0);
		expect(random).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it('does not retry a failed evaluation when its metadata deadline expires', async () => {
		const clock = new FakeClock();
		const service = createNoteEvaluationService({ clock });
		const input = { ...request(), dataview: { status: 'pending' as const, startedAtMs: 0, maxWaitMs: 100 } };
		const evaluate = jest.spyOn(driver, 'evaluateNote').mockImplementation(() => { throw new Error('evaluation failed'); });
		await expect(service.request(input)).rejects.toThrow('evaluation failed');
		const failed = service.current('editor-A');
		await clock.advanceTo(100);
		expect(service.current('editor-A')).toBe(failed);
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(clock.callbacks.size).toBe(0);
		service.dispose();
	});
});
