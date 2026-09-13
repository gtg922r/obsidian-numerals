const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const IDENTITY = 'numerals-recovery-fixture-NQ13A';
const VAULT_NAME = 'Numerals CI Fixture NQ13A';
const CASES_HASH = 'fbb224c760608883a222b02ef6e414b9d38221f042b3b7f7dc6dce9ae1c55a69';
const OUTPUTS = ['capture.json', 'sources.json', 'provenance.json', 'diagnostics.json', 'sha256.json'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function check(value, message) { if (!value) throw Error(message); }
function catalogCheck(catalog) {
  check(catalog.identity === IDENTITY && catalog.cases.length === 95, 'fixture identity/count');
  check(hash(JSON.stringify(catalog.cases)) === CASES_HASH && catalog.casesSha256 === CASES_HASH, 'fixture catalog hash');
  check(new Set(catalog.cases.map(c => c.id)).size === 95, 'duplicate fixture');
  for (const c of catalog.cases) {
    check(/^cases\/\d{3}-[a-z0-9-]+\.md$/.test(c.path), 'fixture path');
    check(hash(c.text) === c.sha256, 'fixture byte mismatch');
  }
}
function guard(root, config) {
  check(path.basename(root) === VAULT_NAME && root === config.expectedRoot, 'fixture vault path/name');
  check(fs.realpathSync(root) === config.expectedRoot, 'fixture realpath');
  const marker = JSON.parse(fs.readFileSync(path.join(root, '.fixture-marker.json'), 'utf8'));
  check(marker.identity === IDENTITY && marker.nonce === config.nonce && /^[a-f0-9]{64}$/.test(config.nonce), 'generated fixture marker');
  check(hash(fs.readFileSync(path.join(root, '.fixture-sources.json'))) === config.catalogHash, 'fixture source marker');
}
function sourceCheck(root, fixture) {
  const file = path.join(root, fixture.path);
  check(fs.realpathSync(file) === file, 'fixture source symlink');
  check(hash(fs.readFileSync(file)) === fixture.sha256, 'fixture byte mismatch');
}
// These are declarations of possible empty native extraction, not parser oracles.
// Positive controls and full view/source checks are still mandatory.
const MAY_BE_EMPTY = ['010','011','012','031','032','042','047','056','057','074','075','076'];
function captureCheck(capture, catalog, ids) {
  catalogCheck(catalog);
  check(capture.status === 'complete' && capture.fixtureIdentity === IDENTITY, 'incomplete capture');
  check(capture.host.apiVersion === '1.13.7' && capture.host.platform === 'linux' && capture.host.electron && capture.host.chromium, 'host provenance');
  const expected = ids.flatMap(id => ['reading', 'live-preview'].map(mode => `${id}:${mode}`));
  check(capture.results.length === expected.length && new Set(capture.results.map(r => `${r.id}:${r.mode}`)).size === expected.length, 'incomplete/duplicate coverage');
  check(capture.controls.length === 4 && new Set(capture.controls.map(c => `${c.mode}:${c.position}`)).size === 4, 'silent recorder/control failure');
  for (const control of capture.controls) {
    check(['reading','live-preview'].includes(control.mode) && ['before','after'].includes(control.position) && control.ok && control.events?.length, 'silent recorder/control failure');
    check(control.mode === 'reading'
      ? control.events.some(e => e.kind === 'block-handler' && e.sourcePath === 'control.md' && e.source.trim() === '314159') && control.events.some(e => e.kind === 'inline-code' && e.sourcePath === 'control.md' && e.text === '#:271828')
      : control.events.some(e => e.kind === 'editor-tree' && e.treeComplete && e.livePreview === true && e.sourcePath === 'control.md' && e.document === '```math\n314159\n```\n\n`#:271828`'), 'silent recorder/control failure');
  }
  for (const r of capture.results) {
    const fixture = catalog.cases.find(c => c.id === r.id);
    check(expected.includes(`${r.id}:${r.mode}`) && fixture && fixture.path === r.path && fixture.sha256 === r.sourceSha256, 'result source identity');
    check(r.opened && r.settled && r.events.length > 0, 'missing view/callback completion');
    if (r.mode === 'reading') {
      check(r.actualMode === 'preview', 'wrong Reading mode');
      const extractions = r.events.filter(e => e.kind === 'block-handler' || e.kind === 'inline-code');
      check(extractions.length > 0 || MAY_BE_EMPTY.includes(r.id), 'undeclared empty extraction');
      if (!extractions.length) check(r.emptyWitness?.completed && r.emptyWitness.sourceSha256 === fixture.sha256 && r.emptyWitness.events.every(e => !['block-handler','inline-code'].includes(e.kind)), 'missing native empty-render witness');
    } else {
      check(r.actualMode === 'source', 'wrong Live Preview mode');
      check(r.events.some(e => e.kind === 'editor-tree' && e.livePreview === true && e.treeComplete && e.sourcePath === fixture.path && e.document === fixture.text.replace(/\r\n?/g, '\n')), 'incomplete CodeMirror source/tree');
    }
    for (const e of r.events) check([fixture.path, 'Other.md'].includes(e.sourcePath), 'unexpected callback source');
  }
}
function outputCheck(names) {
  check(names.length === OUTPUTS.length && names.every(n => OUTPUTS.includes(n)), 'artifact allowlist');
}
function appEnvironment(env, display, scratch) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ']) if (env[key]) result[key] = env[key];
  return {...result, DISPLAY: display, TMPDIR: scratch, XDG_RUNTIME_DIR: scratch};
}
function failure(error, stage, current) {
  const known = ['fixture settling deadline','fixture view identity','fixture view changed','Live Preview not ready','positive control failed','fixture byte mismatch','fixture source symlink','recorder unavailable','recorder unloaded','callback limit','fixture vault path/name','fixture realpath','generated fixture marker','fixture source marker','owned child stopped','bounded wait expired','official input download failed','oversized official input','official input hash/size mismatch','expanded app hash','verified installer extraction failed','CDP deadline','recorder evaluation failed','recorder did not complete','undeclared empty extraction','incomplete CodeMirror source/tree','unexpected callback source'];
  return {stage,reason:known.includes(error?.message) ? error.message : 'unexpected harness/host error',caseId:current?.id ?? null,mode:current?.mode ?? null};
}
module.exports = {IDENTITY, VAULT_NAME, CASES_HASH, OUTPUTS, MAY_BE_EMPTY, hash, check, catalogCheck, guard, sourceCheck, captureCheck, outputCheck, appEnvironment, failure};
