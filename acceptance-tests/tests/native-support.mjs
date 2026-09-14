import C from '../contracts.cjs';
export const text = '`#: $f(2)`\n\n`#: $f(2)`';
export function request() {
  return {id: 'before', actionId: 'action-3', caseId: 'ORD-01', leafId: 'leaf-a', path: 'acceptance/ordering.md', sourceSha256: C.hash(text),
    owner: {leafId: 'leaf-a', editorId: 'e', fileId: 'f', viewId: 'v', documentId: 'd', windowId: 'w'}, mode: 'reading',
    target: {kind: 'inline', start: 0, end: 10, raw: '`#: $f(2)`'}, expected: {value: 14, text: '14'}};
}
export function frame() {
  const r = request();
  return {schema: 1, available: true, sampleId: r.id, actionId: r.actionId, caseId: r.caseId, leafId: r.leafId, owner: r.owner,
    source: {path: r.path, text, viewText: text, sha256: C.hash(text)}, mode: 'reading', faults: [], versions: {host: '1.13.7'},
    snapshot: {available: true, current: true, status: 'ready', sourceId: 'source-1', indexSourceId: 'source-1', snapshotId: 'snapshot-1', indexSourceRevision: 1, indexId: 'index-1', stateId: 'state-1', pluginId: 'plugin-1',
      generation: {sourceId: 'source-1', sourcePath: r.path, sourceText: text, sourceRevision: 1, metadataRevision: '1', dependencyRevision: '1', evaluationSettingsRevision: '1', runtimeGeneration: 1},
      settingsGeneration: 1, evaluationSettingsGeneration: 1, calculationId: 'first', result: 14},
    occurrence: {available: true, sourceSpan: {start: 0, end: 10}, elementId: 'element-first', sectionId: 'section-first', connected: true, visible: true,
      calculationId: 'first', renderedKind: 'numerals-inline-value', text: '14', tex: false}};
}
