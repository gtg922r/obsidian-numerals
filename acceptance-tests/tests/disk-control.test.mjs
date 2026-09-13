import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DiskEvidence} from '../disk.mjs';
import {installControl} from '../control.mjs';
import C from '../contracts.cjs';

test('disk evidence preserves CRLF/BOM bytes, missing files and distinct normalized editor text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acceptance-disk-')); await fs.mkdir(path.join(root, 'acceptance'));
  const bytes = Buffer.from('\ufeff😀 before\r\nafter\r\n'); await fs.writeFile(path.join(root, 'acceptance/x.md'), bytes);
  const disk = new DiskEvidence(root, ['acceptance/x.md', 'acceptance/missing.md'], () => {});
  try {
    const first = await disk.capture(), second = await disk.capture(); assert.deepEqual(first, second); assert.equal(Object.keys(disk.blobs).length, 1);
    assert.equal(first['acceptance/missing.md'].exists, false); assert.deepEqual(Buffer.from(disk.blobs[C.hash(bytes)], 'base64'), bytes);
    const normalized = bytes.toString().replace(/^\ufeff/, '').replace(/\r\n/g, '\n'); assert.notEqual(C.hash(normalized), first['acceptance/x.md'].sha256);
    await fs.writeFile(path.join(root, 'acceptance/x.md'), normalized); assert.notEqual((await disk.capture())['acceptance/x.md'].sha256, first['acceptance/x.md'].sha256);
  } finally { await fs.rm(root, {recursive: true}); }
});
test('control has action handles only and refuses an installed observer; disposal removes handles', async () => {
  const win = {document: {}}, app = {vault: {adapter: {getBasePath: () => '/fixture'}}, plugins: {getPlugin: () => null}}; win.app = app;
  const context = vm.createContext({window: win, performance});
  const config = {root: '/fixture', nonce: 'n', paths: ['acceptance/x.md'], caseIds: ['ORD-01']};
  vm.runInContext(`(${installControl.toString()})(${JSON.stringify(config)})`, context);
  assert.equal(typeof win.__numeralsAcceptanceControl.call, 'function');
  assert.equal(app.workspace, undefined); // No registration/extension/event APIs were needed or touched.
  await win.__numeralsAcceptanceControl.call('n', {op: 'dispose'}); assert.equal(Object.hasOwn(win, '__numeralsAcceptanceControl'), false);
  app.plugins.getPlugin = () => ({}); assert.throws(() => vm.runInContext(`(${installControl.toString()})(${JSON.stringify(config)})`, context), /control-identity/);
});

test('control targets the selected pane and rejects targeted splits and leaf overflow before mutation', async () => {
  const {paneHost} = await import('./support.mjs'), h = paneHost(), config = {root: '/fixture', nonce: 'n', paths: [...h.files.keys()], caseIds: ['ORD-01']};
  vm.runInNewContext(`(${installControl.toString()})(${JSON.stringify(config)})`, {window: h.win, performance});
  const bridge = h.win.__numeralsAcceptanceControl, call = operation => bridge.call('n', {actionId: 'action-1', ...operation});
  await call({op: 'beginCase', caseId: 'ORD-01'});
  const left = await call({op: 'open', path: 'acceptance/a.md'}); await call({op: 'split', path: 'acceptance/b.md'});
  assert.equal((await call({op: 'open', path: 'acceptance/c.md', target: 'left', leafId: left.leafId})).leafId, left.leafId);
  assert.deepEqual(h.leaves.map(leaf => leaf.view.file.path), ['acceptance/c.md', 'acceptance/b.md']);
  await assert.rejects(call({op: 'split', path: 'acceptance/a.md', target: 'left', leafId: left.leafId}), /control-guard/);
  while (h.leaves.length < 6) await call({op: 'split', path: 'acceptance/a.md'});
  await assert.rejects(call({op: 'split', path: 'acceptance/a.md'}), /control-guard/); assert.equal(h.leaves.length, 6);
  await call({op: 'open', path: 'acceptance/a.md', leafId: left.leafId}); assert.equal(h.leaves.length, 6);
});

test('control refuses every existing-pane action after ownership changes, before any action side effect', async () => {
  const {paneHost, paneInvalidations, existingPaneActions, spyPaneActions} = await import('./support.mjs');
  for (const [name, invalidate] of Object.entries(paneInvalidations)) for (const op of existingPaneActions) {
    const h = paneHost(), config = {root: '/fixture', nonce: 'n', paths: [...h.files.keys()], caseIds: ['ORD-01']};
    vm.runInNewContext(`(${installControl.toString()})(${JSON.stringify(config)})`, {window: h.win, performance});
    const bridge = h.win.__numeralsAcceptanceControl, call = operation => bridge.call('n', {actionId: 'action-1', ...operation});
    await call({op: 'beginCase', caseId: 'ORD-01'}); const opened = await call({op: 'open', path: 'acceptance/a.md'}), leaf = h.leaves[0], calls = spyPaneActions(h, leaf);
    invalidate(h, leaf);
    await assert.rejects(call({op, leafId: opened.leafId, from: 0, to: 0, offset: 0, mode: 'reading'}), /control-guard/, `${name}:${op}`);
    assert.deepEqual(calls, [], `${name}:${op}`);
  }
});
test('control rechecks ownership after workspace and editor focus callbacks before returning input permission', async () => {
  for (const callback of ['workspace', 'editor']) for (const invalidation of ['view-file', 'vault-file']) {
  const {paneHost, spyPaneActions} = await import('./support.mjs'), h = paneHost(), config = {root: '/fixture', nonce: 'n', paths: [...h.files.keys()], caseIds: ['ORD-01']};
  vm.runInNewContext(`(${installControl.toString()})(${JSON.stringify(config)})`, {window: h.win, performance});
  const call = operation => h.win.__numeralsAcceptanceControl.call('n', {actionId: 'action-1', ...operation});
  await call({op: 'beginCase', caseId: 'ORD-01'}); const opened = await call({op: 'open', path: 'acceptance/a.md'}), leaf = h.leaves[0], calls = spyPaneActions(h, leaf);
  h.app.workspace.setActiveLeaf = () => {};
  leaf.view.editor.focus = () => {};
  const invalidate = () => { if (invalidation === 'view-file') leaf.view.file = {path: 'unexpected.md'}; else h.files.set('acceptance/a.md', {path: 'acceptance/a.md'}); };
  if (callback === 'workspace') h.app.workspace.setActiveLeaf = invalidate; else leaf.view.editor.focus = invalidate;
  await assert.rejects(call({op: 'focus', leafId: opened.leafId}), /control-guard/); assert.deepEqual(calls, []);
  }
});
