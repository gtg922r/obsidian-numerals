import { snapshotFixture as fixture } from './hostSnapshotTestSupport';
import type { Editor } from 'obsidian';
import { all, create } from 'mathjs';
import { SnapshotCoordinator, type SourceOwner, type SnapshotConfiguration } from '../src/host/snapshotCoordinator';
import { createDefaultSettings } from '../src/settings/normalization';
import { createNumberFormatProfile, createResultFormatter } from '../src/formatting';
import { sourceLineAt, sourceLineStarts } from '../src/evaluation/sourceIndex';
import * as evaluation from '../src/evaluation/evaluateNote';
import { evaluateRuntimeMetadata } from '../src/evaluation/runtimeProvenance';
import { parseCrossNoteReferences } from '../src/processing/crossNoteResolver';
import type { NoteEvaluationRequest } from '../src/evaluation/evaluateNote';
import type { NoteSourceIndex } from '../src/evaluation/sourceIndex';
import type { NoteDependencyChange } from '../src/evaluation/dependencies';

jest.mock('obsidian');
const {load: parseYaml} = jest.requireActual<{load(text: string): unknown}>('js-yaml');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };


afterEach(() => jest.restoreAllMocks());

it('shares one complete ordered snapshot across subscriptions and repeated attachment', async () => {
	const evaluate = jest.spyOn(evaluation, 'evaluateNote');
	const host = fixture('```math\n$x = 3\n```\n\n`#: $x * 2`\n\n```math\n$x * 4\n```');
	const left = jest.fn(), right = jest.fn();
	host.coordinator.subscribe(host.editor, left); host.coordinator.subscribe(host.editor, right);
	host.coordinator.attach({...host.owner});
	await flush();
	const current = host.coordinator.current(host.editor)!;
	expect(current.state.status).toBe('ready');
	if (current.state.status !== 'ready') throw new Error('Expected ready snapshot');
	expect(current.state.snapshot.calculations.map(c => current.state.status === 'ready' && current.state.snapshot.format(c.calculationId, 0)))
		.toEqual([expect.objectContaining({value: expect.objectContaining({text: '3'})}),
			expect.objectContaining({value: expect.objectContaining({text: '6'})}), expect.objectContaining({value: expect.objectContaining({text: '12'})})]);
	expect(evaluate).toHaveBeenCalledTimes(1); expect(host.capture).toHaveBeenCalledTimes(1);
	expect(left).toHaveBeenCalled(); expect(right).toHaveBeenCalled();
	for (let i = 0; i < 10; i++) host.coordinator.current(host.editor);
	expect(evaluate).toHaveBeenCalledTimes(1);
	host.coordinator.dispose();
});

it('writes one random sample, reevaluates the new source and never renews on metadata echoes', async () => {
	const evaluate = jest.spyOn(evaluation, 'evaluateNote');
	const host = fixture('```math\n@[roll] = random()\n```');
	await flush();
	expect(host.transaction).toHaveBeenCalledTimes(1); expect(evaluate).toHaveBeenCalledTimes(2);
	const stored = host.text();
	const current = host.coordinator.current(host.editor)!;
	if (current.state.status !== 'ready') throw new Error('Expected ready snapshot');
	const row = current.state.snapshot.calculations[0], formatted = current.state.snapshot.format(row.calculationId, 0);
	if ('diagnostic' in formatted) throw new Error(formatted.diagnostic.message);
	expect(stored).not.toContain(`::${formatted.value.canonical}]`);
	for (let i = 0; i < 3; i++) host.coordinator.inputsChanged({kind: 'metadata', path: 'source.md'});
	await flush(); expect(host.transaction).toHaveBeenCalledTimes(1);
	expect(host.coordinator.insert(host.editor, true)).toBe(true);
	await flush(); expect(host.transaction).toHaveBeenCalledTimes(2);
	host.coordinator.inputsChanged(); await flush(); expect(host.transaction).toHaveBeenCalledTimes(2);
	host.setText(host.text() + '\nnew independent edit'); host.coordinator.sourceChanged(host.editor, true);
	await flush(); expect(host.transaction).toHaveBeenCalledTimes(3);
	host.coordinator.dispose();
});

