import {ReadingAnchors, ownerProof, readCurrent} from '../native-reader.cjs';
import {Identities, Journal} from '../observer-core.cjs';
import C from '../contracts.cjs';

export function fixture() {
  const text = '`#: $f(2)`\n\n`#: $f(2)`', ids = new Identities(), journal = new Journal();
  const document = {}, win = {document, innerWidth: 1200, innerHeight: 1000,
    getComputedStyle: node => ({display: 'inline', visibility: node.hiddenValue ? 'hidden' : 'visible', opacity: node.transparent ? '0' : '1'})}; document.defaultView = win;
  const file = {path: 'acceptance/ordering.md'}, editor = {getValue: () => text};
  const codes = [0, 2].map(line => ({
    line, matches: selector => selector === 'code', original: '#: $f(2)', textContent: '#: $f(2)', product: false, isConnected: true, ownerDocument: document,
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
  const root = {isConnected: true, matches: () => false, querySelectorAll: () => codes, contains: code => codes.includes(code)};
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
export function render(h) { h.codes.forEach(code => { code.product = true; code.textContent = code.value.textContent; }); }

