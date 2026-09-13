import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapMethod, observeEditor, observeVault} from '../observer-writes.cjs';
import {StateObserver} from '../observer-state.cjs';
import {Journal, Identities, PopoutTicket, data} from '../observer-core.cjs';
import {owner} from './support.mjs';

test('wrapper preserves receiver, argument identity, callback identity, exact promise and one call', () => {
  const journal = new Journal(), args = {x: 1}, callback = () => {}, promise = Promise.resolve(7); let calls = 0;
  const object = {run(a, b) { calls++; assert.equal(this, receiver); assert.equal(a, args); assert.equal(b, callback); return promise; }}, receiver = {};
  const original = Object.getOwnPropertyDescriptor(object, 'run');
  const stop = wrapMethod(object, 'run', journal, {before() {}, after() {}});
  assert.equal(object.run.call(receiver, args, callback), promise); assert.equal(calls, 1);
  stop(); stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(object, 'run'), original);
});
test('observer errors do not replace original throw, and inherited method restoration removes shadow', () => {
  const error = new Error('original'), prototype = {run() { throw error; }}, object = Object.create(prototype), journal = new Journal();
  const stop = wrapMethod(object, 'run', journal, {before() { throw Error('observer'); }, after() { throw Error('observer'); }});
  assert.throws(() => object.run(), e => e === error); assert.ok(journal.faults.has('write-observation-gap')); stop();
  assert.equal(Object.hasOwn(object, 'run'), false); assert.equal(object.run, prototype.run);
});
test('cleanup never overwrites a replacement and reports the coverage break', () => {
  const object = {run() {}}, journal = new Journal(); const stop = wrapMethod(object, 'run', journal, {before() {}, after() {}});
  const replacement = () => 5; object.run = replacement; stop(); assert.equal(object.run, replacement); assert.ok(journal.faults.has('wrapper-replaced'));
});
test('readonly method failure is not reported as installed coverage', () => {
  const object = {}; Object.defineProperty(object, 'run', {value() {}, writable: false, configurable: false}); const journal = new Journal();
  const stop = wrapMethod(object, 'run', journal, {before() {}, after() {}}); assert.notEqual(stop.installed, true); assert.ok(journal.faults.has('method-unavailable'));
});
test('editor call records before/after without changing transaction or return', () => {
  const o = owner(), stop = observeEditor(o.editor, o.ownership, o.journal); const tx = {text: '3'};
  o.editor.transaction(tx, 'numerals-insertion'); assert.equal(o.editor.text, '3');
  const end = o.journal.records.find(r => r.kind === 'editor-transaction-end'); assert.equal(end.before, '1+2'); assert.equal(end.after, '3'); assert.equal(end.origin, 'numerals-insertion'); stop();
});
test('vault process callback and rejected promise stay untouched; nested calls retain parent identity', async () => {
  const promise = Promise.reject(Error('rejected')); promise.catch(() => {}); const callback = () => 'new'; let callbacks = 0;
  const adapter = {write() { return promise; }}, vault = {adapter, process(file, fn) { assert.equal(fn, callback); callbacks++; return adapter.write(file.path, 'new'); }};
  const journal = new Journal(), original = vault.process, stop = observeVault(vault, new Set(['acceptance/x.md']), journal);
  assert.equal(vault.process({path: 'acceptance/x.md'}, callback), promise); assert.equal(callbacks, 1);
  const calls = journal.records.filter(r => r.kind === 'vault-call'); assert.equal(calls[1].parentId, calls[0].callId);
  stop(); assert.equal(vault.process, original); await assert.rejects(promise, /rejected/);
});
test('snapshot rebinds the same Editor/TFile after new sourceId and temporary absence', () => {
  const o = owner(), observer = new StateObserver(o.ownership, new Identities(), o.journal); let current, subscribed = [], stopped = [];
  const plugin = {getEditorSnapshot() { return current; }, subscribeEditorSnapshot(_editor, fn) { const id = current.sourceId; subscribed.push(id); return () => stopped.push(id); }};
  const state = id => ({sourceId: id, state: {status: 'pending', generation: {sourceText: o.editor.text, sourcePath: o.file.path}}, insertionExhausted: true});
  current = state('first'); observer.reconcile(plugin); observer.reconcile(plugin); assert.deepEqual(subscribed, ['first']);
  current = undefined; observer.reconcile(plugin); assert.deepEqual(stopped, ['first']);
  current = state('second'); observer.reconcile(plugin); current = state('third'); observer.reconcile(plugin);
  assert.deepEqual(subscribed, ['first', 'second', 'third']); assert.deepEqual(stopped, ['first', 'second']); observer.dispose(); assert.deepEqual(stopped, ['first', 'second', 'third']);
});
test('snapshot notification IDs describe actual snapshots, not mathematical evaluation counts', () => {
  const o = owner(), ids = new Identities(), observer = new StateObserver(o.ownership, ids, o.journal), callbacks = [];
  const snapshot = {generation: {sourceText: o.editor.text, sourcePath: o.file.path}, calculations: [], diagnostics: []};
  const plugin = {getEditorSnapshot() { return {sourceId: 'same', state: {status: 'ready', snapshot}}; }, subscribeEditorSnapshot(_e, fn) { callbacks.push(fn); return () => {}; }};
  observer.reconcile(plugin); callbacks[0](); const records = o.journal.records.filter(r => r.kind === 'snapshot');
  assert.equal(records.length, 2); assert.equal(records[0].snapshotId, records[1].snapshotId); assert.ok(records.every(r => !('evaluationCount' in r))); observer.dispose(); callbacks[0](); assert.equal(o.journal.records.filter(r => r.kind === 'snapshot').length, 2);
});
for (const eventFirst of [true, false]) test(`popout event/returned leaf ordering: eventFirst=${eventFirst}`, () => {
  const app = {}, win = {app, closed: false}, doc = {defaultView: win}, leaf = {view: {containerEl: {ownerDocument: doc}}}, workspace = {win};
  const ticket = new PopoutTicket(() => 0);
  if (eventFirst) ticket.observe(workspace, win); else ticket.setLeaf(leaf);
  assert.equal(ticket.proof(app), undefined);
  if (eventFirst) ticket.setLeaf(leaf); else ticket.observe(workspace, win);
  assert.equal(ticket.proof(app).win, win); ticket.cancel(); assert.throws(() => ticket.proof(app), /popout-deadline/);
});
test('popout does not accept an unrelated event and expires without a proven route', () => {
  let time = 0; const app = {}, unrelated = {app}, intended = {app}, ticket = new PopoutTicket(() => time);
  ticket.observe({win: unrelated}, unrelated); ticket.setLeaf({view: {containerEl: {ownerDocument: {defaultView: intended}}}});
  assert.equal(ticket.proof(app), undefined); time = 10001; assert.throws(() => ticket.proof(app), /popout-deadline/);
});
test('bounded data projection refuses accessors without invoking them and preserves prototype-like keys', () => {
  let read = false; const accessor = {get bad() { read = true; return 1; }}; assert.throws(() => data(accessor), /value-accessor/); assert.equal(read, false);
  assert.equal(Object.getPrototypeOf(data(JSON.parse('{"__proto__":{"x":1}}'))), null);
});
test('journal overflow/deadline is visible rather than a silent partial trace', () => {
  let time = 0; const journal = new Journal(() => time); journal.sequence = 20000; journal.emit('overflow'); assert.ok(journal.faults.has('observer-overflow'));
  time = 480001; journal.emit('late'); assert.ok(journal.faults.has('observer-deadline')); assert.equal(journal.records.length, 0);
});

