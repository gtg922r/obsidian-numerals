'use strict';
const C = require('./contracts.cjs');

// Pure source evidence checks only. This module never parses or evaluates mathematics.
const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
function lineStarts(text) {
  const starts = [0];
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '\r') { if (text[at + 1] === '\n') at++; starts.push(at + 1); }
    else if (text[at] === '\n') starts.push(at + 1);
  }
  return starts;
}
function targetCheck(target, text) {
  C.check(target && Object.keys(target).sort().join() === 'end,kind,raw,start' && target.kind === 'inline' &&
    Number.isSafeInteger(target.start) && Number.isSafeInteger(target.end) && target.start >= 0 && target.end > target.start &&
    target.end <= text.length && typeof target.raw === 'string' && text.slice(target.start, target.end) === target.raw, 'sample-target');
  // First admission supports a single-backtick, one-line synthetic code span.
  // Wider parser/mapping coverage must be added in reviewed increments.
  C.check(/^`[^`\r\n]+`$/.test(target.raw), 'sample-inline-shape');
  return target;
}
function sectionSpan(text, section) {
  if (!section || typeof section.text !== 'string' || normalize(section.text) !== normalize(text)) return;
  const starts = lineStarts(text);
  if (!Number.isSafeInteger(section.lineStart) || !Number.isSafeInteger(section.lineEnd) || section.lineStart < 0 ||
    section.lineEnd < section.lineStart || section.lineEnd >= starts.length) return;
  return {start: starts[section.lineStart], end: starts[section.lineEnd + 1] ?? text.length};
}

/** A singleton source section proves this first-admission inline occurrence.
 * Equal expressions elsewhere in the note never enter this match. */
function bindTarget(text, target, section, codes, index) {
  targetCheck(target, text);
  const span = sectionSpan(text, section);
  if (!span || span.start > target.start || span.end < target.end) return {available: false, reason: 'native-section-source-mismatch'};
  // Require the complete physical section to contain this exact inline source only.
  // No raw HTML, second code span, containers, embeds or ordinal guesses.
  if (text.slice(span.start, span.end).trim() !== target.raw || codes.length !== 1 || codes[0].source !== target.raw.slice(1, -1)) {
    return {available: false, reason: 'native-occurrence-ambiguous'};
  }
  let calculationId = null;
  if (index) {
    if (index.evaluationBlocked || index.source.text !== text) return {available: false, reason: 'index-source-mismatch'};
    const calculations = index.calculations.filter(c => c.kind === 'inline' && c.span.start === target.start && c.span.end === target.end);
    if (calculations.length !== 1 || calculations[0].projection.text !== codes[0].source) return {available: false, reason: 'index-occurrence-mismatch'};
    calculationId = calculations[0].id;
  }
  return {available: true, sectionSpan: span, sourceSpan: {start: target.start, end: target.end}, elementId: codes[0].elementId, calculationId};
}

function sampleAssessment(sample, request, mode) {
  const unavailable = reason => ({status: 'UNAVAILABLE', reason});
  if (!['instrumented', 'control', 'numerals-disabled'].includes(mode) || !request?.expected) return unavailable('sample-mode');
  if (!sample || sample.schema !== 1 || sample.sampleId !== request.id || sample.actionId !== request.actionId ||
    sample.caseId !== request.caseId || sample.leafId !== request.leafId) return unavailable('sample-request-identity');
  if (!sample.available) return unavailable(sample.reason ?? 'current-sample-unavailable');
  const owner = sample.owner;
  const identityKeys = ['editorId', 'fileId', 'viewId', 'documentId', 'windowId'];
  if (!request.owner || !owner || owner.leafId !== request.leafId || request.owner.leafId !== request.leafId ||
    !identityKeys.every(key => typeof request.owner[key] === 'string' && owner[key] === request.owner[key])) return unavailable('sample-request-owner');
  if (typeof sample.source?.text !== 'string') return unavailable('sample-current-source');
  try { targetCheck(request.target, sample.source.text); } catch { return unavailable('sample-target-source'); }
  if (!owner || !['editorId', 'fileId', 'viewId', 'documentId', 'windowId'].every(key => typeof owner[key] === 'string') ||
    sample.source.path !== request.path || sample.source.sha256 !== request.sourceSha256 || C.hash(sample.source.text) !== sample.source.sha256 ||
    sample.source.text !== sample.source.viewText || sample.mode !== request.mode) return unavailable('sample-current-source');
  if (!sample.occurrence?.available || sample.occurrence.sourceSpan?.start !== request.target.start ||
    sample.occurrence.sourceSpan.end !== request.target.end || !sample.occurrence.visible || !sample.occurrence.connected) return unavailable('sample-current-occurrence');
  if (!Array.isArray(sample.faults)) return unavailable('sample-fault-evidence');
  if (sample.faults.length) return {status: 'PARTIAL', reason: 'sample-coverage-fault', faults: sample.faults};
  if (mode === 'instrumented') {
    const snapshot = sample.snapshot;
    if (!snapshot?.available || snapshot.status !== 'ready' || !snapshot.current || snapshot.generation?.sourceText !== sample.source.text ||
      snapshot.generation.sourcePath !== request.path || snapshot.generation.sourceId !== snapshot.sourceId ||
      snapshot.indexSourceId !== snapshot.sourceId || snapshot.indexSourceRevision !== snapshot.generation.sourceRevision ||
      snapshot.generation.evaluationSettingsRevision !== String(snapshot.evaluationSettingsGeneration) ||
      !['sourceId', 'indexId', 'stateId', 'snapshotId', 'pluginId'].every(key => typeof snapshot[key] === 'string') ||
      !snapshot.calculationId || snapshot.calculationId !== sample.occurrence.calculationId) return unavailable('sample-current-snapshot');
    if (snapshot.diagnostic) return {status: 'FAIL', reason: 'calculation-diagnostic'};
    if (snapshot.result !== request.expected.value) return {status: 'FAIL', reason: 'current-value-mismatch'};
  }
  if (mode === 'numerals-disabled') {
    return sample.occurrence.renderedKind === 'raw-code' && sample.occurrence.text === request.target.raw.slice(1, -1) ?
      {status: 'PASS', scope: 'current-disabled-source-control'} : {status: 'FAIL', reason: 'disabled-source-control-mismatch'};
  }
  if (sample.occurrence.renderedKind !== 'numerals-inline-value' || sample.occurrence.text !== request.expected.text) return {status: 'FAIL', reason: 'current-rendered-value-mismatch'};
  if (sample.occurrence.tex && !sample.occurrence.mathJax?.ready) return unavailable('intended-mathjax-output-unavailable');
  return {status: 'PASS', scope: mode === 'instrumented' ? 'current-snapshot-and-rendered-occurrence' : 'current-rendered-occurrence-control'};
}

function stabilityKey(sample) {
  // Retain source/session/settings/snapshot/element identities, never only equal values.
  return C.hash(JSON.stringify({owner: sample.owner, source: sample.source, mode: sample.mode, snapshot: sample.snapshot,
    occurrence: sample.occurrence, versions: sample.versions}));
}
module.exports = {normalize, lineStarts, targetCheck, sectionSpan, bindTarget, sampleAssessment, stabilityKey};
