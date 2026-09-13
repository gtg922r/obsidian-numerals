import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const json = (dir, file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
const save = (dir, file, value) => writeFileSync(path.join(dir, file), JSON.stringify(value, null, '\t') + '\n');
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t, repository = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-release-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(path.join(root, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'manifest.json', 'versions.json']) cpSync(path.join(root, file), path.join(dir, file));
    // Use small, independently versioned fixture metadata so tests survive later candidate bumps.
    const pkg = json(dir, 'package.json');
    pkg.version = '1.11.0';
    save(dir, 'package.json', pkg);
    save(dir, 'package-lock.json', { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version } } });
    const manifest = json(dir, 'manifest.json');
    manifest.version = pkg.version;
    save(dir, 'manifest.json', manifest);
    writeFileSync(path.join(dir, 'main.js'), 'module.exports = 42;\n');
    writeFileSync(path.join(dir, 'styles.css'), '.numerals {}\n');
    if (repository) {
        git(dir, 'init', '-b', 'codex/toolchain-test');
        git(dir, 'config', 'user.name', 'Toolchain Test');
        git(dir, 'config', 'user.email', 'test@example.invalid');
        git(dir, 'add', '.');
        git(dir, 'commit', '-m', 'test: candidate fixture');
    }
    return dir;
}

function run(dir, script, args = [], env = {}) {
    return spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
    });
}

const metadataFiles = ['package.json', 'package-lock.json', 'manifest.json', 'versions.json'];
function metadata(dir) {
    return metadataFiles.map(file => readFileSync(path.join(dir, file), 'utf8'));
}

test('release assets preserve reviewed manifest bytes and modern BRAT filenames', t => {
    const dir = fixture(t);
    const before = metadata(dir);
    const result = run(dir, 'prepare-release-artifacts.mjs', ['1.11.0']);
    assert.equal(result.status, 0, result.stderr);
    for (const file of ['manifest.json', 'main.js', 'styles.css']) {
        assert.deepEqual(readFileSync(path.join(dir, 'release/numerals', file)), readFileSync(path.join(dir, file)));
    }
    assert.equal(existsSync(path.join(dir, 'release/numerals/manifest-beta.json')), false);
    assert.deepEqual(metadata(dir), before);
});

for (const tag of ['1.11.1', '1.10.2', 'v1.11.0', '1.11.0-beta', '../1.11.0', '01.11.0', '1.11.0;exit 0']) {
    test('invalid/mismatched tag leaves prior output untouched: ' + tag, t => {
        const dir = fixture(t);
        mkdirSync(path.join(dir, 'release'));
        writeFileSync(path.join(dir, 'release/keep.txt'), 'prior output');
        const before = metadata(dir);
        assert.notEqual(run(dir, 'prepare-release-artifacts.mjs', [tag]).status, 0);
        assert.equal(readFileSync(path.join(dir, 'release/keep.txt'), 'utf8'), 'prior output');
        assert.deepEqual(metadata(dir), before);
    });
}

for (const [file, mutate] of [
    ['package.json', value => { value.version = '1.11.2'; }],
    ['package-lock.json', value => { value.version = '1.11.2'; }],
    ['package-lock.json', value => { value.packages[''].version = '1.11.2'; }],
    ['manifest.json', value => { value.version = '1.11.2'; }],
    ['manifest.json', value => { value.minAppVersion = '0.16.0'; }],
    ['manifest.json', value => { value.id = '../unsafe'; }],
    ['versions.json', value => { value['1.11.0'] = '1.13.0'; }],
]) {
    test('inconsistent ' + file + ' fails before artifact writes', t => {
        const dir = fixture(t);
        const value = json(dir, file);
        mutate(value);
        save(dir, file, value);
        assert.notEqual(run(dir, 'prepare-release-artifacts.mjs', ['1.11.0']).status, 0);
        assert.equal(existsSync(path.join(dir, 'release')), false);
    });
}