it('batches every eligible token while preserving CRLF, containers and nested stored matrices', async () => {
	const host = fixture('before\r\n> ````math\r\n> @[a::[[0]]] = [[1,2],[3,4]] # keep\r\n> @[b] = 5\r\n> ````\r\nafter');
	await flush();
	expect(host.transaction).toHaveBeenCalledTimes(1);
	expect(host.transaction.mock.calls[0][0].changes).toHaveLength(2);
	expect(host.text()).toBe('before\r\n> ````math\r\n> @[a::[[1, 2], [3, 4]]] = [[1,2],[3,4]] # keep\r\n> @[b::5] = 5\r\n> ````\r\nafter');
	host.coordinator.dispose();
});

it('presentation replacement performs no math and a formatting-only refresh cannot renew writes', async () => {
	const evaluate = jest.spyOn(evaluation, 'evaluateNote');
	const host = fixture('```math\n@[x] = 1.234\n```'); await flush();
	const old = host.coordinator.current(host.editor)!.state;
	const calls = evaluate.mock.calls.length;
	const config = host.configuration();
	host.configure({...config, settingsGeneration: 1, runtime: {...config.runtime,
		formatter: {format: () => ({text: 'custom', tex: 'custom', canonical: '9'})}}});
	host.coordinator.settingsChanged(false); await flush();
	expect(host.coordinator.current(host.editor)!.state).not.toBe(old);
	expect(evaluate).toHaveBeenCalledTimes(calls); expect(host.transaction).toHaveBeenCalledTimes(1);
	host.coordinator.dispose();
});

it('requires actual current settings, file, attachment and full source before explicit insertion', async () => {
	const host = fixture('```math\n@[x] = random()\n```'); await flush();
	const original = host.text();
	host.setText(original + '\n'); expect(host.coordinator.insert(host.editor, true)).toBe(false);
	host.setText(original); host.setAttached(false); expect(host.coordinator.insert(host.editor, true)).toBe(false);
	host.setAttached(true); host.configure({...host.configuration(), settingsGeneration: 1});
	expect(host.coordinator.insert(host.editor, true)).toBe(false);
	host.configure({...host.configuration(), settingsGeneration: 0}); host.setFile({path: 'source.md'});
	expect(host.coordinator.insert(host.editor, true)).toBe(false);
	expect(host.transaction).toHaveBeenCalledTimes(1); host.coordinator.dispose();
});

it('rejects a row whose live engine epoch changed after its snapshot', async () => {
	const host = fixture('```math\n@[x] = random()\n```'); await flush();
	expect(host.coordinator.canInsert(host.editor)).toBe(true);
	evaluateRuntimeMetadata('createUnit("coordinatorEpoch", "1 m")', host.engine);
	expect(host.coordinator.insert(host.editor, true)).toBe(false);
	expect(host.transaction).toHaveBeenCalledTimes(1); host.coordinator.dispose();
});

it('blocks reference capture along with mathematics for invalid configuration', async () => {
	const host = fixture('```math\n1\n```');
	host.configure({...host.configuration(), runtime: {...host.configuration().runtime, configurationError: 'Repair settings'}});
	host.coordinator.settingsChanged(true); await flush();
	expect(host.capture).toHaveBeenCalledTimes(1); // the original valid request only
	const state = host.coordinator.current(host.editor)!.state;
	expect(state.status === 'ready' && state.snapshot.diagnostics).toEqual([{kind: 'configuration', message: 'Repair settings'}]);
	host.coordinator.dispose();
});

