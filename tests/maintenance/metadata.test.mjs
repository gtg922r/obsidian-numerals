import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const protectedFiles = ['package.json', 'package-lock.json', 'manifest.json', 'versions.json', 'styles.css'];
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-maintenance-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, 'scripts'));
    for (const file of protectedFiles) cpSync(path.join(root, file), path.join(dir, file));
    cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
    cpSync(path.join(root, 'scripts/check-stable-maintenance.mjs'), path.join(dir, 'scripts/check-stable-maintenance.mjs'));
    git(dir, 'init', '-b', 'maintenance-test');
    git(dir, 'config', 'user.name', 'Numerals tests');
    git(dir, 'config', 'user.email', 'tests@example.invalid');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'test: preserved default-branch fixture');
    return dir;
}

const check = dir => spawnSync(process.execPath, ['scripts/check-stable-maintenance.mjs'], { cwd: dir, encoding: 'utf8' });

test('preserved baseline and distribution metadata pass after a documentation commit advances HEAD', t => {
    const dir = fixture(t);
    const before = protectedFiles.map(file => readFileSync(path.join(dir, file), 'utf8'));
    writeFileSync(path.join(dir, 'README.md'), 'Documentation maintenance.\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-m', 'docs: maintenance fixture');
    const result = check(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(protectedFiles.map(file => readFileSync(path.join(dir, file), 'utf8')), before);
});

for (const file of protectedFiles) {
    test('even a formatting-only change to ' + file + ' fails the stable guard', t => {
        const dir = fixture(t);
        appendFileSync(path.join(dir, file), '\n');
        const result = check(dir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp('Protected baseline file changed: ' + file.replaceAll('.', '\\.')));
    });
}

test('product stylesheet edits fail even with a clean committed worktree', t => {
    const dir = fixture(t);
    appendFileSync(path.join(dir, 'styles.css'), '\n.numerals { display: none; }\n');
    git(dir, 'add', 'styles.css');
    git(dir, 'commit', '-m', 'test: stylesheet change');
    assert.equal(git(dir, 'status', '--porcelain'), '');
    const result = check(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Protected baseline file changed: styles\.css/);
});

test('a committed source change fails even with a clean worktree', t => {
    const dir = fixture(t);
    appendFileSync(path.join(dir, 'src/main.ts'), '\n// Changed plugin source.\n');
    git(dir, 'add', 'src/main.ts');
    git(dir, 'commit', '-m', 'test: source change');
    assert.equal(git(dir, 'status', '--porcelain'), '');
    const result = check(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Committed plugin source differs/);
});

test('checks cannot silently modify tracked plugin source', t => {
    const dir = fixture(t);
    appendFileSync(path.join(dir, 'src/main.ts'), '\n// Unexpected build mutation.\n');
    assert.notEqual(check(dir).status, 0);
});

test('new untracked plugin source is rejected', t => {
    const dir = fixture(t);
    writeFileSync(path.join(dir, 'src/unexpected.ts'), 'export const unexpected = true;\n');
    const result = check(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Untracked plugin source/);
});

test('ignore rules cannot conceal additional plugin source', t => {
    const dir = fixture(t);
    writeFileSync(path.join(dir, '.git/info/exclude'), 'src/ignored.js\n');
    writeFileSync(path.join(dir, 'src/ignored.js'), 'module.exports = "unexpected";\n');
    assert.equal(git(dir, 'status', '--porcelain'), '');
    const result = check(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Untracked plugin source/);
});
