import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The maintenance lock already includes this parser through ESLint.
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const text = readFileSync(path.join(root, '.github/workflows/installed-acceptance.yml'), 'utf8');
const message = '::error::Select the reviewed chore/recovery-1.11 ref for installed candidate acceptance. This registration stub always refuses execution.';

function validateStub(workflow) {
    assert.deepEqual(Object.keys(workflow).sort(), ['jobs', 'name', 'on', 'permissions']);
    assert.equal(workflow.name, 'Installed candidate acceptance');
    assert.deepEqual(workflow.on, {
        workflow_dispatch: { inputs: {
            selection: { description: 'Owner-reviewed bounded artifact-selection JSON', required: true, type: 'string' },
            plan: { description: 'Reviewed allowlisted .plan.json filename', required: true, type: 'string' },
        } },
    });
    assert.deepEqual(workflow.permissions, {});
    assert.deepEqual(Object.keys(workflow.jobs), ['registration-only']);
    const job = workflow.jobs['registration-only'];
    assert.deepEqual(Object.keys(job).sort(), ['runs-on', 'steps', 'timeout-minutes']);
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job['timeout-minutes'], 1);
    assert.equal(job.steps.length, 1);
    assert.deepEqual(Object.keys(job.steps[0]).sort(), ['name', 'run']);
    // This literal command allowlist prevents input reads, interpolation and any
    // additional command from executing, even if it would ultimately exit 1.
    assert.equal(job.steps[0].run, `echo "${message}"\nexit 1\n`);
    return job.steps[0].run;
}

test('manual acceptance registration exposes only the agreed schema and fixed refusal', () => {
    validateStub(load(text));
    assert.ok(!text.includes('${{'), 'The registration stub must not evaluate workflow expressions');
});

test('registration policy rejects automatic triggers, privileges, inputs and executable additions', () => {
    const mutations = [
        workflow => { workflow.on.push = {}; },
        workflow => { workflow.on.workflow_run = { workflows: ['checks'], types: ['completed'] }; },
        workflow => { workflow.permissions.contents = 'write'; },
        workflow => { workflow.jobs['registration-only'].permissions = { 'id-token': 'write' }; },
        workflow => { workflow.on.workflow_dispatch.inputs.plan.default = 'unreviewed.plan.json'; },
        workflow => { workflow.jobs['registration-only'].env = { SELECTION: '${{ inputs.selection }}' }; },
        workflow => { workflow.jobs['registration-only'].if = "github.ref == 'refs/heads/master'"; },
        workflow => { workflow.jobs['registration-only'].steps.push({ uses: 'actions/checkout@unreviewed' }); },
        workflow => { workflow.jobs['registration-only'].steps[0].run = 'echo "${{ inputs.selection }}"\nexit 1\n'; },
        workflow => { workflow.jobs['registration-only'].steps[0].run = 'node scripts/acceptance.mjs\nexit 1\n'; },
    ];
    for (const mutate of mutations) {
        const workflow = load(text);
        mutate(workflow);
        assert.throws(() => validateStub(workflow));
    }
});

function snapshot(dir) {
    return readdirSync(dir, { recursive: true }).sort().filter(file => !['bin'].includes(file)).map(file => [file, readFileSync(path.join(dir, file)).toString('base64')]);
}

test('copied registration stub refuses every ref without reading hostile inputs or invoking tools', t => {
    const shell = validateStub(load(text)); // Reject expanded code before executing the fixture.
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-dispatch-registration-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'installed-acceptance.yml'), text);
    for (const command of ['git', 'gh', 'node', 'npm', 'curl', 'wget']) {
        writeFileSync(path.join(dir, 'bin', command), '#!/bin/sh\necho unexpected >> "$TEST_OPERATIONS"\nexit 1\n', { mode: 0o755 });
    }
    const before = snapshot(dir);
    for (const ref of ['refs/heads/master', 'refs/heads/chore/recovery-1.11', 'refs/heads/copied-stub', 'refs/tags/1.11.0']) {
        const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', shell], {
            cwd: dir, encoding: 'utf8',
            env: {
                ...process.env, PATH: path.join(dir, 'bin'), GITHUB_REF: ref,
                TEST_OPERATIONS: path.join(dir, 'unexpected-operations'),
                INPUT_SELECTION: '$(touch input-was-evaluated); private selection must not be printed',
                INPUT_PLAN: '../unreviewed.plan.json',
            },
        });
        assert.equal(result.status, 1, result.stderr);
        assert.equal(result.stdout, message + '\n');
        assert.equal(result.stderr, '');
        assert.deepEqual(snapshot(dir), before);
    }
});
