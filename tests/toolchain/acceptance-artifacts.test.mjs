import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ci = load(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
const steps = ci.jobs.checks.steps;
const packaging = steps.find(step => step.id === 'acceptance');
const upload = steps.find(step => step.name === 'Upload checked acceptance assets');
const files = ['main.js', 'manifest.json', 'styles.css'];
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

test('acceptance upload follows successful checks and keeps a separate exact-file artifact', () => {
    const condition = "inputs.release_tag == '' && (github.event_name == 'push' || github.event_name == 'pull_request')";
    assert.equal(packaging.if, condition); // The implicit success() gate must remain in force.
    assert.equal(upload.if, condition);
    const required = ['npm ci', 'npm run lint', 'npm run typecheck', 'npm run typecheck:tests', 'npm run typecheck:scripts', 'npm test -- --runInBand', 'npm run test:toolchain', 'npm run build', 'npm run symbols:check', 'npm run build:reproducible', 'npm run release:check'];
    let previous = -1;
    for (const command of required) {
        const index = steps.findIndex(step => step.run === command);
        assert.ok(index > previous && index < steps.indexOf(packaging), command);
        assert.equal(steps[index].if, undefined, command);
        assert.equal(steps[index]['continue-on-error'], undefined, command);
        previous = index;
    }
    assert.equal(ci.jobs.checks['continue-on-error'], undefined);
    assert.equal(packaging['continue-on-error'], undefined);
    assert.ok(steps.indexOf(upload) > steps.indexOf(packaging));
    assert.equal(upload.uses, 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    assert.deepEqual(upload.with, {
        name: 'numerals-acceptance-${{ steps.acceptance.outputs.sha }}',
        path: files.map(file => 'release/numerals/' + file).join('\n') + '\n',
        'if-no-files-found': 'error',
        'retention-days': 14,
    });
    assert.deepEqual(ci.permissions, { contents: 'read' });
    assert.equal(ci.jobs.checks.permissions, undefined);
    assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
});

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-acceptance-artifact-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, 'scripts'));
    for (const script of ['prepare-release-artifacts.mjs', 'release-policy.mjs']) cpSync(path.join(root, 'scripts', script), path.join(dir, 'scripts', script));
    for (const file of ['package.json', 'package-lock.json', 'manifest.json', 'versions.json']) cpSync(path.join(root, file), path.join(dir, file));
    // A later synchronized version proves the workflow derives it from policy.
    for (const file of ['package.json', 'package-lock.json', 'manifest.json']) {
        const value = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
        value.version = '1.12.3';
        if (value.packages) value.packages[''].version = value.version;
        writeFileSync(path.join(dir, file), JSON.stringify(value, null, '\t') + '\n');
    }
    writeFileSync(path.join(dir, 'main.js'), 'module.exports = 42;\n');
    writeFileSync(path.join(dir, 'styles.css'), '.numerals {}\n');
    git(dir, 'init', '-q', '-b', 'codex/acceptance-fixture');
    git(dir, 'config', 'user.name', 'Acceptance Fixture');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'test: checked candidate fixture');
    return dir;
}

function run(dir) {
    return spawnSync('bash', ['-e', '-c', packaging.run], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: path.join(dir, 'output'), GITHUB_SHA: 'untrusted-context-value', PLUGIN_NAME: 'numerals', INCLUDE_RELEASE_ZIP: 'false' },
    });
}

test('actual acceptance shell copies exactly three canonical files and reports the checked-out commit', t => {
    const dir = fixture(t);
    const before = files.map(file => readFileSync(path.join(dir, file)));
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(path.join(dir, 'release/numerals')).sort(), files);
    for (const [index, file] of files.entries()) {
        assert.deepEqual(readFileSync(path.join(dir, 'release/numerals', file)), before[index]);
        assert.deepEqual(readFileSync(path.join(dir, file)), before[index]);
    }
    assert.equal(readFileSync(path.join(dir, 'output'), 'utf8'), `sha=${git(dir, 'rev-parse', 'HEAD')}\n`);
});

for (const failure of ['mismatched metadata', 'missing main.js', 'missing styles.css']) {
    test('acceptance shell rejects ' + failure + ' before output writes', t => {
        const dir = fixture(t);
        if (failure === 'mismatched metadata') {
            const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
            lock.packages[''].version = '1.12.4';
            writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
        } else {
            rmSync(path.join(dir, failure.slice('missing '.length)));
        }
        assert.notEqual(run(dir).status, 0);
        assert.equal(existsSync(path.join(dir, 'release')), false);
        assert.equal(existsSync(path.join(dir, 'output')), false);
    });
}
