import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingAnchors, ownerProof, readCurrent} from '../native-reader.cjs';
import {Identities, Journal} from '../observer-core.cjs';
import N from '../native-sample.cjs';
import C from '../contracts.cjs';

function fixture() {
  const text = '`#: $f(2)`\n\n`#: $f(2)`', ids = new Identities(), journal = new Journal();
  const document = {}, win = {document, innerWidth: 1200, innerHeight: 1000,
    getComputedStyle: node => ({display: 'inline', visibility: node.hiddenValue ? 'hidden' : 'visible', opacity: node.transparent ? '0' : '1'})}; document.defaultView = win;
  const file = {path: 'acceptance/ordering.md'}, editor = {getValue: () => text};
  const codes = [0, 2].map(line => ({
    line, original: '#: $f(2)', textContent: '#: $f(2)', product: false, isConnected: true, ownerDocument: document,
    classList: {contains(name) { return name === 'numerals-inline' && codes.find(c => c.classList === this).product; }},
    getAttribute() { return this.product ? this.original : null; }, closest() { return null; },
    contains(node) { return node === this.value; },
    getClientRects() { return [{width: 80, height: 25, top: line * 30, bottom: line * 30 + 25, left: 0, right: 80}]; },
    querySelectorAll(selector) { return selector === '.numerals-inline-value' && this.product ? [this.value] : []; },
    value: {textContent: line === 0 ? '14' : '16', querySelectorAll: () => []},
  }));
  codes.forEach(code => Object.assign(code.value, {isConnected: true, ownerDocument: document, parentElement: code,
    getClientRects: () => code.getClientRects(), contains: () => false}));
  document.elementFromPoint = (_x, y) => { const code = codes.find(c => y >= c.line * 30 && y <= c.line * 30 + 25); return code?.product ? code.value : code; };
  const root = {matches: () => false, querySelectorAll: () => codes, contains: code => codes.includes(code)};
  const renderer = {lastText: text, getSectionInfo: code => ({text: renderer.lastText, lineStart: code.line, lineEnd: code.line})};
  const view = {file, editor, containerEl: root, getViewData: () => text, getMode: () => 'preview', previewMode: {renderer}};
  root.ownerDocument = document;
  const leaf = {view}, owner = {view, file, window: win};
  const context = {sourcePath: file.path, getSectionInfo: renderer.getSectionInfo, addChild(child) { child.loaded = true; }};
  const children = [], host = {allowedNotes: new Set([file.path]), ids, journal};
  const anchors = new ReadingAnchors(host, () => {
    const child = {callbacks: [], register(fn) { this.callbacks.push(fn); }, unload() { for (const fn of this.callbacks) fn(); this.unloaded = true; }};
    children.push(child); return child;
  });
  anchors.capture(root, context);
  const generation = {sourceId: 'source-1', sourceText: text, sourcePath: file.path, sourceRevision: 1, evaluationSettingsRevision: '1'};
  const index = {source: {sourceId: 'source-1', text, revision: 1}, calculations: [0, 12].map((start, i) => ({kind: 'inline', id: 'calc-' + i,
    span: {start, end: start + 10}, projection: {text: '#: $f(2)'}}))};
  const state = {status: 'ready', snapshot: {generation, calculations: [14, 16].map((result, i) => ({calculationId: 'calc-' + i, rows: [{rowIndex: 0, result}]}))}};
  let snapshotCalls = 0;
  const plugin = {settingsGeneration: 1, evaluationSettingsGeneration: 1, manifest: {id: 'numerals', version: '1.11.0', minAppVersion: '1.13.0'},
    getEditorSnapshot() { snapshotCalls++; return {sourceId: 'source-1', index, state, settings: {}}; }};
  const guard = (_leaf, expected) => {
    C.check(_leaf === leaf && leaf.view === view && view.file === file && view.editor === editor && root.ownerDocument === document, 'fake-current-owner');
    C.check(!expected || expected === owner, 'fake-owner-changed'); return owner;
  };
  const request = {id: 'first', caseId: 'ORD-01', actionId: 'action-4', leafId: ids.id(leaf, 'leaf'), path: file.path, mode: 'reading',
    sourceSha256: C.hash(text), target: {kind: 'inline', start: 0, end: 10, raw: '`#: $f(2)`'}, expected: {text: '14', value: 14}};
  request.owner = ownerProof(leaf, owner, ids);
  const read = (mode = 'instrumented', getPlugin = () => plugin) => readCurrent({leaf, request, mode, guard, ids, getPlugin, anchors,
    versions: {host: '1.13.7', api: '1.13.7', mathJax: null}, faults: journal.faults});
  return {text, ids, leaf, owner, view, codes, root, context, children, anchors, renderer, state, plugin, request, read, snapshotCalls: () => snapshotCalls};
}
function render(h) { h.codes.forEach(code => { code.product = true; code.textContent = code.value.textContent; }); }