test('ownership retires immediately when a container moves to a different document', () => {
  const o = owner(); assert.ok(o.ownership.current(o.editor)); o.view.containerEl.ownerDocument = {};
  assert.equal(o.ownership.current(o.editor), undefined);
});
test('snapshot from a retired source session cannot match the current editor', () => {
  const o = owner(), observer = new StateObserver(o.ownership, new Identities(), o.journal);
  observer.reconcile({getEditorSnapshot() { return {sourceId: 'new', state: {status: 'ready', snapshot: {generation: {sourceId: 'old', sourceText: o.editor.text, sourcePath: o.file.path}, calculations: [], diagnostics: []}}}; }, subscribeEditorSnapshot() { return () => {}; }});
  assert.equal(o.journal.records.find(r => r.kind === 'snapshot').sourceMatches, false); observer.dispose();
});
test('a failed state unsubscribe does not prevent remaining subscriptions and settings cleanup', () => {
  const o = owner(), observer = new StateObserver(o.ownership, new Identities(), o.journal), calls = [];
  observer.stops.set('first', {stop() { calls.push('first'); throw Error('broken'); }});
  observer.stops.set('second', {stop() { calls.push('second'); }}); observer.stopSettings = () => calls.push('settings');
  observer.dispose(); observer.dispose(); assert.deepEqual(calls, ['first', 'second', 'settings']);
  assert.ok(o.journal.faults.has('state-cleanup-failed'));
});
