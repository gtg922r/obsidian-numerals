import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import C from '../contracts.cjs';
import {catalog, plan} from './support.mjs';
import {validateFamily} from '../validate.mjs';

test('PR workflow executes only pure checks and the execution gate remains closed', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/acceptance-observer-checks.yml', import.meta.url), 'utf8');
  const runs = [...workflow.matchAll(/- run: (.+)/g)].map(match => match[1]);
  assert.deepEqual(runs, ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run check']);
  assert.match(workflow, /pull_request:/); assert.doesNotMatch(workflow, /workflow_dispatch|workflow_run|host-tests\//);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../execution.json', import.meta.url))).enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).scripts.check, 'npm test && npm run build');
});
test('example plan uses fixed source and runtime leaf aliases instead of guessed host IDs', () => {
  const example = JSON.parse(fs.readFileSync(new URL('../ordering.plan.json', import.meta.url))); C.planCheck(example, catalog);
  const invalid = structuredClone(example); invalid.cases[0].actions[1].target = 'uncreated'; assert.throws(() => C.planCheck(invalid, catalog), /plan-target/);
});
test('an old pane with the same expected result cannot pass the current source assertion', () => {
  const p = plan(), result = validateFamily(p, {records: [{sequence: 1, caseId: p.cases[0].id, sourcePath: 'acceptance/other.md', kind: 'surface', occurrences: [{connected: true, text: '14'}]}], faults: []});
  assert.equal(result[0].status, 'NOT_RUN'); assert.equal(result[0].assertions[0].status, 'UNAVAILABLE');
});
