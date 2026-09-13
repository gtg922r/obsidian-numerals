import test from 'node:test';
import assert from 'node:assert/strict';
import {runFamily, nativeAction} from '../controller.mjs';
import {targetProof, Connection} from '../cdp.mjs';
import {validateFamily} from '../validate.mjs';
import {catalog, plan} from './support.mjs';
import C from '../contracts.cjs';

test('cancellation after an awaited host action prevents the next action; cleanup always runs', async () => {
  const abort = new AbortController(), performed = []; let disposed = 0;
  const backend = {assertOwned() {}, async begin() {}, async action(a) { performed.push(a.op); abort.abort(); return {}; }, async drain() { return {records: [], faults: []}; }, async end() {}, async dispose() { disposed++; }};
  await assert.rejects(runFamily(backend, plan(), catalog, abort.signal), error => error.message === 'controller-cancelled' && error.familyEvidence.actions.length === 1);
  assert.deepEqual(performed, ['open']); assert.equal(disposed, 1);
});
test('failure preserves earlier observations and the action that did not complete', async () => {
  let n = 0;
  const backend = {assertOwned() {}, async begin() {}, async action() { if (++n === 2) throw Error('failure'); return {leafId: 'leaf'}; }, async drain() { return {records: [{sequence: 1, caseId: 'ORD-01', kind: 'snapshot'}], faults: []}; }, async end() {}, async dispose() { return {disposed: true, mode: 'control', cleanup: {records: [], faults: ['wrapper-replaced']}}; }};
  await assert.rejects(runFamily(backend, plan(), catalog, new AbortController().signal), error => {
    assert.equal(error.familyEvidence.actions[1].status, 'started'); assert.equal(error.familyEvidence.observations.records.length, 1); assert.deepEqual(error.familyEvidence.observations.faults, ['wrapper-replaced']); return true;
  });
});
test('native typing uses CDP input without claiming a trusted event was seen', async () => {
  const calls = []; const result = await nativeAction({async request(...args) { calls.push(args); }}, {op: 'type', text: 'x'});
  assert.equal(calls[0][0], 'Input.insertText'); assert.equal(result.proof, 'requires-observed-native-event');
  await assert.rejects(nativeAction({request() { throw Error('should-not-call'); }}, {op: 'key', key: 'anything'}), /native-key/);
});
test('about:blank requires exact popout identity, not URL/title or a stale nonce', () => {
  const target = {type: 'page', url: 'about:blank'}, expected = {nonce: 'a', root: '/tmp/owned', windowId: 'window-2', role: 'popout'};
  const hello = {id: C.ID, ...expected, appMatches: true}; assert.equal(targetProof(target, hello, expected), 'window-2');
  assert.throws(() => targetProof(target, {...hello, nonce: 'other'}, expected), /target-proof/);
  assert.throws(() => targetProof(target, {...hello, role: 'main'}, {...expected, role: 'main'}), /target-role/);
});
test('CDP close rejects pending work, with no dangling wait', async () => {
  const callbacks = {}, socket = {addEventListener(k, cb) { callbacks[k] = cb; }, send() {}, close() {}}, connection = new Connection(socket);
  const pending = connection.request('Runtime.evaluate', {}); connection.close(); await assert.rejects(pending, /cdp-closed/); assert.equal(connection.pending.size, 0);
});
test('stable output and snapshot notifications never prove zero math or universal no writes', () => {
  const p = plan(); p.cases[0].assertions = [{kind: 'zero-evaluations'}, {kind: 'no-background-writes'}];
  const result = validateFamily(p, {records: [{sequence: 1, caseId: 'ORD-01', sourcePath: p.cases[0].path, kind: 'snapshot'}], faults: []})[0];
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.assertions[0].status, 'UNAVAILABLE'); assert.equal(result.assertions[1].status, 'PARTIAL');
});
test('DOM source text cannot substitute for product-owned rendered output, and faults block passes', () => {
  const p = plan(), r = {sequence: 1, caseId: 'ORD-01', sourcePath: p.cases[0].path, kind: 'surface', buffer: '14', occurrences: []};
  assert.equal(validateFamily(p, {records: [r], faults: []})[0].assertions[0].status, 'NOT_OBSERVED');
  r.occurrences = [{connected: true, text: '14'}]; assert.equal(validateFamily(p, {records: [r], faults: ['gap']})[0].assertions[0].status, 'PARTIAL');
  assert.equal(validateFamily(p, {records: [r], faults: []})[0].status, 'PARTIAL');
});
test('one-write needs candidate attribution, actual CM change and complete buffer agreement', () => {
  const p = plan(); p.cases[0].assertions = [{kind: 'one-write', actionId: 'action-1', before: 'old', after: 'new'}];
  const records = ['editor-wrapper-ready', 'editor-transaction-start', 'cm-transaction', 'editor-transaction-end'].map((kind, i) => ({kind, sequence: i + 1, caseId: 'ORD-01', sourcePath: p.cases[0].path, editorId: 'e', windowId: 'w', wrapperSessionId: 's', transactionId: 'tx', actionId: 'action-1', source: 'numerals', origin: 'numerals-insertion', userEvent: 'numerals-insertion', before: 'old', after: 'new', threw: false, stillOwned: true}));
  assert.equal(validateFamily(p, {records, faults: []})[0].assertions[0].status, 'PASS');
  for (const key of ['editorId', 'windowId', 'wrapperSessionId', 'transactionId', 'actionId']) {
    const copy = structuredClone(records); copy[2][key] = 'other'; copy[3][key] = 'other';
    assert.equal(validateFamily(p, {records: copy, faults: []})[0].assertions[0].status, 'FAIL', key);
  }
  records[2].after = 'other'; assert.equal(validateFamily(p, {records, faults: []})[0].assertions[0].status, 'FAIL');
  records[1].source = 'unknown'; assert.equal(validateFamily(p, {records, faults: []})[0].assertions[0].status, 'UNAVAILABLE');
});
test('unseen cases remain NOT_RUN and out-of-order traces are rejected', () => {
  assert.equal(validateFamily(plan(), {records: [], faults: []})[0].status, 'NOT_RUN');
  assert.throws(() => validateFamily(plan(), {records: [{sequence: 2}, {sequence: 1}], faults: []}), /evidence-order/);
});

