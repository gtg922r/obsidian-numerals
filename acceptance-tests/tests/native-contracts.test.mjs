import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import C from '../contracts.cjs';
import {preflight, dispatchSelection, main} from '../run.mjs';
import {buildControl} from '../build-observer.mjs';
import {catalog, selection} from './support.mjs';
const env = {GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'gtg922r/obsidian-numerals', GITHUB_RUN_ID: '123',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/chore/recovery-1.11',
  GITHUB_WORKFLOW_REF: 'gtg922r/obsidian-numerals/.github/workflows/installed-acceptance.yml@refs/heads/chore/recovery-1.11'};

test('nonmanual, nonrecovery, different workflow and different repository contexts cannot reach the closed gate', async () => {
  for (const patch of [{GITHUB_EVENT_NAME: 'push'}, {GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_EVENT_NAME: 'workflow_run'},
    {GITHUB_REF: 'refs/heads/master'}, {GITHUB_REPOSITORY: 'fork/obsidian-numerals'}, {GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace('installed-acceptance', 'ci')}]) {
    await assert.rejects(preflight({...env, ...patch}, 'linux', 'x64'), /linux-ci-only|manual-recovery-dispatch-only/);
  }
  await assert.rejects(preflight({...env, ACCEPTANCE_SELECTION: '{"enabled":true}', ACCEPTANCE_EXECUTION: 'true'}, 'linux', 'x64'), /host-execution-wiring-disabled/);
});
test('first admission selection is bounded, exact, single-mode and refuses any gate override or unreviewed plan', () => {
  const s = selection(); assert.deepEqual(dispatchSelection(JSON.stringify(s), 'native-ordering.plan.json'), s);
  for (const mode of ['instrumented', 'control', 'numerals-disabled']) assert.equal(dispatchSelection(JSON.stringify({...s, mode}), 'native-ordering.plan.json').mode, mode);
  for (const value of [{...s, enabled: true}, {...s, integration: 'dataview'}, {...s, controlSha256: undefined}, {...s, mode: ['control', 'instrumented']}]) {
    assert.throws(() => dispatchSelection(JSON.stringify(value), 'native-ordering.plan.json'));
  }
  for (const plan of ['ordering.plan.json', '../native-ordering.plan.json', 'unknown.plan.json']) assert.throws(() => dispatchSelection(JSON.stringify(s), plan), /dispatch-plan-allowlist/);
  assert.throws(() => dispatchSelection('x'.repeat(16385), 'native-ordering.plan.json'), /dispatch-selection-size/);
});
test('main refuses the current context or closed gate before parsing selection or invoking a network function', async () => {
  const fetchOriginal = globalThis.fetch; globalThis.fetch = () => { throw Error('network-must-not-run'); };
  try { await assert.rejects(main({selectionText: '{"enabled":true}', planName: 'native-ordering.plan.json'}), /linux-ci-only|manual-recovery-dispatch-only|host-execution-wiring-disabled/); }
  finally { globalThis.fetch = fetchOriginal; }
});
test('native plan identifies both equal expressions by exact spans and refuses wrong sample action bindings', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('../native-ordering.plan.json', import.meta.url))); C.planCheck(plan, catalog);
  for (const edit of [p => { p.cases[0].actions[3].sample.target.start++; }, p => { p.cases[0].actions[5].sample.id = 'f-before'; },
    p => { p.cases[0].assertions[0].actionId = 'action-6'; }, p => { p.cases[0].actions[3].sample.sourceSha256 = '0'.repeat(64); },
    p => { p.cases[0].actions[3].sample.selector = '.somewhere'; }]) {
    const changed = structuredClone(plan); edit(changed); assert.throws(() => C.planCheck(changed, catalog));
  }
});
test('built control installs and disposes only action handles without a retained bundle global or observer registrations', async () => {
  const built = await buildControl(), require = createRequire(import.meta.url);
  const win = {document: {}, app: {vault: {adapter: {getBasePath: () => '/fixture'}}, plugins: {getPlugin: () => null}}};
  const config = {root: '/fixture', nonce: 'n', mode: 'control', paths: [], caseIds: ['ORD-01']};
  const context = vm.createContext({window: win, performance, require: name => name === 'obsidian' ? {apiVersion: '1.13.7'} : require(name)});
  vm.runInContext(`(() => {${built.bytes.toString('utf8')}\nreturn NumeralsAcceptanceControl.install(${JSON.stringify(config)});})()`, context);
  assert.equal(Object.hasOwn(context, 'NumeralsAcceptanceControl'), false); assert.equal(win.app.workspace, undefined);
  const receipt = await win.__numeralsAcceptanceControl.call('n', {op: 'dispose'});
  assert.equal(receipt.disposed, true); assert.equal(Object.hasOwn(win, '__numeralsAcceptanceControl'), false);
});
