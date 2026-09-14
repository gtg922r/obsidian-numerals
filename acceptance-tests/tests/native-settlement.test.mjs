import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {settleCurrent, verifySettlement} from '../native-settle.mjs';
import {runFamily} from '../controller.mjs';
import {validateFamily} from '../validate.mjs';
import {catalog} from './support.mjs';
import {request, frame} from './native-support.mjs';

async function settled() {
  let time = 0, sequence = 0;
  return settleCurrent({request: request(), mode: 'instrumented', now: () => time, pause: async ms => { time += ms; }, timeoutMs: 1000,
    capture: async () => ({...frame(), recordSequence: ++sequence})});
}
test('offline replay requires a real bounded stable interval followed by a fresh matching seal', async () => {
  const result = await settled(); assert.equal(verifySettlement(result, request(), 'instrumented').status, 'PASS');
  for (const key of ['requiredStableMs', 'timeoutMs', 'pollMs', 'elapsedMs', 'stableMs']) {
    for (const value of [undefined, NaN, Infinity, '250', -1]) {
      const changed = structuredClone(result); changed.settling[key] = value;
      assert.notEqual(verifySettlement(changed, request(), 'instrumented').status, 'PASS', key + ':' + value);
    }
  }
  const noInterval = {frames: [1, 2].map(recordSequence => ({...frame(), recordSequence, controllerElapsedMs: 0})),
    settling: {method: 'current-identity-and-dom-interval-with-seal', allPendingWorkDrained: false, evaluationCount: null}};
  noInterval.sample = noInterval.frames.at(-1);
  assert.notEqual(verifySettlement(noInterval, request(), 'instrumented').status, 'PASS');
  const pendingSeal = structuredClone(result); pendingSeal.frames.at(-1).snapshot.status = 'pending'; pendingSeal.sample = pendingSeal.frames.at(-1);
  assert.notEqual(verifySettlement(pendingSeal, request(), 'instrumented').status, 'PASS');
});
test('offline replay refuses repeated/out-of-order sequence, wrong owner, replaced settings and a substituted earlier ready frame', async () => {
  for (const edit of [r => { r.frames.at(-1).recordSequence = 1; }, r => { r.frames.at(-1).controllerElapsedMs = 0; },
    r => { r.frames.at(-1).owner.editorId = 'sibling'; }, r => { r.frames.at(-1).snapshot.settingsGeneration++; },
    r => { r.sample = r.frames[0]; }]) {
    const result = await settled(); edit(result); assert.notEqual(verifySettlement(result, request(), 'instrumented').status, 'PASS');
  }
});

function smallPlan() {
  const plan = JSON.parse(fs.readFileSync(new URL('../native-ordering.plan.json', import.meta.url)));
  plan.cases[0].actions = plan.cases[0].actions.slice(0, 4); plan.cases[0].assertions = plan.cases[0].assertions.slice(0, 1); return plan;
}
async function capturedFamily({wrong = false, interrupt = false} = {}) {
  const plan = smallPlan(), abort = new AbortController(), records = [];
  let sequence = 0, reads = 0;
  const backend = {mode: 'instrumented', assertOwned() {}, begin() {}, end() {},
    async action(action) {
      if (action.op === 'open') return {leafId: 'leaf-a'};
      if (action.op === 'current-owner') return {owner: request().owner};
      if (action.op !== 'current-read') return {};
      if (interrupt && ++reads === 2) throw Error('lost-owner');
      const r = action.request, s = frame(), source = catalog.scenarios.flatMap(s => s.notes).find(n => n.path === r.path).text;
      Object.assign(s, {sampleId: r.id, actionId: r.actionId, caseId: r.caseId, owner: r.owner, leafId: r.leafId, recordSequence: ++sequence});
      s.source = {path: r.path, text: source, viewText: source, sha256: r.sourceSha256};
      Object.assign(s.snapshot.generation, {sourcePath: r.path, sourceText: source});
      s.occurrence.sourceSpan = {start: r.target.start, end: r.target.end};
      if (wrong) { s.snapshot.result = 16; s.occurrence.text = '16'; }
      records.push({kind: 'current-sample', sequence, ...structuredClone(s)}); return s;
    },
    drain() { return {records: records.splice(0), faults: []}; },
    dispose() { return {disposed: true, mode: 'instrumented', cleanup: {records: records.splice(0), faults: []}}; },
  };
  const family = await runFamily(backend, plan, catalog, abort.signal); return {plan, family};
}
test('controller and offline validation bind the exact current action/sample and keep the wider acceptance row partial', async () => {
  const {plan, family} = await capturedFamily();
  const validate = () => validateFamily(plan, family.observations, family.actions, family.mode)[0];
  assert.equal(validate().assertions[0].status, 'PASS'); assert.equal(validate().status, 'PARTIAL');
  const original = structuredClone(family.actions[3].result);
  family.actions[3].result.request.target.start++; assert.notEqual(validate().assertions[0].status, 'PASS');
  family.actions[3].result = original;
  family.observations.records.at(-1).snapshot.status = 'pending'; assert.notEqual(validate().assertions[0].status, 'PASS');
});
test('a later pending snapshot or settings event in the exact action invalidates its seal', async () => {
  for (const kind of ['snapshot', 'settings']) {
    const {plan, family} = await capturedFamily();
    family.observations.records.push({kind, sequence: 100, caseId: 'ORD-01', actionId: 'action-4', editorId: 'e', status: 'pending', settingsGeneration: 2});
    const assertion = validateFamily(plan, family.observations, family.actions, family.mode)[0].assertions[0];
    assert.equal(assertion.status, 'UNAVAILABLE'); assert.equal(assertion.reason, 'current-seal-invalidated');
  }
});
test('stable wrong output fails offline and interrupted current actions retain point-read evidence for review', async () => {
  const {plan, family} = await capturedFamily({wrong: true});
  assert.equal(validateFamily(plan, family.observations, family.actions, family.mode)[0].assertions[0].status, 'FAIL');
  await assert.rejects(capturedFamily({interrupt: true}), error => {
    assert.equal(error.familyEvidence.actions[3].status, 'started');
    assert.equal(error.familyEvidence.actions[3].result.currentSample.frames.length, 1);
    assert.equal(error.familyEvidence.observations.records.length, 1); return true;
  });
});
