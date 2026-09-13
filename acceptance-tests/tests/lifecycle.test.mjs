import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import C from '../contracts.cjs';
import {Journal, Identities} from '../observer-core.cjs';
import {cmObserver} from '../observer-cm-dom.cjs';
import {owner} from './support.mjs';

// Loads only authored helper source with a fake public Component boundary, never Obsidian/app bytes.
export function helperClass() {
  class Plugin {
    constructor() { this.cleanups = []; this.unloaded = false; }
    register(fn) { this.cleanups.push(fn); }
    unload() { if (this.unloaded) return; this.unloaded = true; for (const fn of this.cleanups.splice(0)) fn(); }
  }
  const module = {exports: {}}, localRequire = createRequire(new URL('../observer.cjs', import.meta.url));
  vm.runInNewContext(fs.readFileSync(new URL('../observer.cjs', import.meta.url), 'utf8'), {module, exports: module.exports, process,
    require(name) { if (name === 'obsidian') return {Plugin}; if (name.startsWith('@codemirror/')) return {}; if (name === './contracts.cjs') return {...C, guard() {}}; return localRequire(name); }, setTimeout, clearTimeout});
  return module.exports;
}
test('bridge dispose uses Component unload and all registered cleanup, idempotently', async () => {
  const Observer = helperClass(), helper = new Observer(), calls = [];
  Object.assign(helper, {root: '/unused', config: {nonce: 'nonce'}, journal: new Journal(), state: {dispose() { calls.push('state'); }}, stopVault() { calls.push('vault'); }, stops: new Map([['editor', () => calls.push('editor')]]), windowStops: new Map([['window', () => calls.push('bridge')]]), ownership: {dispose() { calls.push('owners'); }}});
  helper.register(() => helper.dispose()); helper.register(() => calls.push('event-listeners')); helper.register(() => calls.push('cm-extension'));
  const result = await helper.call('nonce', {op: 'dispose'});
  assert.equal(result.disposed, true); assert.deepEqual(calls, ['vault', 'state', 'editor', 'bridge', 'owners', 'event-listeners', 'cm-extension']);
  helper.unload(); helper.dispose(); assert.equal(calls.length, 7); assert.equal(helper.journal.closed, true);
  await assert.rejects(helper.call('nonce', {op: 'observe'}), /bridge-identity/);
});
test('partial startup unload tolerates missing resources and closes acquired registrations', () => {
  const Observer = helperClass(), helper = new Observer(); let released = 0;
  helper.register(() => helper.dispose()); helper.register(() => released++); helper.unload(); helper.unload(); assert.equal(released, 1); assert.equal(helper.dead, true);
});
test('CM observer records identity-linked native input and updates without dispatch/filter hooks', async () => {
  const o = owner(), infoField = {}, lpField = {}, userEvent = {}, remote = {}, ids = new Identities();
  const doc = text => ({toString: () => text}), start = {doc: doc(o.editor.text), selection: {main: {from: 3, to: 3}, ranges: [{}]}, field: field => field === infoField ? {editor: o.editor, file: o.file} : true};
  const view = {state: start, dom: {closest: () => null}, composing: false};
  const extension = cmObserver({ViewPlugin: {fromClass(Class, spec) { return {Class, spec}; }}, editorInfoField: infoField, editorLivePreviewField: lpField, Transaction: {userEvent, remote}}, {ownership: o.ownership, ids, journal: o.journal, reconcile() {}});
  assert.deepEqual(Object.keys(extension.spec), ['eventObservers']);
  const observer = new extension.Class(view), event = {type: 'input', inputType: 'insertText', data: '4', isTrusted: true, defaultPrevented: false}; observer.observe(event);
  o.editor.text += '4'; const state = {...start, doc: doc(o.editor.text)}; view.state = state;
  const transaction = {startState: start, state, newDoc: state.doc, docChanged: true, changes: {iterChanges(fn) { fn(3, 3, 3, 4, doc('4')); }}, annotation: key => key === userEvent ? 'input.type' : false, isUserEvent: () => false};
  observer.update({transactions: [transaction]});
  const witness = o.journal.records.find(r => r.kind === 'native-input'), change = o.journal.records.find(r => r.kind === 'cm-transaction');
  assert.equal(change.witnessEventId, witness.eventId); assert.equal(change.startStateId, witness.startStateId); assert.equal(change.after, '1+24');
  assert.equal(view.dispatch, undefined); observer.destroy(); await Promise.resolve();
});
test('CM observation failures stay out of the host dispatch path', () => {
  const o = owner(), extension = cmObserver({ViewPlugin: {fromClass(Class) { return Class; }}}, {ownership: o.ownership, ids: new Identities(), journal: o.journal, reconcile() {}});
  const observer = new extension({state: {field() { throw Error('host unavailable'); }}}); assert.doesNotThrow(() => observer.update({})); assert.ok(o.journal.faults.has('cm-observation-gap'));
});

