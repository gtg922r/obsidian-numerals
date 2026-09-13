'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMITS = Object.freeze({cases: 8, windows: 2, editors: 6, events: 20000, bytes: 32 * 1024 * 1024, text: 262144, deadlineMs: 480000});
const ID = 'numerals-installed-acceptance-NA13B';
const PLUGIN = 'numerals-recovery-acceptance-observer';
const FILES = Object.freeze(['main.js', 'manifest.json', 'styles.css']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(value, code) { if (!value) throw new Error(code); }
function integer(value) { return Number.isSafeInteger(value) && value > 0; }
function sha(value, length = 64) { return typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value); }
function notePath(value) { return typeof value === 'string' && /^acceptance\/[a-z0-9-]+\.md$/.test(value); }
function catalogCheck(catalog) {
  check(catalog.schema === 1 && catalog.status === 'NOT_RUN' && catalog.cases.length === 83, 'catalog-status');
  check(new Set(catalog.cases.map(c => c.id)).size === 83, 'catalog-ids');
  for (const c of catalog.cases) check(c.status === 'NOT_RUN' && c.observed === null && Array.isArray(c.evidence) && c.evidence.length === 0, 'catalog-observations');
  const paths = new Set();
  for (const s of catalog.scenarios) for (const n of s.notes) {
    check(notePath(n.path) && !paths.has(n.path) && typeof n.text === 'string' && n.text.length <= LIMITS.text && hash(n.text) === n.sha256, 'catalog-source');
    paths.add(n.path);
  }
  check(catalog.upgrades.length === 13, 'catalog-upgrades');
}
function selectionCheck(s, receipt) {
  check(s?.schema === 1 && s.repository === 'gtg922r/obsidian-numerals', 'selection-repository');
  const fields = ['schema', 'repository', 'integrationCommit', 'integrationTree', 'harnessCommit', 'runId', 'runAttempt', 'artifactId', 'artifactZipSha256', 'catalogSha256', 'inputsSha256', 'helperSha256', 'planSha256', 'branch', 'event', 'workflowPath', 'mode', 'integration', 'files', 'manifest'];
  check(Object.keys(s).sort().join() === fields.sort().join(), 'selection-fields');
  for (const key of ['integrationCommit', 'integrationTree', 'harnessCommit']) check(sha(s[key], 40), 'selection-commit');
  for (const key of ['runId', 'runAttempt', 'artifactId']) check(integer(s[key]), 'selection-id');
  for (const key of ['artifactZipSha256', 'catalogSha256', 'inputsSha256', 'helperSha256', 'planSha256']) check(sha(s[key]), 'selection-hash');
  check(s.branch === 'chore/recovery-1.11' && s.event === 'push' && s.workflowPath === '.github/workflows/ci.yml', 'selection-build');
  check(s.mode === 'instrumented' || s.mode === 'control' || s.mode === 'numerals-disabled', 'selection-mode');
  check(s.integration === 'none' || s.integration === 'dataview', 'selection-integration');
  check(s.files && Object.keys(s.files).sort().join() === [...FILES].sort().join(), 'selection-files');
  for (const f of FILES) check(integer(s.files[f].size) && s.files[f].size <= LIMITS.bytes && sha(s.files[f].sha256), 'selection-file-identity');
  check(s.manifest?.id === 'numerals' && /^\d+\.\d+\.\d+$/.test(s.manifest.version) && s.manifest.version !== '1.10.2' && s.manifest.minAppVersion === '1.13.0', 'selection-manifest');
  if (receipt) {
    const {run, artifact, commit} = receipt;
    check(run?.id === s.runId && run.run_attempt === s.runAttempt && run.event === 'push' && run.head_sha === s.integrationCommit &&
      run.head_branch === s.branch && run.status === 'completed' && run.conclusion === 'success' && run.path === s.workflowPath &&
      run.repository?.full_name === s.repository && run.head_repository?.full_name === s.repository, 'receipt-run');
    check(artifact?.id === s.artifactId && artifact.name === `numerals-acceptance-${s.integrationCommit}` && artifact.expired === false &&
      artifact.workflow_run?.id === s.runId && artifact.workflow_run?.head_sha === s.integrationCommit && artifact.workflow_run?.head_branch === s.branch, 'receipt-artifact');
    check(commit?.sha === s.integrationCommit && commit.tree?.sha === s.integrationTree, 'receipt-tree');
  }
  return s;
}
function environmentCheck(env, platform, arch) {
  check(platform === 'linux' && arch === 'x64' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.GITHUB_REPOSITORY === 'gtg922r/obsidian-numerals' && /^\d+$/.test(env.GITHUB_RUN_ID || ''), 'linux-ci-only');
}
function appEnvironment(env, display, scratch) {
  const result = {}; for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ']) if (env[key]) result[key] = env[key];
  return {...result, DISPLAY: display, TMPDIR: scratch, XDG_RUNTIME_DIR: scratch};
}
function guard(root, config) {
  check(config && sha(config.nonce) && path.basename(root) === 'Numerals Acceptance NA13B' && root === config.root && fs.realpathSync(root) === root, 'fixture-root');
  const markerPath = path.join(root, '.acceptance-marker.json');
  check(fs.lstatSync(markerPath).isFile() && !fs.lstatSync(markerPath).isSymbolicLink(), 'fixture-marker');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  check(marker.id === ID && marker.nonce === config.nonce && marker.catalogSha256 === config.catalogSha256, 'fixture-marker');
}
function within(root, relative) {
  check(typeof relative === 'string' && relative.length > 0 && !relative.includes('\\') && !relative.includes('\0') &&
    !relative.startsWith('/') && relative.split('/').every(p => p !== '' && p !== '.' && p !== '..'), 'relative-path');
  const target = path.join(root, relative);
  let current = root;
  for (const p of relative.split('/')) { current = path.join(current, p); if (fs.existsSync(current)) check(!fs.lstatSync(current).isSymbolicLink(), 'symlink-path'); }
  return target;
}
function installedCheck(root, selection) {
  for (const name of FILES) {
    const bytes = fs.readFileSync(within(root, name));
    check(bytes.length === selection.files[name].size && hash(bytes) === selection.files[name].sha256, 'installed-identity');
  }
  const m = JSON.parse(fs.readFileSync(within(root, 'manifest.json'), 'utf8'));
  check(m.id === selection.manifest.id && m.version === selection.manifest.version && m.minAppVersion === selection.manifest.minAppVersion, 'installed-manifest');
}
function planCheck(plan, catalog) {
  check(plan?.schema === 1 && Array.isArray(plan.cases) && plan.cases.length > 0 && plan.cases.length <= LIMITS.cases, 'plan-count');
  check(new Set(plan.cases.map(c => c.id)).size === plan.cases.length, 'plan-duplicate');
  const paths = new Set(catalog.scenarios.flatMap(s => s.notes.map(n => n.path)));
  for (const c of plan.cases) {
    check(catalog.cases.some(x => x.id === c.id) && paths.has(c.path) && Array.isArray(c.actions) && c.actions.length <= 40, 'plan-case');
    check(Array.isArray(c.assertions) && c.assertions.length <= 30, 'plan-assertions');
    const aliases = new Set();
    for (const a of c.actions) {
      check(Object.keys(a).every(k => ['op', 'path', 'mode', 'text', 'key', 'from', 'to', 'offset', 'command', 'bind', 'target', 'expectedText'].includes(k)), 'plan-action-fields');
      if (a.expectedText !== undefined) check(a.op === 'sample' && typeof a.expectedText === 'string' && a.expectedText.length <= 1024, 'plan-expected-text');
      if (a.target !== undefined) check(aliases.has(a.target), 'plan-target');
      if (a.bind !== undefined) { check(['open', 'split', 'popout'].includes(a.op) && /^[a-z][a-z0-9-]{0,30}$/.test(a.bind) && !aliases.has(a.bind), 'plan-alias'); aliases.add(a.bind); }
      check(['open', 'mode', 'sample', 'split', 'popout', 'close', 'type', 'key', 'select', 'scroll', 'command', 'dataview'].includes(a.op), 'plan-operation');
      if (a.path !== undefined) check(paths.has(a.path), 'plan-path');
      if (a.op === 'type') check(typeof a.text === 'string' && a.text.length <= 1024, 'plan-text');
      if (a.op === 'mode') check(['reading', 'source', 'live-preview'].includes(a.mode), 'plan-mode');
      if (a.op === 'command') check(a.command === 'numerals:update-stored-results', 'plan-command');
    }
  }
}
module.exports = {LIMITS, ID, PLUGIN, FILES, hash, check, sha, notePath, catalogCheck, selectionCheck, environmentCheck, appEnvironment, guard, within, installedCheck, planCheck};