it.each<NoteDependencyChange>([
	{kind: 'metadata', path: 'source.md'}, {kind: 'metadata', path: 'ref.md'},
	{kind: 'create', path: 'ref.md'}, {kind: 'rename', path: 'ref.md', oldPath: 'old.md'},
])('invalidates an unregistered pending capture on $kind $path', async change => {
	const host = fixture('```math\n@[value] = [[ref]].x\n```'); host.coordinator.dispose();
	type Input = Pick<NoteEvaluationRequest, 'parseYaml' | 'references'>;
	const captures: {index: NoteSourceIndex; signal: AbortSignal; resolve(input: Input): void}[] = [];
	const coordinator = new SnapshotCoordinator({configuration: host.configuration,
		capture: (index, _config, signal) => new Promise<Input>(resolve => captures.push({index, signal, resolve}))});
	const values: string[] = [];
	coordinator.attach(host.owner);
	coordinator.subscribe(host.editor, () => {
		const current = coordinator.current(host.editor);
		if (current?.state.status === 'ready') {
			const snapshot = current.state.snapshot, calculation = snapshot.calculations[0];
			const formatted = snapshot.format(calculation.calculationId, 0);
			if ('value' in formatted) values.push(formatted.value.canonical);
		}
	});
	expect(captures).toHaveLength(1);
	coordinator.inputsChanged(change);
	expect(captures).toHaveLength(2); expect(captures[0].signal.aborted).toBe(true);
	const finish = (capture: typeof captures[number], value: number) => {
		const calculation = capture.index.calculations[0];
		const reference = parseCrossNoteReferences(calculation.projection.text)[0];
		capture.resolve({parseYaml, references: [{calculationId: calculation.id, ...reference, runtime: host.engine,
			result: {status: 'resolved', value, referencedPath: 'ref.md'}, provenance: {unverified: [], ambiguous: false}}]});
	};
	finish(captures[0], 2); await flush();
	expect(values).toEqual([]); expect(host.transaction).not.toHaveBeenCalled();
	finish(captures[1], 9); await flush();
	expect(values).toEqual(['9']); expect(host.transaction).toHaveBeenCalledTimes(1);
	expect(host.text()).toContain('@[value::9]'); expect(host.text()).not.toContain('::2]');
	coordinator.dispose();
});


it('cannot reattach a source from a teardown subscriber', async () => {
 const host = fixture('```math\n2\n```'); await flush();
 const before = host.capture.mock.calls.length;
 const reattach = jest.fn(() => host.coordinator.attach(host.owner));
 host.coordinator.subscribe(host.editor, reattach);
 host.coordinator.dispose(); await flush();
 expect(reattach).toHaveBeenCalledTimes(1);
 expect(host.capture).toHaveBeenCalledTimes(before);
 expect(host.coordinator.current(host.editor)).toBeUndefined();
});

it('does not capture after a pending subscriber disposes the coordinator', async () => {
 const host = fixture('```math\n2\n```'); await flush();
 const before = host.capture.mock.calls.length;
 host.coordinator.subscribe(host.editor, () => {
  if (host.coordinator.current(host.editor)?.state.status === 'pending') host.coordinator.dispose();
 });
 host.coordinator.inputsChanged(); await flush();
 expect(host.capture).toHaveBeenCalledTimes(before);
});

it('a superseded synchronous capture error cannot replace its successor', async () => {
 const host = fixture('```math\n2\n```'); await flush();
 host.capture.mockImplementationOnce(() => {
  host.coordinator.inputsChanged();
  throw new Error('obsolete capture');
 });
 host.coordinator.inputsChanged();
 expect(host.coordinator.current(host.editor)?.state.status).toBe('pending');
 await flush();
 expect(host.coordinator.current(host.editor)?.state.status).toBe('ready');
 host.coordinator.dispose();
});

it('a pending subscriber can supersede capture before the older request starts it', async () => {
 const host = fixture('```math\n2\n```'); await flush();
 const before = host.capture.mock.calls.length;
 let superseded = false;
 host.coordinator.subscribe(host.editor, () => {
  if (!superseded && host.coordinator.current(host.editor)?.state.status === 'pending') {
   superseded = true; host.coordinator.inputsChanged();
  }
 });
 host.coordinator.inputsChanged(); await flush();
 expect(host.capture).toHaveBeenCalledTimes(before + 1);
 expect(host.coordinator.current(host.editor)?.state.status).toBe('ready');
 host.coordinator.dispose();
});