for (const [type, expected] of [['patch', '1.11.1'], ['minor', '1.12.0'], ['major', '2.0.0']]) {
    test(type + ' bump synchronizes candidate metadata without touching stable history', t => {
        const dir = fixture(t, true);
        const before = readFileSync(path.join(dir, 'versions.json'));
        assert.equal(run(dir, 'version-increment.mjs', [type]).status, 0);
        assert.equal(json(dir, 'package.json').version, expected);
        assert.equal(json(dir, 'package-lock.json').version, expected);
        assert.equal(json(dir, 'package-lock.json').packages[''].version, expected);
        assert.equal(json(dir, 'manifest.json').version, expected);
        assert.equal(json(dir, 'manifest.json').minAppVersion, '1.13.0');
        assert.deepEqual(readFileSync(path.join(dir, 'versions.json')), before);
        assert.match(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'), /\n\t"name"/);
    });
}

test('invalid bump and stable branch cannot change metadata', t => {
    const dir = fixture(t, true);
    const before = metadata(dir);
    assert.notEqual(run(dir, 'version-increment.mjs', ['typo']).status, 0);
    git(dir, 'switch', '-c', 'master');
    assert.notEqual(run(dir, 'version-increment.mjs', ['patch']).status, 0);
    assert.deepEqual(metadata(dir), before);
});

test('production aliases fail without writes even if recovery documentation is absent', t => {
    const dir = fixture(t, true);
    const before = metadata(dir);
    for (const command of ['release', 'release:production']) {
        const result = spawnSync('npm', ['run', command], { cwd: dir, encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /disabled during recovery/);
    }
    assert.deepEqual(metadata(dir), before);
    assert.equal(git(dir, 'status', '--porcelain'), '');
    assert.equal(git(dir, 'tag', '--list'), '');
});

test('unreviewed feature branch cannot create prerelease tags', t => {
    const dir = fixture(t, true);
    const result = run(dir, 'release-beta.mjs');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Only the owner on chore\/recovery-1.11/);
    assert.equal(git(dir, 'tag', '--list'), '');
});

function reviewedFixture(t) {
    const dir = fixture(t, true);
    const candidate = git(dir, 'rev-parse', 'HEAD');
    // Keep the protected historical blob independent of future candidate metadata.
    cpSync(path.join(root, 'tests/fixtures/stable-1.10.2-manifest.json'), path.join(dir, 'manifest.json'));
    git(dir, 'add', 'manifest.json');
    git(dir, 'commit', '-m', 'test: protected stable metadata');
    git(dir, 'branch', 'master');
    git(dir, 'switch', '-c', 'chore/recovery-1.11', candidate);
    const remote = path.join(dir, 'remote.git');
    git(dir, 'clone', '--bare', '.', remote);
    // Ignore fixture infrastructure so release cleanliness checks stay meaningful.
    writeFileSync(path.join(dir, '.git/info/exclude'), 'remote.git/\nbin/\n');
    git(dir, 'remote', 'add', 'origin', remote);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'gh'), '#!' + process.execPath + '\nif (process.env.TEST_GH_FAILURE) process.exit(1);\nconsole.log(process.env.TEST_RELEASE_TAGS || "");\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'npm'), '#!' + process.execPath + '\nprocess.exit(Number(process.env.TEST_CHECK_EXIT || 0));\n', { mode: 0o755 });
    return { dir, remote, env: { PATH: bin + path.delimiter + process.env.PATH } };
}

test('reviewed prerelease tags exactly the validated commit, preserving remote master metadata', t => {
    const { dir, remote, env } = reviewedFixture(t);
    const stable = git(remote, 'rev-parse', 'master');
    const candidate = git(dir, 'rev-parse', 'HEAD');
    const result = run(dir, 'release-beta.mjs', [], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(remote, 'rev-parse', 'refs/tags/1.11.0'), candidate);
    assert.equal(git(remote, 'rev-parse', 'master'), stable);
    assert.equal(git(remote, 'rev-parse', 'master:manifest.json'), 'a8f7f565d79833c333f77f4acfc3e540a8c69b14');
    assert.equal(git(remote, 'rev-parse', 'master:versions.json'), '51aa485d3ba838dcef42ab89206b36d4e2e07136');
    assert.equal(run(dir, 'check-release.mjs', ['--tag', '1.11.0', '--reviewed']).status, 0);
});

for (const [label, extra] of [
    ['existing release', { TEST_RELEASE_TAGS: '1.11.0' }],
    ['release API failure', { TEST_GH_FAILURE: '1' }],
    ['failed required checks', { TEST_CHECK_EXIT: '1' }],
]) {
    test(label + ' prevents any local or remote tag creation', t => {
        const { dir, remote, env } = reviewedFixture(t);
        assert.notEqual(run(dir, 'release-beta.mjs', [], { ...env, ...extra }).status, 0);
        assert.equal(git(dir, 'tag', '--list'), '');
        assert.equal(git(remote, 'tag', '--list'), '');
    });
}

test('an existing remote tag cannot be replaced', t => {
    const { dir, remote, env } = reviewedFixture(t);
    git(remote, 'tag', '1.11.0', 'master');
    const before = git(remote, 'rev-parse', 'refs/tags/1.11.0');
    assert.notEqual(run(dir, 'release-beta.mjs', [], env).status, 0);
    assert.equal(git(remote, 'rev-parse', 'refs/tags/1.11.0'), before);
    assert.equal(git(dir, 'tag', '--list'), '');
});

test('unmerged and dirty source cannot release', t => {
    const { dir, remote, env } = reviewedFixture(t);
    writeFileSync(path.join(dir, 'unreviewed.txt'), 'not reviewed');
    assert.notEqual(run(dir, 'release-beta.mjs', [], env).status, 0);
    git(dir, 'add', 'unreviewed.txt');
    git(dir, 'commit', '-m', 'test: unreviewed change');
    assert.notEqual(run(dir, 'release-beta.mjs', [], env).status, 0);
    assert.equal(git(remote, 'tag', '--list'), '');
});

test('modified stable distribution metadata blocks publication', t => {
    const { dir, env } = reviewedFixture(t);
    git(dir, 'switch', 'master');
    const stable = json(dir, 'manifest.json');
    stable.version = '1.11.0';
    save(dir, 'manifest.json', stable);
    git(dir, 'add', 'manifest.json');
    git(dir, 'commit', '-m', 'test: unauthorized stable change');
    git(dir, 'push', 'origin', 'master');
    git(dir, 'switch', 'chore/recovery-1.11');
    const result = run(dir, 'release-beta.mjs', [], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stable master distribution metadata/);
});
