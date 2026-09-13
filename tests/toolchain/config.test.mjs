import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ESLint } from 'eslint';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const workflow = name => load(readFileSync(path.join(root, '.github/workflows', name), 'utf8'));

function fixture(t) {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'numerals-config-test-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const folder of ['src', 'tests', '__mocks__', 'scripts']) mkdirSync(path.join(dir, folder));
    for (const file of ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json', 'jest.config.js']) cpSync(path.join(root, file), path.join(dir, file));
    cpSync(path.join(root, 'tests/setupDom.ts'), path.join(dir, 'tests/setupDom.ts'));
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

test('PR CI is unprivileged and includes every required check', () => {
    const ci = workflow('ci.yml');
    assert.ok(ci.on.pull_request);
    assert.equal(ci.on.pull_request_target, undefined);
    assert.equal(ci.on.workflow_run, undefined);
    assert.deepEqual(ci.permissions, { contents: 'read' });
    const steps = ci.jobs.checks.steps;
    for (const command of ['npm ci', 'npm run lint', 'npm run typecheck', 'npm run typecheck:tests', 'npm run typecheck:scripts', 'npm test -- --runInBand', 'npm run test:toolchain', 'npm run build', 'npm run symbols:check', 'npm run build:reproducible', 'npm run release:check']) {
        assert.ok(steps.some(step => step.run === command), 'Missing check: ' + command);
    }
    assert.equal(readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), '24');
    const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with['persist-credentials'], false);
    assert.ok(steps.findIndex(step => step.run?.includes('--reviewed')) < steps.findIndex(step => step.run === 'npm ci'));
});

test('release writes require successful checks and explicit prerelease-only options', () => {
    const release = workflow('release.yml');
    assert.deepEqual(Object.keys(release.on), ['push']);
    assert.deepEqual(release.permissions, { contents: 'read' });
    assert.equal(release.jobs.validate.uses, './.github/workflows/ci.yml');
    assert.equal(release.jobs.publish.needs, 'validate');
    const steps = release.jobs.publish.steps;
    assert.ok(!steps.some(step => step.uses?.startsWith('actions/checkout@') || /npm |node scripts\//.test(step.run ?? '')));
    const create = steps.findIndex(step => step.id === 'prerelease');
    assert.ok(create >= 0);
    assert.match(steps[create].run, /draft: true, prerelease: true, make_latest: "false"/);
    assert.match(steps[create].run, /draft: false, prerelease: true, make_latest: "false"/);
    assert.ok(!steps.some(step => step.uses?.startsWith('softprops/action-gh-release@')));
    assert.equal(release.concurrency['cancel-in-progress'], false);
    assert.ok(steps.findIndex(step => step.run?.includes('releases?per_page=100')) < create);
    const attest = steps.find(step => step.uses?.startsWith('actions/attest@'));
    assert.equal(attest.with['create-storage-record'], false);
    assert.deepEqual(release.jobs.publish.permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' });
});

test('all third-party workflow Actions use immutable commit pins', () => {
    for (const name of ['ci.yml', 'release.yml']) {
        for (const job of Object.values(workflow(name).jobs)) {
            for (const step of job.steps ?? []) {
                if (step.uses) assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/);
            }
        }
    }
});