it.each(['path', 'runtime', 'evaluation-settings', 'configuration-error'])('does not submit stale %s inputs after async capture', async change => {
	const host = fixture('```math\n@[x] = 1234\n```'); host.coordinator.dispose();
	const evaluate = jest.spyOn(evaluation, 'evaluateNote');
	let resolve!: (value: {parseYaml: typeof parseYaml}) => void;
	const coordinator = new SnapshotCoordinator({configuration: host.configuration,
		capture: () => new Promise<{parseYaml: typeof parseYaml}>(yes => {resolve = yes;})});
	coordinator.attach(host.owner);
	const old = host.configuration();
	if (change === 'path') (host.owner.file() as {path: string}).path = 'renamed.md';
	else if (change === 'runtime') host.configure({...old, runtime: {...old.runtime, engine: create(all)}});
	else if (change === 'configuration-error') host.configure({...old, runtime: {...old.runtime, configurationError: 'invalid currency'}});
	else host.configure({...old, evaluationSettingsGeneration: old.evaluationSettingsGeneration + 1});
	resolve({parseYaml}); await flush();
	expect(evaluate).not.toHaveBeenCalled(); expect(host.transaction).not.toHaveBeenCalled(); coordinator.dispose();
});

it.each([false, true])('adopts presentation-only changes during capture without extra math (notified=%s)', async notified => {
	const host = fixture('```math\n1234\n```'); host.coordinator.dispose();
	const evaluate = jest.spyOn(evaluation, 'evaluateNote');
	let resolve!: (value: {parseYaml: typeof parseYaml}) => void;
	const capture = jest.fn(() => new Promise<{parseYaml: typeof parseYaml}>(yes => {resolve = yes;}));
	const coordinator = new SnapshotCoordinator({configuration: host.configuration, capture}); coordinator.attach(host.owner);
	const old = host.configuration(), settings = {...old.settings, resultSeparator: ' means '};
	const formatter = {format: jest.fn(() => ({text: 'current presentation', tex: 'current', canonical: '1234'}))};
	host.configure({...old, settings, settingsGeneration: old.settingsGeneration + 1, runtime: {...old.runtime, formatter}});
	if (notified) coordinator.settingsChanged(false);
	resolve({parseYaml}); await flush();
	const current = coordinator.current(host.editor)!;
	if (current.state.status !== 'ready') throw new Error('Expected ready');
	expect(current.settings.resultSeparator).toBe(' means ');
	expect(current.state.snapshot.format(current.state.snapshot.calculations[0].calculationId, 0)).toEqual({value: {text: 'current presentation', tex: 'current', canonical: '1234'}});
	expect(capture).toHaveBeenCalledTimes(1); expect(evaluate).toHaveBeenCalledTimes(1); coordinator.dispose();
});

it('synchronous public invalidation cancels queued native effects without consuming later trusted input classification', async () => {
 const host = fixture('```math\ncreateUnit("removedQueuedUnit", "1 m")\n```'); host.coordinator.dispose();
 let coordinator!: SnapshotCoordinator, changed = false;
 coordinator = new SnapshotCoordinator({configuration: host.configuration, capture: () => {
  if (!changed) {
   changed = true;
   void Promise.resolve().then(() => Promise.resolve().then(() => {
    host.setText('```math\n@[x] = random()\n```');
    coordinator.invalidateChangedSource(host.editor); // synchronous public editor-change boundary
    void Promise.resolve().then(() => coordinator.sourceChanged(host.editor, true)); // later CM classification
   }));
  }
  return {parseYaml};
 }});
 coordinator.attach(host.owner); await flush();
 expect(host.engine.Unit.isValuelessUnit('removedQueuedUnit')).toBe(false);
 expect(host.transaction).toHaveBeenCalledTimes(1); expect(host.text()).toContain('@[x::');
 const state = coordinator.current(host.editor)?.state; expect(state?.status).toBe('ready'); coordinator.dispose();
});