test('before-native anchors retain actual code/original context across transformed revisits and unload idempotently', () => {
  const h = fixture(), original = h.anchors.codes.get(h.codes[0]); render(h);
  h.anchors.capture(h.root, {...h.context});
  assert.equal(h.anchors.codes.get(h.codes[0]), original); assert.equal(original.original, '#: $f(2)');
  assert.equal(original.code, h.codes[0]); assert.equal(original.context, h.context); assert.equal(original.sectionAtCapture.lineStart, 0);
  h.children[0].unload(); assert.equal(h.anchors.codes.has(h.codes[0]), false);
  h.anchors.dispose(); h.anchors.dispose(); assert.equal(h.anchors.codes.size, 0); assert.ok(h.children.every(c => c.unloaded));
});
test('current reads accept reallocated outer snapshot wrappers while binding equal expressions to separate native spans', () => {
  const h = fixture(); render(h);
  const first = h.read(); assert.equal(N.sampleAssessment(first, h.request, 'instrumented').status, 'PASS');
  assert.equal(h.snapshotCalls(), 2); assert.equal(first.occurrence.original, '#: $f(2)');
  h.request.target = {...h.request.target, start: 12, end: 22}; h.request.expected = {value: 16, text: '16'};
  const second = h.read(); assert.equal(N.sampleAssessment(second, h.request, 'instrumented').status, 'PASS');
  assert.notEqual(first.occurrence.elementId, second.occurrence.elementId); assert.notEqual(first.occurrence.calculationId, second.occurrence.calculationId);
});
test('a replaced state, file or settings during the synchronous read invalidates the current sample', () => {
  for (const change of ['state', 'file', 'settings']) {
    const h = fixture(); render(h); const original = h.plugin.getEditorSnapshot; let calls = 0;
    h.plugin.getEditorSnapshot = () => {
      const source = original();
      if (++calls === 2) {
        if (change === 'state') source.state = {...source.state};
        if (change === 'file') h.view.file = {...h.view.file};
        if (change === 'settings') h.plugin.settingsGeneration++;
      }
      return source;
    };
    assert.equal(h.read().available, false, change);
  }
});
test('observer-absent controls use current pinned renderer source without touching any evaluator or anchor registration', () => {
  const h = fixture(); h.anchors.dispose(); render(h);
  h.plugin.getEditorSnapshot = () => { throw Error('must-not-read-evaluator'); };
  assert.equal(N.sampleAssessment(h.read('control'), h.request, 'control').status, 'PASS');
  h.renderer.lastText += 'stale'; assert.equal(h.read('control').available, false);
  h.renderer.lastText = h.text; h.codes.forEach(c => { c.product = false; c.textContent = c.original; });
  assert.equal(N.sampleAssessment(h.read('numerals-disabled', () => null), h.request, 'numerals-disabled').status, 'PASS');
  assert.equal(h.read('numerals-disabled').available, false); assert.equal(h.anchors.codes.size, 0);
});
test('pending, ambiguous, detached and stale full-buffer occurrences cannot pass', () => {
  for (const change of ['pending', 'duplicate', 'detached', 'buffer']) {
    const h = fixture(); render(h);
    if (change === 'pending') h.state.status = 'pending';
    if (change === 'duplicate') h.root.querySelectorAll = () => [h.codes[0], h.codes[0]];
    if (change === 'detached') h.codes[0].isConnected = false;
    if (change === 'buffer') h.view.getViewData = () => 'changed';
    assert.notEqual(N.sampleAssessment(h.read(), h.request, 'instrumented').status, 'PASS', change);
  }
});

test('a hit-tested code wrapper cannot substitute for a hidden result or hidden result ancestor', () => {
  for (const hide of [h => { h.codes[0].value.hiddenValue = true; }, h => { h.codes[0].transparent = true; }, h => { h.codes[0].value.hidden = true; }]) {
    const h = fixture(); render(h); hide(h);
    assert.notEqual(N.sampleAssessment(h.read(), h.request, 'instrumented').status, 'PASS');
  }
});
test('an unanchored cloned rendered code node invalidates coverage rather than disappearing from occurrence matching', () => {
  const h = fixture(); render(h);
  h.root.querySelectorAll = () => [...h.codes, {...h.codes[0]}];
  const sample = h.read(); assert.equal(sample.available, false); assert.equal(sample.reason, 'current-native-anchor-gap');
});
