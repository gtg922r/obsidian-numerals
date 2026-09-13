import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import C from '../contracts.cjs';
import {catalog, selection, receipt, plan} from './support.mjs';
import {preflight} from '../run.mjs';

test('all 83 rows remain unexecuted; exact synthetic sources and 13 upgrade seeds', () => C.catalogCheck(catalog));
test('edited bytes cannot retain fixture hash', () => { const x = structuredClone(catalog); x.scenarios[0].notes[0].text += ' '; assert.throws(() => C.catalogCheck(x), /catalog-source/); });
test('exact successful integration push and tree match; PR/source sibling rejected', () => {
  const s = selection(); C.selectionCheck(s, receipt(s));
  for (const edit of [r => r.run.event = 'pull_request', r => r.run.run_attempt++, r => r.run.conclusion = 'failure', r => r.artifact.workflow_run.head_sha = '0'.repeat(40), r => r.commit.tree.sha = '0'.repeat(40), r => r.run.head_repository.full_name = 'fork/repo']) {
    const r = receipt(s); edit(r); assert.throws(() => C.selectionCheck(s, r), /receipt-/);
  }
});
test('selector rejects latest, BRAT and additional candidate files', () => {
  for (const edit of [s => s.artifactId = 'latest', s => s.integration = 'brat', s => s.manifest.version = '1.10.2', s => s.files['data.json'] = s.files['main.js'], s => s.integrationTree = '', s => s.planSha256 = undefined]) {
    const s = selection(); edit(s); assert.throws(() => C.selectionCheck(s), /selection-/);
  }
});
test('family plan is bounded to known cases/actions/paths', () => {
  C.planCheck(plan(), catalog);
  for (const edit of [p => p.cases.push(p.cases[0]), p => p.cases[0].path = '../../notes.md', p => p.cases[0].actions.push({op: 'eval'}), p => p.cases[0].actions.push({op: 'command', command: 'app:delete'})]) {
    const p = plan(); edit(p); assert.throws(() => C.planCheck(p, catalog), /plan-/);
  }
});
test('app environment retains HOME, excludes credentials/Node/Electron injection', () => {
  const env = C.appEnvironment({HOME: '/runner', PATH: '/bin', GH_TOKEN: 'secret', NODE_OPTIONS: '--require=bad', ELECTRON_RUN_AS_NODE: '1'}, ':91', '/tmp/x');
  assert.deepEqual(env, {HOME: '/runner', PATH: '/bin', DISPLAY: ':91', TMPDIR: '/tmp/x', XDG_RUNTIME_DIR: '/tmp/x'});
});
test('host preflight refuses desktop and even Linux CI while execution wiring is disabled', async () => {
  await assert.rejects(preflight({}, 'darwin', 'arm64'), /linux-ci-only/);
  await assert.rejects(preflight({GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'gtg922r/obsidian-numerals', GITHUB_RUN_ID: '123'}, 'linux', 'x64'), /host-execution-wiring-disabled/);
});
test('source marker and realpath must agree; symlinks/traversal are refused', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-unit-')), root = path.join(scratch, 'Numerals Acceptance NA13B'); fs.mkdirSync(root);
  const config = {root: fs.realpathSync(root), nonce: 'a'.repeat(64), catalogSha256: 'b'.repeat(64)};
  fs.writeFileSync(path.join(root, '.acceptance-marker.json'), JSON.stringify({id: C.ID, nonce: config.nonce, catalogSha256: config.catalogSha256}));
  try {
    C.guard(config.root, config); assert.throws(() => C.within(root, '../outside'), /relative-path/);
    fs.symlinkSync(scratch, path.join(root, 'alias')); assert.throws(() => C.within(root, 'alias/file'), /symlink/);
    assert.throws(() => C.guard(config.root, {...config, nonce: 'c'.repeat(64)}), /fixture-marker/);
  } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
});
test('selected official/stable/DV and dependency pins remain exact', () => {
  const inputs = JSON.parse(fs.readFileSync(new URL('../inputs.json', import.meta.url))), lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(inputs.host.app.sha256, '69253e39aa0b980e3cf96e9e8a8a4bed6b6481ef7021cd762f67872662d8d25a');
  assert.equal(inputs.stable.assets.find(a => a.name === 'main.js').sha256, '41807c9e8cf43511e2416133bd2b1fea534523ad03ff206ae7300c4f441642e4');
  assert.equal(inputs.dataview.releaseVersion, '0.5.70'); assert.equal(inputs.dataview.manifestVersion, '0.5.68');
  assert.equal(lock.packages['node_modules/obsidian-launcher'].version, '3.2.0'); assert.equal(lock.packages['node_modules/obsidian-launcher'].integrity, inputs.host.launcher.integrity);
  assert.equal(lock.packages['node_modules/esbuild'].version, '0.28.2');
});
