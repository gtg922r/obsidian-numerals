import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

function fixture(t) {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'numerals-config-test-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const folder of ['src', 'tests', '__mocks__', 'scripts']) mkdirSync(path.join(dir, folder));
    for (const file of ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json', 'jest.config.js']) cpSync(path.join(root, file), path.join(dir, file));
    symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    return dir;
}

function compile(dir, config) {
    return spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config, '--pretty', 'false'], { cwd: dir, encoding: 'utf8' });
}

test('production, test and script checks each reject real TypeScript errors', t => {
    const dir = fixture(t);
    writeFileSync(path.join(dir, 'src/index.ts'), 'export const value: number = 1;');
    writeFileSync(path.join(dir, 'tests/index.test.ts'), 'const testValue: number = "wrong";');
    writeFileSync(path.join(dir, 'scripts/check.ts'), 'const scriptValue: boolean = "wrong";');
    assert.equal(compile(dir, 'tsconfig.json').status, 0);
    const tests = compile(dir, 'tsconfig.test.json');
    assert.notEqual(tests.status, 0);
    assert.match(tests.stdout, /tests\/index.test.ts/);
    assert.notEqual(compile(dir, 'tsconfig.scripts.json').status, 0);
    writeFileSync(path.join(dir, 'src/index.ts'), 'export const value: number = "wrong";');
    assert.notEqual(compile(dir, 'tsconfig.json').status, 0);
});

test('nested worktrees are excluded from tsc, Jest discovery and ESLint', async t => {
    const dir = fixture(t);
    writeFileSync(path.join(dir, 'src/index.ts'), 'export const value: number = 1;');
    writeFileSync(path.join(dir, 'tests/index.test.ts'), 'test("real", () => expect(1).toBe(1));');
    writeFileSync(path.join(dir, 'scripts/check.ts'), 'export const value: number = 1;');
    const eslint = new ESLint({ cwd: dir, overrideConfigFile: path.join(root, 'eslint.config.mjs') });
    for (const folder of ['worktrees', '.worktrees', '.codex/worktrees']) {
        for (const parent of ['src', 'tests', 'scripts']) {
            const nested = path.join(dir, parent, folder, 'nested');
            mkdirSync(nested, { recursive: true });
            const file = path.join(nested, 'broken.test.ts');
            writeFileSync(file, 'const wrong: number = "nested worktree must not be checked";');
            assert.equal(await eslint.isPathIgnored(file), true);
        }
    }
    for (const config of ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json']) {
        const result = compile(dir, config);
        assert.equal(result.status, 0, result.stdout);
    }
    assert.equal(await eslint.isPathIgnored(path.join(dir, 'src/index.ts')), false);
    const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--config', path.join(dir, 'jest.config.js'), '--listTests', '--runInBand', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [path.join(dir, 'tests/index.test.ts')]);
});