it('recovers a rapid public change/revert without leaving pending state or renewing insertion', async () => {
 const host = fixture('```math\n@[x] = random()\n```'); await flush();
 const original = host.text(); expect(host.transaction).toHaveBeenCalledTimes(1);
 host.setText(original + '\n'); host.coordinator.invalidateChangedSource(host.editor);
 host.setText(original); host.coordinator.invalidateChangedSource(host.editor);
 host.coordinator.sourceChanged(host.editor, true); await flush();
 expect(host.coordinator.current(host.editor)?.state.status).toBe('ready'); expect(host.transaction).toHaveBeenCalledTimes(1);
 host.coordinator.dispose();
});

it.each(['public-first', 'cm-first', 'programmatic'] as const)('handles %s event order without stale native effects or duplicate final evaluation', async order => {
 const host = fixture('```math\ncreateUnit("retiredOrderUnit", "1 m")\n```'); host.coordinator.dispose();
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'); let coordinator!: SnapshotCoordinator, scheduled = false;
 coordinator = new SnapshotCoordinator({configuration: host.configuration, capture: () => {
  if (!scheduled) {
   scheduled = true;
   void Promise.resolve().then(() => Promise.resolve().then(() => {
    host.setText('```math\n3\n```');
    if (order === 'cm-first') coordinator.sourceChanged(host.editor, true);
    coordinator.invalidateChangedSource(host.editor);
    if (order === 'public-first') coordinator.sourceChanged(host.editor, true);
    void Promise.resolve().then(() => coordinator.sourceChanged(host.editor, false));
   }));
  }
  return {parseYaml};
 }});
 coordinator.attach(host.owner); await flush();
 expect(host.engine.Unit.isValuelessUnit('retiredOrderUnit')).toBe(false);
 expect(evaluate).toHaveBeenCalledTimes(1); expect(evaluate.mock.calls[0][0].generation.sourceText).toBe(host.text());
 expect(coordinator.current(host.editor)?.insertionExhausted).toBe(true); // the ready no-directive attempt spends its cycle
 expect(host.transaction).not.toHaveBeenCalled(); coordinator.dispose();
});

it('bounds same-file pane echoes and preserves suppression after the writing pane closes', async () => {
 const host = fixture('```math\n@[x] = random()\n```'); host.coordinator.dispose();
 const secondEditor = {transaction: jest.fn(), offsetToPos: host.editor.offsetToPos} as unknown as Editor;
 const second: SourceOwner = {...host.owner, identity: secondEditor, editor: secondEditor};
 const coordinator = new SnapshotCoordinator({configuration: host.configuration, capture: () => ({parseYaml})});
 const transaction = host.transaction.getMockImplementation()!;
 host.transaction.mockImplementation(input => {
  transaction(input); coordinator.invalidateChangedSource(secondEditor); coordinator.sourceChanged(secondEditor, false);
 });
 coordinator.attach(host.owner); coordinator.attach(second); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1); expect(secondEditor.transaction).not.toHaveBeenCalled();
 coordinator.detach(host.editor); coordinator.detach(secondEditor);
 const thirdEditor = {transaction: jest.fn(), offsetToPos: host.editor.offsetToPos} as unknown as Editor;
 coordinator.attach({...host.owner, identity: thirdEditor, editor: thirdEditor}); await flush();
 coordinator.inputsChanged({kind: 'metadata', path: 'source.md'}); await flush();
 expect(thirdEditor.transaction).not.toHaveBeenCalled(); coordinator.dispose();
});

