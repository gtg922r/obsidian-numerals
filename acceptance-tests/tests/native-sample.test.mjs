import test from 'node:test';
import assert from 'node:assert/strict';
import N from '../native-sample.cjs';
import {settleCurrent} from '../native-settle.mjs';

import {text, request, frame} from './native-support.mjs';

test('equal f expressions are bound by complete native source section and exact physical spans', () => {
  const first = request().target, second = {...first, start: 12, end: 22};
  const section = {text, lineStart: 0, lineEnd: 0}, codes = [{source: '#: $f(2)', elementId: 'first'}];
  const bound = N.bindTarget(text, first, section, codes); assert.equal(bound.available, true); assert.equal(bound.elementId, 'first');
  assert.equal(N.bindTarget(text, second, section, codes).available, false);
  assert.equal(N.bindTarget(text, second, {...section, lineStart: 2, lineEnd: 2}, [{...codes[0], elementId: 'second'}]).elementId, 'second');
});
test('ambiguous code, stale full source, forged section range and index mismatch are unavailable', () => {
  const target = request().target, section = {text, lineStart: 0, lineEnd: 0}, code = {source: '#: $f(2)', elementId: 'first'};
  assert.equal(N.bindTarget(text, target, section, [code, code]).available, false);
  assert.equal(N.bindTarget(text, target, {...section, text: text + 'x'}, [code]).available, false);
  assert.equal(N.bindTarget(text, target, {...section, lineStart: 1, lineEnd: 1}, [code]).available, false);
  assert.equal(N.bindTarget(text, target, section, [code], {source: {text}, calculations: []}).available, false);
});
test('CRLF and emoji retain physical UTF16 spans while native section text can normalize newlines', () => {
  const source = '😀\r\n`#: 2`\r\n', target = {kind: 'inline', start: 4, end: 11, raw: '`#: 2`'};
  target.end = target.start + target.raw.length;
  const result = N.bindTarget(source, target, {text: source.replace(/\r\n/g, '\n'), lineStart: 1, lineEnd: 1}, [{source: '#: 2', elementId: 'x'}]);
  assert.equal(result.available, true); assert.deepEqual(result.sourceSpan, {start: target.start, end: target.end});
});
test('current sample rejects changed/deleted/pending/session/settings-target and same-path sibling substitutions', () => {
  assert.equal(N.sampleAssessment(frame(), request(), 'instrumented').status, 'PASS');
  const mutations = [s => { s.leafId = 'sibling'; }, s => { s.owner.editorId = 'sibling'; }, s => { s.owner.fileId = 'replacement'; },
    s => { s.snapshot.status = 'pending'; }, s => { s.snapshot.status = 'error'; }, s => { s.snapshot.result = 16; },
    s => { s.snapshot.calculationId = 'deleted'; }, s => { s.snapshot.generation.sourceId = 'retired'; },
    s => { s.source.viewText += 'changed'; }, s => { s.occurrence.sourceSpan = {start: 12, end: 22}; }, s => { s.occurrence.text = '16'; }];
  for (const mutate of mutations) { const sample = frame(); mutate(sample); assert.notEqual(N.sampleAssessment(sample, request(), 'instrumented').status, 'PASS'); }
});
test('pending or changed settings/generation resets the interval; a changed final seal cannot reuse a prior ready frame', async () => {
  let time = 0, reads = 0;
  const result = await settleCurrent({request: request(), mode: 'instrumented', signal: new AbortController().signal, now: () => time, pause: async ms => { time += ms; }, timeoutMs: 1000,
    capture: async () => { const s = frame(); if (++reads >= 5) s.snapshot.status = 'pending'; return s; }});
  assert.notEqual(result.status, 'PASS'); assert.ok(result.frames.length >= 4); assert.equal(result.lastAssessment.reason, 'sample-current-snapshot');
  time = 0; reads = 0;
  const stable = await settleCurrent({request: request(), mode: 'instrumented', signal: new AbortController().signal, now: () => time, pause: async ms => { time += ms; }, timeoutMs: 1000,
    capture: async () => { const s = frame(); if (++reads >= 3) s.snapshot.settingsGeneration = 2; return s; }});
  assert.equal(stable.status, 'PASS'); assert.ok(stable.settling.elapsedMs >= 500); assert.equal(stable.sample.snapshot.settingsGeneration, 2); assert.equal(stable.settling.allPendingWorkDrained, false);
});
test('cancellation retains failed current-sample evidence instead of dropping previous frames', async () => {
  let time = 0, reads = 0; const abort = new AbortController();
  await assert.rejects(settleCurrent({request: request(), mode: 'instrumented', signal: abort.signal, now: () => time, pause: async ms => { time += ms; },
    capture: async () => { if (++reads === 2) abort.abort(); return frame(); }}), error => error.sampleEvidence.frames.length === 1);
});

test('a structurally ready stable wrong value fails promptly instead of polling for the expected answer', async () => {
  let time = 0;
  const result = await settleCurrent({request: request(), mode: 'instrumented', signal: new AbortController().signal, now: () => time, pause: async ms => { time += ms; }, timeoutMs: 1000,
    capture: async () => { const sample = frame(); sample.snapshot.result = 16; sample.occurrence.text = '16'; return sample; }});
  assert.equal(result.status, 'FAIL'); assert.equal(result.reason, 'current-value-mismatch'); assert.ok(result.settling.elapsedMs < 1000);
});
