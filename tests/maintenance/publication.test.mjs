import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-publication-denial-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'bin'));
    for (const file of ['package.json', 'package-lock.json', 'manifest.json', 'versions.json', 'scripts/release-beta.mjs', 'scripts/release-production.mjs']) {
        cpSync(path.join(root, file), path.join(dir, file));
    }
    writeFileSync(path.join(dir, 'main.js'), 'existing bundle');
    writeFileSync(path.join(dir, 'styles.css'), 'existing styles');
    for (const command of ['git', 'gh']) {
        writeFileSync(path.join(dir, 'bin', command), '#!/bin/sh\necho unexpected >> "$TEST_OPERATIONS"\nexit 1\n', { mode: 0o755 });
    }
    const env = {
        ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH,
        TEST_OPERATIONS: path.join(dir, 'unexpected-operations'),
        GITHUB_REF: 'refs/tags/1.11.0', GITHUB_REF_NAME: '1.11.0',
        NUMERALS_ALLOW_PRODUCTION: 'true',
    };
    return { dir, env };
}

function snapshot(dir, prefix = '') {
    return readdirSync(path.join(dir, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        const file = path.join(prefix, entry.name);
        return entry.isDirectory() ? snapshot(dir, file) : [[file, readFileSync(path.join(dir, file)).toString('base64')]];
    });
}

for (const alias of ['release', 'release:beta', 'release:production']) {
    test(alias + ' always fails without changing metadata, assets or invoking Git/GitHub', t => {
        const { dir, env } = fixture(t);
        const before = snapshot(dir);
        const result = spawnSync('npm', ['run', alias], { cwd: dir, env, encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Publication from stable maintenance is disabled/);
        assert.match(result.stderr, /chore\/recovery-1.11/);
        assert.deepEqual(snapshot(dir), before);
    });
}

test('release entrypoints also refuse from an empty directory without policy files', t => {
    const { dir, env } = fixture(t);
    const empty = path.join(dir, 'empty');
    mkdirSync(empty);
    const before = snapshot(dir);
    for (const file of ['release-beta.mjs', 'release-production.mjs']) {
        const result = spawnSync(process.execPath, [path.join(dir, 'scripts', file)], { cwd: empty, env, encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Publication from stable maintenance is disabled/);
    }
    assert.deepEqual(snapshot(dir), before);
});

test('the tag workflow has no Actions or write permissions and executes an explicit failure', t => {
    const { dir, env } = fixture(t);
    const workflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    assert.match(workflow, /^permissions: \{\}$/m);
    assert.doesNotMatch(workflow, /^\s*uses:/m);
    assert.doesNotMatch(workflow, /^\s*[\w-]+: write\s*$/m);
    const runs = [...workflow.matchAll(/^ {8}run: \|\n((?: {10}[^\n]*\n)+)/gm)];
    assert.equal(runs.length, 1, 'Expected one inspectable denial shell step');
    const shell = runs[0][1].replace(/^ {10}/gm, '');
    const before = snapshot(dir);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], { cwd: dir, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Publication from stable maintenance is disabled/);
    assert.deepEqual(snapshot(dir), before);
});