it('bounds two-note dependency feedback without renewing either stored-result batch', async () => {
 const a = fixture('```math\n@[x] = [[B]].seed + random()\n```'), b = fixture('```math\n@[x] = [[A]].seed + random()\n```');
 a.coordinator.dispose(); b.coordinator.dispose(); a.setFile({path: 'A.md'}); b.setFile({path: 'B.md'});
 const coordinator = new SnapshotCoordinator({configuration: a.configuration, capture: index => ({parseYaml,
  references: index.calculations.flatMap(calculation => parseCrossNoteReferences(calculation.projection.text).map(reference => ({
   calculationId: calculation.id, ...reference, runtime: a.engine,
   result: {status: 'resolved' as const, value: 1, referencedPath: reference.noteName + '.md'}, provenance: {unverified: [], ambiguous: false},
  }))),
 })});
 const change = (host: typeof a, path: string) => {
  const dispatch = host.transaction.getMockImplementation()!;
  host.transaction.mockImplementation(input => {dispatch(input); coordinator.inputsChanged({kind: 'metadata', path});});
 };
 change(a, 'A.md'); change(b, 'B.md'); coordinator.attach(a.owner); coordinator.attach(b.owner); await flush();
 expect(a.transaction).toHaveBeenCalledTimes(1); expect(b.transaction).toHaveBeenCalledTimes(1);
 for (const path of ['A.md', 'B.md', 'A.md', 'B.md']) {coordinator.inputsChanged({kind: 'metadata', path}); await flush();}
 expect(a.transaction).toHaveBeenCalledTimes(1); expect(b.transaction).toHaveBeenCalledTimes(1);
 coordinator.dispose();
});

it.each(['@[x::2] = [[Target]].price', '@[x::0] = [[Target]].price'])('spends the initial ready cycle for %s even before its value becomes eligible', async expression => {
 const host = fixture('```math\n' + expression + '\n```'); host.coordinator.dispose();
 let value = 2, verified = expression.includes('::2]');
 const coordinator = new SnapshotCoordinator({configuration: host.configuration, capture: index => ({parseYaml,
  references: index.calculations.flatMap(calculation => parseCrossNoteReferences(calculation.projection.text).map(reference => ({
   calculationId: calculation.id, ...reference, runtime: host.engine,
   result: {status: 'resolved' as const, value, referencedPath: 'Target.md'},
   provenance: {unverified: verified ? [] : ['unverified target field'], ambiguous: false},
  }))),
 })});
 coordinator.attach(host.owner);
 const observed: boolean[] = [];
 coordinator.subscribe(host.editor, () => {const current = coordinator.current(host.editor); if (current?.state.status === 'ready') observed.push(current.insertionExhausted);});
 await flush(); expect(host.transaction).not.toHaveBeenCalled(); expect(observed.at(-1)).toBe(true);
 expect(observed).toHaveLength(2); // ready, then one no-op exhaustion notification
 value = 3; verified = true; coordinator.inputsChanged({kind: 'metadata', path: 'Target.md'});
 await flush(); expect(host.transaction).not.toHaveBeenCalled(); expect(coordinator.canInsert(host.editor)).toBe(true);
 host.setText(host.text() + '\nindependent input'); coordinator.sourceChanged(host.editor, true); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1); expect(host.text()).toContain('@[x::3]');
 value = 4; coordinator.inputsChanged({kind: 'metadata', path: 'Target.md'}); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1); coordinator.dispose();
});

it('an unsuccessful explicit ready attempt spends permission before the queued automatic attempt', async () => {
 const host = fixture('```math\n@[x::2] = 2\n```');
 const attempts: boolean[] = [];
 host.coordinator.subscribe(host.editor, () => {
  const current = host.coordinator.current(host.editor);
  if (current?.state.status === 'ready' && !current.insertionExhausted) attempts.push(host.coordinator.insert(host.editor, true));
 });
 await flush(); expect(attempts).toEqual([false]); expect(host.transaction).not.toHaveBeenCalled();
 expect(host.coordinator.current(host.editor)?.insertionExhausted).toBe(true);
 host.coordinator.inputsChanged(); await flush(); expect(attempts).toEqual([false]); host.coordinator.dispose();
});
