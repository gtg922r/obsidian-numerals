import test from 'node:test';
import assert from 'node:assert/strict';
import N from '../native-sample.cjs';

import {fixture, render} from './native-dom-support.mjs';

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
