import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = load(readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const shellSteps = workflow.jobs.publish.steps.filter(step => step.run);
const validatedSha = 'a'.repeat(40);

// Model immutable published releases and the GitHub API. The actual inline
// workflow shell runs against this executable; no network or real release writes.
const fakeGh = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const store = process.env.TEST_API_STATE;
const state = JSON.parse(fs.readFileSync(store, 'utf8'));
const endpoint = args.find(arg => arg.startsWith('repos/') || arg.startsWith('https://'));
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
const call = { endpoint, method };
state.calls.push(call);
const save = () => fs.writeFileSync(store, JSON.stringify(state));
const done = value => { save(); console.log(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0); };
const fail = message => { save(); console.error(message); process.exit(1); };
const expectedSha = process.env.VALIDATED_SHA;
const releasePath = 'repos/' + process.env.GH_REPO + '/releases';
const moved = process.env.TEST_TAG_MOVED || (process.env.TEST_TAG_MOVED_LATE && state.assets.length === 3);
if (endpoint === releasePath + '?per_page=100') {
    if (process.env.TEST_LIST_FAILURE) fail('release list API failed');
    done(state.existing ? process.env.RELEASE_TAG : '');
}
if (endpoint.includes('/git/ref/tags/')) {
    if (process.env.TEST_TAG_MISSING) fail('404 missing tag');
    done({ object: process.env.TEST_ANNOTATED
        ? { type: 'tag', sha: 'b'.repeat(40) }
        : { type: 'commit', sha: moved ? 'c'.repeat(40) : expectedSha } });
}
if (endpoint.includes('/git/tags/')) done({ object: { type: 'commit', sha: moved ? 'c'.repeat(40) : expectedSha } });
if (endpoint.includes('/git/ref/heads/')) done(process.env.TEST_TIP_MOVED ? 'd'.repeat(40) : expectedSha);
if (endpoint === releasePath && method === 'POST') {
    if (state.existing || state.release) fail('422 release already exists');
    const body = JSON.parse(fs.readFileSync(input));
    call.body = body;
    if (!body.draft || !body.prerelease || body.make_latest !== 'false' || body.target_commitish !== expectedSha) fail('unsafe creation payload');
    state.release = { id: 417, ...body };
    done(state.release);
}
const assetMatch = endpoint.match(/\\/releases\\/(\\d+)\\/assets(?:\\?|$)/);
if (assetMatch) {
    if (!state.release || Number(assetMatch[1]) !== state.release.id) fail('wrong release ID');
    if (method === 'POST') {
        if (!state.release.draft) fail('published releases are immutable');
        const name = new URL(endpoint).searchParams.get('name');
        if (process.env.TEST_FAIL_UPLOAD === name) fail('asset upload failed');
        if (state.assets.some(asset => asset.name === name)) fail('422 duplicate asset');
        const bytes = fs.readFileSync(input);
        const asset = { name, state: 'uploaded', size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') };
        state.assets.push(asset);
        done(asset);
    }
    const assets = structuredClone(state.assets);
    if (process.env.TEST_BAD_DIGEST) assets[0].digest = 'sha256:' + '0'.repeat(64);
    if (process.env.TEST_MISSING_ASSET) assets.pop();
    if (process.env.TEST_EXTRA_ASSET) assets.push({ name: 'unexpected.zip', state: 'uploaded', size: 1 });
    done([assets]); // gh api --paginate --slurp
}
if (state.release && endpoint === releasePath + '/' + state.release.id) {
    if (method === 'GET') done(state.release);
    if (method === 'PATCH') {
        const body = JSON.parse(fs.readFileSync(input));
        call.body = body;
        if (body.draft !== false || body.prerelease !== true || body.make_latest !== 'false' || body.target_commitish !== expectedSha) fail('unsafe publication payload');
        if (state.assets.length !== 3) fail('incomplete assets');
        if (process.env.TEST_PUBLISH_FAILURE) fail('publish API failed');
        Object.assign(state.release, body);
        done(state.release);
    }
}
fail('Unexpected API operation: ' + method + ' ' + endpoint);
`;

function runPublication(t, extra = {}, existing = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'numerals-publish-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, 'bin'));
    mkdirSync(path.join(dir, 'release/numerals'), { recursive: true });
    for (const file of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(path.join(dir, 'release/numerals', file), 'validated ' + file + '\n');
    const store = path.join(dir, 'api-state.json');
    writeFileSync(store, JSON.stringify({ existing, release: null, assets: [], calls: [] }));
    writeFileSync(path.join(dir, 'bin/gh'), '#!' + process.execPath + '\n' + fakeGh, { mode: 0o755 });
    const output = path.join(dir, 'outputs');
    writeFileSync(output, '');
    const env = {
        ...process.env, ...extra, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH,
        GH_TOKEN: 'offline-test-token', GH_REPO: 'gtg922r/obsidian-numerals', RELEASE_TAG: '1.11.0',
        VALIDATED_SHA: validatedSha, RUNNER_TEMP: dir, GITHUB_OUTPUT: output, TEST_API_STATE: store,
    };
    let result;
    for (const step of shellSteps) {
        result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], { cwd: dir, env, encoding: 'utf8' });
        if (result.status !== 0) break; // GitHub's default success() gate.
    }
    return { result, state: JSON.parse(readFileSync(store, 'utf8')), output: readFileSync(output, 'utf8') };
}

for (const annotated of [false, true]) {
    test('publishes a complete draft by its reserved ID with a ' + (annotated ? 'annotated' : 'lightweight') + ' tag', t => {
        const { result, state, output } = runPublication(t, annotated ? { TEST_ANNOTATED: '1' } : {});
        assert.equal(result.status, 0, result.stderr);
        assert.equal(state.release.draft, false);
        assert.equal(state.release.prerelease, true);
        assert.equal(state.release.make_latest, 'false');
        assert.equal(state.release.target_commitish, validatedSha);
        assert.deepEqual(state.assets.map(asset => asset.name).sort(), ['main.js', 'manifest.json', 'styles.css']);
        assert.equal(output, 'release_id=417\n');
        const create = state.calls.findIndex(call => call.method === 'POST' && call.endpoint.endsWith('/releases'));
        const publish = state.calls.findIndex(call => call.method === 'PATCH');
        assert.equal(state.calls[create].body.draft, true);
        assert.ok(state.calls.slice(create + 1, publish).filter(call => call.method === 'POST').every(call => call.endpoint.includes('/releases/417/assets?')));
        assert.equal(state.calls[publish].endpoint, 'repos/gtg922r/obsidian-numerals/releases/417');
        assert.equal(state.calls.filter(call => call.endpoint.includes('/git/ref/tags/')).length, 2);
    });
}

for (const [label, env] of [
    ['release-list failure', { TEST_LIST_FAILURE: '1' }],
    ['missing remote tag', { TEST_TAG_MISSING: '1' }],
    ['moved remote tag', { TEST_TAG_MOVED: '1' }],
    ['changed integration tip', { TEST_TIP_MOVED: '1' }],
]) {
    test(label + ' prevents draft creation and publication', t => {
        const { result, state } = runPublication(t, env);
        assert.notEqual(result.status, 0);
        assert.equal(state.release, null);
        assert.ok(state.calls.every(call => call.method === 'GET'));
    });
}

test('an existing release or draft is never reused', t => {
    const { result, state } = runPublication(t, {}, true);
    assert.notEqual(result.status, 0);
    assert.equal(state.release, null);
    assert.equal(state.calls.length, 1);
});

for (const [label, env] of [
    ['first upload failure', { TEST_FAIL_UPLOAD: 'main.js' }],
    ['partial upload failure', { TEST_FAIL_UPLOAD: 'manifest.json' }],
    ['missing expected asset', { TEST_MISSING_ASSET: '1' }],
    ['unexpected asset', { TEST_EXTRA_ASSET: '1' }],
    ['wrong uploaded digest', { TEST_BAD_DIGEST: '1' }],
    ['tag moved during upload', { TEST_TAG_MOVED_LATE: '1' }],
]) {
    test(label + ' leaves a private draft without attempting publication', t => {
        const { result, state } = runPublication(t, env);
        assert.notEqual(result.status, 0);
        assert.equal(state.release.draft, true);
        assert.equal(state.release.prerelease, true);
        assert.ok(!state.calls.some(call => call.method === 'PATCH'));
    });
}

test('publication API failure leaves the complete draft private', t => {
    const { result, state } = runPublication(t, { TEST_PUBLISH_FAILURE: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(state.release.draft, true);
    assert.equal(state.assets.length, 3);
});