test('a pending backend action rejects on abort and still requires explicit cleanup receipt', async () => {
  const abort = new AbortController(); let disposed = false;
  const backend = {mode: 'instrumented', assertOwned() {}, begin() {}, action() { queueMicrotask(() => abort.abort()); return new Promise(() => {}); }, dispose() { disposed = true; return undefined; }};
  await assert.rejects(runFamily(backend, plan(), catalog, abort.signal), error => {
    assert.equal(error.message, 'controller-cancelled'); assert.ok(error.familyEvidence.observations.faults.includes('backend-cleanup-unconfirmed')); return true;
  }); assert.equal(disposed, true);
});
test('absent, wrong-mode and hung cleanup cannot leave strict DOM claims passing', async () => {
  for (const receipt of [undefined, {}, {disposed: true, mode: 'control', cleanup: {records: [], faults: []}}, 'hung']) {
    let seq = 0;
    const backend = {mode: 'instrumented', cleanupTimeoutMs: 5, assertOwned() {}, begin() {}, action() { return {leafId: 'a'}; }, end() {},
      drain() { return {records: [{sequence: ++seq, caseId: 'ORD-01', sourcePath: plan().cases[0].path, kind: 'surface', occurrences: [{connected: true, text: '14'}]}], faults: []}; },
      dispose() { return receipt === 'hung' ? new Promise(() => {}) : receipt; }};
    const family = await runFamily(backend, plan(), catalog, new AbortController().signal);
    assert.equal(family.failure.reason, 'backend-cleanup-unconfirmed');
    assert.equal(validateFamily(plan(), family.observations)[0].assertions[0].status, 'PARTIAL');
  }
});

test('historical value existence cannot establish post-edit, deleted, pending or other-pane current behavior', () => {
  for (const later of [
    {status: 'ready', calculations: [{calculationId: 'x', rows: [{rowIndex: 0, result: 3}]}]},
    {status: 'ready', calculations: []},
    {status: 'pending', calculations: []},
    {status: 'ready', editorId: 'other-pane', calculations: [{calculationId: 'x', rows: [{rowIndex: 0, result: 2}]}]},
  ]) {
    const p = plan(), common = {caseId: 'ORD-01', sourcePath: p.cases[0].path, available: true, sourceMatches: true, editorId: 'e'};
    const records = [{...common, kind: 'snapshot', sequence: 1, actionId: 'action-1', status: 'ready', calculations: [{calculationId: 'x', rows: [{rowIndex: 0, result: 2}]}]},
      {...common, kind: 'snapshot', sequence: 2, actionId: 'action-2', ...later}];
    p.cases[0].assertions = [{kind: 'numeric-result', value: 2, calculationId: 'x', rowIndex: 0}, {kind: 'observed-numeric-result', value: 2, calculationId: 'x', rowIndex: 0}];
    const results = validateFamily(p, {records, faults: []})[0];
    assert.equal(results.assertions[0].status, 'UNAVAILABLE'); assert.equal(results.assertions[1].status, 'OBSERVED');
    assert.equal(results.assertions[1].scope, 'historical-existence-only'); assert.equal(results.status, 'PARTIAL');
  }
  const p = plan(); p.cases[0].assertions = [{kind: 'dom-text', text: '14'}];
  assert.equal(validateFamily(p, {records: [{sequence: 1, caseId: 'ORD-01', sourcePath: p.cases[0].path, kind: 'surface', occurrences: [{connected: true, text: '14'}]}], faults: []})[0].assertions[0].status, 'UNAVAILABLE');
});
