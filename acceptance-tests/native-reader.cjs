'use strict';
const C = require('./contracts.cjs');
const {data} = require('./observer-core.cjs');
const {normalize, bindTarget} = require('./native-sample.cjs');

class ReadingAnchors {
  constructor(host, makeChild) { this.host = host; this.makeChild = makeChild; this.codes = new Map(); this.closed = false; }
  capture(root, context) {
    if (this.closed || !this.host.allowedNotes.has(context.sourcePath)) return;
    const nodes = [...(root.matches('code') ? [root] : []), ...root.querySelectorAll('code')];
    for (const code of nodes) {
      if (code.closest('pre, .cm-editor, .markdown-embed, .internal-embed')) continue;
      const existing = this.codes.get(code);
      // Revisited transformed content is not new source; never replace the raw capture with its answer.
      if (existing && existing.path === context.sourcePath && code.classList.contains('numerals-inline')) continue;
      const original = code.textContent;
      if (typeof original !== 'string' || original.length > C.LIMITS.text) { this.host.journal.fault('native-code-limit'); continue; }
      if (existing && existing.context === context && existing.original === original) continue;
      if (existing) { existing.child.unload(); this.codes.delete(code); }
      if (this.codes.size >= 2000) { this.host.journal.fault('native-anchor-limit'); return; }
      // Capturing a pre-existing transformed node cannot establish a before-native source witness.
      if (code.classList.contains('numerals-inline')) continue;
      const child = this.makeChild(root), entry = {code, context, original, path: context.sourcePath, child,
        captureId: this.host.ids.id({}, 'native-capture'), sectionAtCapture: context.getSectionInfo(code)};
      child.register(() => { if (this.codes.get(code) === entry) this.codes.delete(code); });
      this.codes.set(code, entry); context.addChild(child);
    }
  }
  section(code, owner) {
    const entry = this.codes.get(code);
    if (!entry || entry.path !== owner.file.path || !owner.view.containerEl.contains(code)) return;
    return {section: entry.context.getSectionInfo(code), original: entry.original, contextId: this.host.ids.id(entry.context, 'context'), captureId: entry.captureId,
      origin: 'before-native-postprocessor', sectionAtCapture: entry.sectionAtCapture};
  }
  dispose() {
    this.closed = true;
    for (const entry of [...this.codes.values()]) { try { entry.child.unload(); } catch { this.host.journal.fault('native-anchor-cleanup'); } }
    this.codes.clear();
  }
}
function ownerProof(leaf, owner, ids, leafId = ids.id(leaf, 'leaf')) {
  return {leafId, editorId: ids.id(owner.view.editor, 'editor'), fileId: ids.id(owner.file, 'file'),
    viewId: ids.id(owner.view, 'view'), documentId: ids.id(owner.view.containerEl.ownerDocument, 'document'), windowId: ids.id(owner.window, 'window')};
}
function visible(node, win) {
  if (!node.isConnected || node.ownerDocument !== win.document) return false;
  const rect = [...node.getClientRects()].find(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth);
  if (!rect) return false;
  let current = node, depth = 0;
  while (current) {
    if (++depth > 100) return false;
    const style = win.getComputedStyle(current);
    if (current.hidden || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
    current = current.parentElement;
  }
  const x = Math.max(0, Math.min(win.innerWidth - 1, rect.left + rect.width / 2)), y = Math.max(0, Math.min(win.innerHeight - 1, rect.top + rect.height / 2));
  const hit = win.document.elementFromPoint(x, y);
  return Boolean(hit && (node === hit || node.contains(hit)));
}
function nativeControlSection(code, owner, ids, buffer) {
  // Pinned Obsidian 1.13.7 implementation detail; no wrappers, registration or evaluator access.
  const renderer = owner.view.previewMode?.renderer;
  if (!renderer || typeof renderer.getSectionInfo !== 'function' || typeof renderer.lastText !== 'string' || normalize(renderer.lastText) !== normalize(buffer)) return;
  return {section: renderer.getSectionInfo(code), original: code.getAttribute('data-numerals-inline-source') ?? code.textContent,
    contextId: ids.id(renderer, 'native-renderer'), captureId: null, origin: 'pinned-native-section-getter'};
}
function readSnapshot(source, plugin, buffer, path, binding, ids) {
  if (!source) return {available: false, status: 'missing'};
  const state = source.state, snapshot = state.status === 'ready' ? state.snapshot : undefined, generation = snapshot?.generation ?? state.generation;
  const calculation = snapshot?.calculations.find(c => c.calculationId === binding.calculationId);
  const row = calculation?.rows.find(row => row.rowIndex === 0);
  return {available: true, status: state.status, sourceId: source.sourceId, indexSourceId: source.index.source.sourceId,
    indexSourceRevision: source.index.source.revision,
    indexId: ids.id(source.index, 'index'), stateId: ids.id(state, 'source-state'), snapshotId: snapshot ? ids.id(snapshot, 'snapshot') : null,
    pluginId: ids.id(plugin, 'numerals-plugin'), generation: data(generation), settings: data(source.settings),
    settingsGeneration: plugin.settingsGeneration, evaluationSettingsGeneration: plugin.evaluationSettingsGeneration,
    current: generation?.sourceId === source.sourceId && generation?.sourceText === buffer && generation?.sourcePath === path &&
      source.index.source.sourceId === source.sourceId && source.index.source.text === buffer &&
      source.index.source.revision === generation?.sourceRevision && generation?.evaluationSettingsRevision === String(plugin.evaluationSettingsGeneration),
    calculationId: calculation?.calculationId ?? null, result: row ? data(row.result) : null,
    diagnostic: calculation?.diagnostic ? data(calculation.diagnostic) : state.status === 'error' ? {message: String(state.message).slice(0, 4096)} : null};
}
/** One synchronous point read, bounded by identical current ownership/state before and after. */
function readCurrent({leaf, leafId, request, mode, guard, ids, getPlugin, anchors, versions, faults}) {
  leafId ??= ids.id(leaf, 'leaf');
  const base = {schema: 1, sampleId: request.id, caseId: request.caseId, actionId: request.actionId, leafId};
  try {
    const owner = guard(leaf), proof = ownerProof(leaf, owner, ids, leafId), view = owner.view, editor = view.editor, buffer = editor.getValue();
    const viewText = view.getViewData();
    if (buffer.length > C.LIMITS.text || buffer !== viewText) return {...base, available: false, reason: 'current-buffer-mismatch'};
    if (view.getMode() !== 'preview') return {...base, available: false, reason: 'current-reading-mode-required'};
    const plugin = getPlugin();
    if ((mode === 'numerals-disabled') !== !plugin) return {...base, available: false, reason: 'current-plugin-mode-mismatch'};
    const source = mode === 'instrumented' && typeof plugin?.getEditorSnapshot === 'function' ? plugin.getEditorSnapshot(editor) : undefined;
    const settingsGeneration = plugin?.settingsGeneration, evaluationSettingsGeneration = plugin?.evaluationSettingsGeneration;
    if (mode === 'instrumented' && !source) return {...base, available: false, reason: 'current-snapshot-missing'};
    const nodes = [...view.containerEl.querySelectorAll('.markdown-preview-view code')].filter(code => !code.closest('pre, .cm-editor, .markdown-embed, .internal-embed'));
    C.check(nodes.length <= 2000, 'native-node-limit');
    const groups = new Map(), candidates = [];
    for (const code of nodes) {
      const anchor = mode === 'instrumented' ? anchors.section(code, owner) : nativeControlSection(code, owner, ids, buffer);
      // The narrow first fixture consists only of ordinary code spans. An unaccounted
      // current code node is a coverage gap, including a cloned rendered answer.
      if (!anchor?.section) return {...base, available: false, reason: 'current-native-anchor-gap'};
      const key = JSON.stringify([anchor.contextId, anchor.section.lineStart, anchor.section.lineEnd]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({code, anchor});
    }
    for (const group of groups.values()) {
      const {anchor} = group[0];
      if (group.some(item => item.anchor.section.text !== anchor.section.text)) continue;
      const codes = group.map(item => ({elementId: ids.id(item.code, 'element'), source: item.anchor.original}));
      const binding = bindTarget(buffer, request.target, anchor.section, codes, source?.index);
      if (binding.available) {
        const item = group.find(item => ids.id(item.code, 'element') === binding.elementId);
        if (item) candidates.push({...item, binding});
      }
    }
    if (candidates.length !== 1) return {...base, available: false, reason: candidates.length ? 'current-occurrence-ambiguous' : 'current-occurrence-unavailable'};
    const {code, anchor, binding} = candidates[0];
    const values = [...code.querySelectorAll('.numerals-inline-value')], errors = [...code.querySelectorAll('.numerals-error-message, .numerals-inline-error')];
    const product = code.classList.contains('numerals-inline'), tex = code.classList.contains('numerals-inline-tex');
    const value = values.length === 1 ? values[0] : undefined, math = value ? [...value.querySelectorAll('mjx-container')] : [];
    const occurrence = {...binding, contextId: anchor.contextId, captureId: anchor.captureId, anchorOrigin: anchor.origin,
      nativeSection: {lineStart: anchor.section.lineStart, lineEnd: anchor.section.lineEnd, fullSourceSha256: C.hash(anchor.section.text)},
      connected: code.isConnected && (!product || Boolean(value?.isConnected)),
      visible: visible(code, owner.window) && (!product || Boolean(value && visible(value, owner.window))), original: anchor.original,
      renderedKind: !product ? 'raw-code' : value && !errors.length && !code.classList.contains('numerals-inline-error') ? 'numerals-inline-value' : 'inline-error',
      text: !product ? code.textContent : value?.textContent ?? code.textContent, tex,
      mathJax: {version: versions.mathJax ?? null, ready: !tex || math.length > 0 && math.every(node => node.querySelector('svg, mjx-math') && !node.querySelector('[data-mjx-error], mjx-merror')),
        publicCompletionSignal: 'not-invoked', allPendingWorkDrained: false}};
    const snapshot = mode === 'instrumented' ? readSnapshot(source, plugin, buffer, owner.file.path, binding, ids) : {available: false, reason: 'observer-absent-control'};
    guard(leaf, owner);
    const afterSource = mode === 'instrumented' ? plugin.getEditorSnapshot(editor) : undefined, after = guard(leaf, owner);
    if (JSON.stringify(ownerProof(leaf, after, ids, leafId)) !== JSON.stringify(proof) || editor.getValue() !== buffer || view.getViewData() !== buffer ||
      getPlugin() !== plugin || plugin?.settingsGeneration !== settingsGeneration || plugin?.evaluationSettingsGeneration !== evaluationSettingsGeneration ||
      (source && (afterSource?.sourceId !== source.sourceId || afterSource?.index !== source.index || afterSource?.state !== source.state ||
        afterSource?.state.snapshot !== source.state.snapshot))) return {...base, available: false, reason: 'sample-changed-during-read'};
    return {...base, available: true, owner: proof, source: {path: owner.file.path, text: buffer, viewText, sha256: C.hash(buffer)},
      mode: 'reading', snapshot, occurrence, versions: {...versions, plugin: plugin ?
        {id: plugin.manifest?.id ?? null, version: plugin.manifest?.version ?? null, minAppVersion: plugin.manifest?.minAppVersion ?? null} : null}, faults: [...faults]};
  } catch (error) {
    return {...base, available: false, reason: /^[a-z][a-z0-9-]{0,70}$/.test(error.message ?? '') ? error.message : 'current-sample-read-failed'};
  }
}
module.exports = {ReadingAnchors, ownerProof, readCurrent, visible, nativeControlSection};
