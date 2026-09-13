import { snapshotFixture as fixture, flushSnapshots as flush } from './hostSnapshotTestSupport';
import { SnapshotCoordinator } from '../src/host/snapshotCoordinator';
import { NumeralsSettingsRuntime } from '../src/settings/runtimeState';
import { createCurrencyPreProcessors } from '../src/settings/currencies';
import { prepareInsertions } from '../src/host/snapshotInsertion';
import { indexNote } from '../src/evaluation/sourceIndex';

jest.mock('obsidian');

it.each([
 ['@[profit] = 100', '@[profit::100] = 100'],
 ['@[profit::5] = 100', '@[profit::100] = 100'],
 ['@ [profit ] = 100', '@ [profit ::100] = 100'],
 ['@[count] = 99 # preserve @[literal]', '@[count::99] = 99 # preserve @[literal]'],
 ['@[value] = 1234.5678', '@[value::1,234.568] = 1234.5678'],
 ['@format fixed\n@decimalPlaces 2\n@[value] = 1.2', '@format fixed\n@decimalPlaces 2\n@[value::1.20] = 1.2'],
])('replaces only the balanced token in %s', async (source, expected) => {
 const host = fixture('before\n```math\n' + source + '\n```\nafter'); await flush();
 expect(host.text()).toBe('before\n```math\n' + expected + '\n```\nafter');
 expect(host.transaction).toHaveBeenCalledTimes(1); host.coordinator.dispose();
});

it('no-ops matching output and notes without insertion directives', async () => {
 for (const source of ['@[value::4] = 4', 'value = 4', '# @[value]']) {
  const host = fixture('```math\n' + source + '\n```'); await flush();
  expect(host.transaction).not.toHaveBeenCalled(); expect(host.coordinator.canInsert(host.editor)).toBe(false);
  expect(host.coordinator.current(host.editor)?.insertionExhausted).toBe(true);
  expect(host.coordinator.insert(host.editor, true)).toBe(false); host.coordinator.dispose();
 }
});

it('batches complete-note occurrences and preserves successful rows before a stopped block', async () => {
 const source = '```math\n@[a] = 2\nmissing\n@[b] = 3\n```\n\n```math\n@[c] = 4\n```';
 const host = fixture(source); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1); expect(host.transaction.mock.calls[0][0].changes).toHaveLength(2);
 expect(host.text()).toBe(source.replace('@[a]', '@[a::2]').replace('@[c]', '@[c::4]')); host.coordinator.dispose();
});

it('does not retry after a transaction throws, including metadata echoes', async () => {
 const host = fixture('```math\n@[a] = random()\n```'); host.transaction.mockImplementation(() => { throw new Error('editor closed'); });
 await flush(); expect(host.transaction).toHaveBeenCalledTimes(1);
 expect(host.coordinator.current(host.editor)?.state.status).toBe('error');
 host.coordinator.inputsChanged(); await flush(); expect(host.transaction).toHaveBeenCalledTimes(1); host.coordinator.dispose();
});

it('undoing an own write stays undone and explicit command availability never rearms it', async () => {
 const original = '```math\n@[a] = 4\n```', host = fixture(original); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1);
 host.setText(original); host.coordinator.sourceChanged(host.editor, false); await flush();
 for (let i = 0; i < 10; i++) expect(host.coordinator.canInsert(host.editor)).toBe(true);
 host.coordinator.inputsChanged(); await flush(); expect(host.transaction).toHaveBeenCalledTimes(1);
 expect(host.text()).toBe(original); expect(host.coordinator.insert(host.editor, true)).toBe(true);
 await flush(); expect(host.transaction).toHaveBeenCalledTimes(2); host.coordinator.dispose();
});

it('retains own-write echo suppression after the original editor closes', async () => {
 const host = fixture('```math\n@[a] = random()\n```'); await flush(); const output = host.text(), file = host.owner.file()!;
 host.coordinator.detach(host.editor);
 const other = fixture(output); other.coordinator.dispose(); other.setFile(file);
 host.coordinator.attach(other.owner); await flush();
 expect(other.transaction).not.toHaveBeenCalled(); expect(host.transaction).toHaveBeenCalledTimes(1);
 host.coordinator.dispose();
});

it('never authorizes a mismatched index/source revision or a stale engine', async () => {
 const host = fixture('```math\n@[a] = 4\n```'); host.transaction.mockImplementation(() => {}); await flush();
 const current = host.coordinator.current(host.editor)!;
 if (current.state.status !== 'ready') throw new Error('Expected ready');
 const snapshot = current.state.snapshot;
 expect(prepareInsertions(snapshot, indexNote({...current.index.source, revision: 999}), host.engine)).toBeUndefined();
 expect(prepareInsertions(snapshot, indexNote({...current.index.source, text: 'other bytes'}), host.engine)).toBeUndefined();
 const batch = prepareInsertions(snapshot, current.index, host.engine)!;
 const other = fixture(''); expect(batch.valid(other.engine)).toBe(false); other.coordinator.dispose(); host.coordinator.dispose();
});

it('serializes retained currency results with codes and rejects the older snapshot after a remap', async () => {
 const host = fixture('```math\n@[amount] = $12.50\n```'); host.coordinator.dispose();
 const runtime = new NumeralsSettingsRuntime(createCurrencyPreProcessors); runtime.prepare(host.configuration().settings).activate();
 host.configure({...host.configuration(), runtime: runtime.context});
 const coordinator = new SnapshotCoordinator({configuration: host.configuration, capture: host.capture}); coordinator.attach(host.owner);
 await flush(); expect(host.text()).toContain('@[amount::12.50 USD]'); expect(host.text()).not.toContain('::$');
 const before = host.transaction.mock.calls.length;
 const settings = {...host.configuration().settings, dollarSymbolCurrency: {symbol: '$', currency: 'CAD'}};
 runtime.prepare(settings).activate(); host.configure({...host.configuration(), settings, runtime: runtime.context, evaluationSettingsGeneration: 1, settingsGeneration: 1});
 expect(coordinator.insert(host.editor, true)).toBe(false); expect(host.transaction).toHaveBeenCalledTimes(before);
 coordinator.settingsChanged(true); await flush(); expect(host.transaction).toHaveBeenCalledTimes(before);
 expect(coordinator.insert(host.editor, true)).toBe(true); expect(host.text()).toContain('@[amount::12.50 CAD]');
 coordinator.dispose(); runtime.dispose();
});