test('throwing cleanup continues through every acquired resource and invalidates evidence', async () => {
  const Observer = helperClass(), helper = new Observer(), calls = [];
  Object.assign(helper, {root: '/unused', config: {nonce: 'nonce'}, journal: new Journal(), state: {dispose() { throw Error('broken'); }},
    stops: new Map([['bad', () => { calls.push('bad'); throw Error('broken'); }], ['good', () => calls.push('good')]]),
    windowStops: new Map([['window', () => calls.push('bridge')]]), ownership: {dispose() { calls.push('owners'); }}});
  helper.register(() => helper.dispose()); helper.register(() => calls.push('component'));
  const receipt = await helper.call('nonce', {op: 'dispose'});
  assert.deepEqual(calls, ['bad', 'good', 'bridge', 'owners', 'component']); assert.equal(receipt.mode, 'instrumented');
  assert.ok(receipt.cleanup.faults.includes('observer-cleanup-failed')); assert.equal(helper.journal.closed, true);
});

test('observer targets the selected pane and refuses leaf overflow before creating anything', async () => {
  const {paneHost} = await import('./support.mjs'), h = paneHost(), Observer = helperClass(), helper = new Observer();
  const {Ownership} = await import('../observer-core.cjs');
  Object.assign(helper, {app: h.app, root: '/fixture', config: {nonce: 'n'}, allowedNotes: new Set(h.files.keys()), leaves: new Map(), ids: new Identities(), journal: new Journal()});
  helper.ownership = new Ownership(helper.journal, helper.ids); helper.ownership.addWindow(h.win, {document: h.document});
  helper.journal.context.caseId = 'ORD-01';
  helper.reconcile = () => { for (const leaf of h.leaves) if (leaf.view.file) helper.ownership.addEditor(leaf.view.editor, {view: leaf.view, file: leaf.view.file, window: h.win, leaf}); };
  const call = operation => helper.call('n', {actionId: 'action-1', ...operation});
  const left = await call({op: 'open', path: 'acceptance/a.md'}), right = await call({op: 'split', path: 'acceptance/b.md'});
  const reopened = await call({op: 'open', path: 'acceptance/c.md', target: 'left', leafId: left.leafId});
  assert.equal(reopened.leafId, left.leafId); assert.notEqual(right.leafId, left.leafId);
  assert.deepEqual(h.leaves.map(leaf => leaf.view.file.path), ['acceptance/c.md', 'acceptance/b.md']);
  await assert.rejects(call({op: 'split', path: 'acceptance/a.md', target: 'left', leafId: left.leafId}), /targeted-split-driver-pending/);
  while (h.leaves.length < 6) await call({op: 'split', path: 'acceptance/a.md'});
  for (let i = 0; i < 3; i++) await assert.rejects(call({op: 'split', path: 'acceptance/a.md'}), /editor-limit/);
  assert.equal(h.leaves.length, 6);
  await call({op: 'open', path: 'acceptance/a.md', leafId: left.leafId}); assert.equal(h.leaves.length, 6);
});
