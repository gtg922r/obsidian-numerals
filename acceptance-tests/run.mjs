import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import C from './contracts.cjs';
import {candidateZip} from './archive.cjs';
import {connect, targetProof} from './cdp.mjs';
import {runFamily, nativeAction} from './controller.mjs';
import {validateFamily} from './validate.mjs';
import {DiskEvidence} from './disk.mjs';
import {cancellable, childExit, processTeardown} from './cancellation.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));

export async function boundedFetch(url, maximum, expectedHash, headers = {}, signal) {
  C.check(new URL(url).protocol === 'https:', 'download-protocol');
  const response = await fetch(url, {headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)}); C.check(response.ok, 'download-response');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; C.check(size <= maximum, 'download-size'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (expectedHash) C.check(size === maximum && C.hash(bytes) === expectedHash, 'download-identity');
  return bytes;
}
async function receipt(selection, signal) {
  const prefix = `https://api.github.com/repos/${selection.repository}`;
  const headers = {Accept: 'application/vnd.github+json'};
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const json = async suffix => JSON.parse(await boundedFetch(prefix + suffix, 4 * 1024 * 1024, undefined, headers, signal));
  const run = await json(`/actions/runs/${selection.runId}/attempts/${selection.runAttempt}`);
  const artifact = await json(`/actions/artifacts/${selection.artifactId}`);
  const commit = await json(`/git/commits/${selection.integrationCommit}`);
  C.selectionCheck(selection, {run, artifact, commit});
  const bytes = await boundedFetch(`${prefix}/actions/artifacts/${selection.artifactId}/zip`, C.LIMITS.bytes, undefined, headers, signal);
  return {files: candidateZip(bytes, selection), receipt: {runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id, commit: commit.sha, tree: commit.tree.sha}};
}
export function cleanFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return /^[a-z][a-z0-9-]{0,70}$/.test(message) ? message : 'unexpected-controller-failure';
}
/** The on-disk execution gate is deliberately closed in this engineering increment. */
export async function preflight(env = process.env, platform = process.platform, arch = process.arch) {
  C.environmentCheck(env, platform, arch);
  const execution = JSON.parse(await fs.readFile(path.join(directory, 'execution.json')));
  C.check(execution.enabled === true, 'host-execution-wiring-disabled');
}
/** Only the reviewed first Reading plan is dispatchable; one mode per fresh process. */
export function dispatchSelection(selectionText, planName) {
  C.check(typeof selectionText === 'string' && Buffer.byteLength(selectionText) <= 16384, 'dispatch-selection-size');
  C.check(planName === 'native-ordering.plan.json', 'dispatch-plan-allowlist');
  const selection = C.selectionCheck(JSON.parse(selectionText));
  C.check(selection.integration === 'none', 'first-admission-integration');
  return selection;
}
export async function main({selectionText, planName} = {}) {
  await preflight(); // No selection read, network, temporary profile, child or CDP before this gate.
  const selection = dispatchSelection(selectionText, planName);
  C.check(selection.harnessCommit === process.env.GITHUB_SHA, 'dispatch-helper-head');
  const catalogBytes = await fs.readFile(path.join(directory, 'catalog.json')), catalog = JSON.parse(catalogBytes);
  const inputsBytes = await fs.readFile(path.join(directory, 'inputs.json')), inputs = JSON.parse(inputsBytes);
  const planBytes = await fs.readFile(path.join(directory, planName)), plan = JSON.parse(planBytes);
  C.catalogCheck(catalog); C.planCheck(plan, catalog);
  C.check(C.hash(catalogBytes) === selection.catalogSha256 && C.hash(inputsBytes) === selection.inputsSha256 && C.hash(planBytes) === selection.planSha256, 'selected-input-hashes');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: directory, encoding: 'utf8'}).trim();
  C.check(head === selection.harnessCommit && execFileSync('git', ['status', '--porcelain'], {cwd: directory, encoding: 'utf8'}).trim() === '', 'harness-head');
  const helper = await fs.readFile(path.join(directory, 'dist/main.js')); C.check(C.hash(helper) === selection.helperSha256, 'helper-identity');
  const control = await fs.readFile(path.join(directory, 'dist/control.js')); C.check(C.hash(control) === selection.controlSha256, 'control-identity');
  const output = path.join(directory, 'evidence'); await fs.mkdir(output);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'numerals-acceptance-')); await fs.chmod(scratch, 0o700);
  const root = path.join(scratch, 'Numerals Acceptance NA13B'), children = new Set(), connections = new Set();
  const config = {root, nonce: crypto.randomBytes(32).toString('hex'), catalogSha256: C.hash(catalogBytes), integration: selection.integration};
  const abort = new AbortController(); let shuttingDown = false, profile, stage = 'prepare', result, provenance;
  const teardown = processTeardown(children, connections);
  abort.signal.addEventListener('abort', () => teardown.start(), {once: true});
  const timer = setTimeout(() => abort.abort(), C.LIMITS.deadlineMs);
  const stop = () => abort.abort(); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const alive = () => C.check(!abort.signal.aborted && !shuttingDown, 'controller-cancelled');
  const launch = (command, args) => {
    alive(); const child = spawn(command, args, {cwd: scratch, env: C.appEnvironment(process.env, ':91', scratch), stdio: 'ignore', detached: true});
    children.add(child); child.once('error', stop); child.once('exit', () => { if (!shuttingDown && child.persistent) stop(); }); return child;
  };
  const until = async (probe, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { alive(); const value = await cancellable(probe, abort.signal); alive(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw Error('controller-wait-deadline');
  };
  try {
    stage = 'candidate-verification'; const candidate = await receipt(selection, abort.signal); alive();
    await fs.mkdir(root); await fs.writeFile(path.join(root, '.acceptance-marker.json'), JSON.stringify({id: C.ID, nonce: config.nonce, catalogSha256: config.catalogSha256}));
    await fs.writeFile(path.join(root, '.acceptance-config.json'), JSON.stringify(config)); await fs.writeFile(path.join(root, '.acceptance-catalog.json'), catalogBytes);
    for (const scenario of catalog.scenarios) for (const note of scenario.notes) { const dest = C.within(root, note.path); await fs.mkdir(path.dirname(dest), {recursive: true}); await fs.writeFile(dest, note.text); }
    const pluginPath = path.join(root, '.obsidian/plugins/numerals'); await fs.mkdir(pluginPath, {recursive: true});
    for (const [name, bytes] of candidate.files) await fs.writeFile(path.join(pluginPath, name), bytes);
    C.installedCheck(pluginPath, selection);
    if (selection.mode === 'instrumented') {
      const dest = path.join(root, '.obsidian/plugins', C.PLUGIN); await fs.mkdir(dest);
      await fs.writeFile(path.join(dest, 'main.js'), helper);
      await fs.writeFile(path.join(dest, 'manifest.json'), JSON.stringify({id: C.PLUGIN, name: 'Synthetic acceptance observer', version: '0.0.1', minAppVersion: '1.13.0', description: 'Disposable passive acceptance observations', author: 'Numerals', isDesktopOnly: true}));
    }
    await fs.writeFile(path.join(root, '.obsidian/community-plugins.json'), JSON.stringify(selection.mode === 'instrumented' ? [C.PLUGIN, 'numerals'] : selection.mode === 'control' ? ['numerals'] : []));
    await fs.writeFile(path.join(root, '.obsidian/core-plugins.json'), '[]');
    await fs.writeFile(path.join(root, '.obsidian/app.json'), JSON.stringify({livePreview: true, defaultViewMode: 'preview'}));
    if (selection.integration === 'dataview') {
      const dest = path.join(root, '.obsidian/plugins/dataview'); await fs.mkdir(dest);
      for (const asset of inputs.dataview.assets) await fs.writeFile(path.join(dest, asset.name), await boundedFetch(asset.url, asset.size, asset.sha256, {}, abort.signal));
      // Staged but disabled. Native UI enable/disable acceptance needs the later reviewed driver.
    }
    C.guard(root, config); stage = 'host-inputs';
    const installer = path.join(scratch, inputs.host.installer.name);
    await fs.writeFile(installer, await boundedFetch(inputs.host.installer.url, inputs.host.installer.size, inputs.host.installer.sha256, {}, abort.signal));
    const compressed = await boundedFetch(inputs.host.app.url, inputs.host.app.size, inputs.host.app.sha256, {}, abort.signal), asar = gunzipSync(compressed);
    C.check(C.hash(asar) === inputs.host.app.uncompressedSha256, 'host-asar-identity');
    const appPath = path.join(scratch, 'obsidian.asar'); await fs.writeFile(appPath, asar);
    const sevenZip = fileURLToPath(new URL('./7z.js', import.meta.resolve('obsidian-launcher'))), extracted = path.join(scratch, 'installer');
    const extractor = launch(process.execPath, extractionArgs(sevenZip, scratch, installer, extracted));
    await childExit(extractor, abort.signal); alive();
    const versions = path.join(scratch, 'versions.json'), empty = path.join(scratch, 'empty.json');
    await fs.writeFile(versions, JSON.stringify({metadata: {schemaVersion: '2.2.0'}, versions: [{version: inputs.host.version, isBeta: false, minInstallerVersion: inputs.host.version, maxInstallerVersion: inputs.host.version, downloads: {}, installers: {}}]}));
    await fs.writeFile(empty, '[]');
    await fs.writeFile(path.join(scratch, 'profile-input.json'), JSON.stringify({appVersion: inputs.host.version, installerVersion: inputs.host.version, appPath, vault: root}));
    await childExit(launch(process.execPath, [path.join(directory, 'profile-worker.mjs')]), abort.signal); alive();
    ({profile} = JSON.parse(await fs.readFile(path.join(scratch, 'profile-output.json'))));
    C.check(path.dirname(profile) === scratch && (await fs.realpath(profile)) === profile, 'profile-location');
    const settingsPath = path.join(profile, 'obsidian.json'), settings = JSON.parse(await fs.readFile(settingsPath)); settings.cli = false;
    await fs.writeFile(settingsPath, JSON.stringify(settings)); alive(); stage = 'launch';
    const display = launch('Xvfb', [':91', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp']); display.persistent = true;
    await until(() => fs.access('/tmp/.X11-unix/X91').then(() => true, () => false));
    const app = launch(path.join(extracted, 'obsidian'), [`--user-data-dir=${profile}`, '--no-sandbox', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--disable-gpu', '--disable-dev-shm-usage']); app.persistent = true;
    const port = await until(async () => { try { const p = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return Number.isInteger(p) && p > 0 && p < 65536 ? p : false; } catch { return false; } }, 60000);
    const targets = async () => { const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)}); return response.json(); };
    const target = await until(async () => (await targets()).find(t => t.type === 'page' && t.url.startsWith('app://obsidian.md/')), 60000);
    const main = await connect(target, port); connections.add(main);
    C.check(await main.evaluate('app.vault.adapter.getBasePath()') === root, 'main-vault-identity');
    const backend = await makeBackend({main, target, targets, port, connections, selection, control, config: {...config, mode: selection.mode,
      paths: catalog.scenarios.flatMap(s => s.notes.map(n => n.path)), caseIds: plan.cases.map(c => c.id)}, alive, until});
    const disk = new DiskEvidence(root, [...catalog.scenarios.flatMap(s => s.notes.map(n => n.path)), '.obsidian/plugins/numerals/data.json'], () => { alive(); C.guard(root, config); });
    backend.captureDisk = () => disk.capture(); backend.diskBlobs = disk.blobs;
    stage = 'cases'; result = await runFamily(backend, plan, catalog, abort.signal); alive();
    result.savedDisk = await disk.capture();
    C.installedCheck(pluginPath, selection);
    provenance = {selection, candidate: candidate.receipt, host: inputs.host, platform: 'linux-x64', helperSha256: C.hash(helper), controlSha256: C.hash(control), plan: planName, status: 'bounded-observations'};
  } catch (error) { result = {...result, ...error.familyEvidence, failure: {stage, reason: cleanFailure(error)}}; process.exitCode = 1; }
  finally {
    shuttingDown = true; clearTimeout(timer); process.off('SIGTERM', stop); process.off('SIGINT', stop);
    const exits = await teardown.finish();
    try { result = finalizeEvidence(plan, result, exits.every(Boolean)); }
    catch (error) { result.failure = {stage: 'evidence-validation', reason: cleanFailure(error)}; }
    if (result.failure) process.exitCode = 1;
    const names = ['results.json', 'provenance.json', 'selection.json', 'sha256.json'];
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result ?? {failure: {stage}}, null, 2));
    await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance ?? {selection, incomplete: true}, null, 2));
    await fs.writeFile(path.join(output, 'selection.json'), JSON.stringify(selection, null, 2));
    const hashes = {}; for (const name of names.slice(0, -1)) hashes[name] = C.hash(await fs.readFile(path.join(output, name)));
    await fs.writeFile(path.join(output, 'sha256.json'), JSON.stringify(hashes, null, 2));
    C.check((await fs.readdir(output)).sort().join() === names.sort().join(), 'output-allowlist');
    if (exits.every(Boolean)) {
      C.check((await fs.realpath(scratch)) === scratch && path.basename(scratch).startsWith('numerals-acceptance-'), 'cleanup-identity'); await fs.rm(scratch, {recursive: true});
    }
  }
}

export function extractionArgs(sevenZip, scratch, installer, extracted) {
  C.check(path.dirname(installer) === scratch && path.dirname(extracted) === scratch, 'extraction-path');
  // Pinned 7z WASM mounts '/' under '/nodefs' and starts in the mapped cwd.
  return [sevenZip, 'x', path.relative(scratch, installer), `-o${path.relative(scratch, extracted)}`];
}
export function finalizeEvidence(plan, result, processesExited) {
  result ??= {};
  if (!processesExited) {
    result.cleanupFailure = 'owned-process-exit-unconfirmed';
    result.failure ??= {stage: 'cleanup', reason: result.cleanupFailure};
    result.observations ??= {records: [], faults: []};
    result.observations.faults.push(result.cleanupFailure);
  }
  if (result.observations) {
    result.results = validateFamily(plan, result.observations, result.actions, result.mode);
    if (result.results.some(c => c.assertions.some(a => a.status === 'FAIL'))) result.failure ??= {stage: 'assertions', reason: 'installed-assertion-failed'};
  }
  return result;
}

async function makeBackend({main, target, targets, port, connections, selection, control, config, alive, until}) {
  const bridge = selection.mode === 'instrumented' ? '__numeralsAcceptance' : '__numeralsAcceptanceControl';
  if (selection.mode !== 'instrumented') await main.evaluate(`(() => {${control.toString('utf8')}\nreturn NumeralsAcceptanceControl.install(${JSON.stringify(config)});})()`);
  const expression = op => `window.${bridge}.call(${JSON.stringify(config.nonce)},${JSON.stringify(op)})`;
  await until(() => main.evaluate(`Boolean(window.${bridge})`), 60000);
  const hello = await main.evaluate(`window.${bridge}.hello(${JSON.stringify(config.nonce)})`);
  targetProof(target, hello, {...config, windowId: hello.windowId, role: 'main'});
  const byWindow = new Map([[hello.windowId, main]]), leaves = new Map();
  const call = op => main.evaluate(expression(op));
  return {
    mode: selection.mode,
    assertOwned() { alive(); C.guard(config.root, config); },
    begin: caseId => call({op: 'beginCase', caseId}), end: () => call({op: 'endCase'}), drain: () => call({op: 'drain'}),
    async action(action) {
      alive();
      if (['type', 'key'].includes(action.op)) {
        await call({...action, op: 'focus'}); alive(); const connection = byWindow.get(leaves.get(action.leafId)); C.check(connection, 'input-window');
        return nativeAction(connection, action, alive);
      }
      if (action.op === 'command') return {available: false, reason: 'native-command-ui-driver-pending'};
      if (action.op === 'sample' && action.expectedText !== undefined) {
        return until(async () => { const result = await call(action); return result.texts?.includes(action.expectedText) ? result : false; });
      }
      const result = await call(action); alive();
      if (result?.leafId) leaves.set(result.leafId, result.windowId);
      if (action.op === 'popout') {
        C.check(byWindow.size < C.LIMITS.windows, 'target-limit');
        await until(async () => {
          const pages = (await targets()).filter(t => t.type === 'page'); C.check(pages.length <= C.LIMITS.windows, 'unexpected-target');
          for (const page of pages.filter(p => p.id !== target.id)) {
            if (page.url !== 'about:blank' && !page.url.startsWith('app://obsidian.md/')) continue;
            const connection = await connect(page, port); connections.add(connection);
            try {
              const proof = await connection.evaluate(`window.${bridge}?.hello(${JSON.stringify(config.nonce)})`);
              targetProof(page, proof, {...config, windowId: result.windowId, role: 'popout'}); byWindow.set(proof.windowId, connection); return true;
            } catch { connection.close(); connections.delete(connection); }
          }
          return false;
        });
      }
      return result;
    },
    async dispose() { return call({op: 'dispose'}); },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({selectionText: process.env.ACCEPTANCE_SELECTION, planName: process.env.ACCEPTANCE_PLAN}).catch(error => { console.error(JSON.stringify({status: 'REFUSED', reason: cleanFailure(error)})); process.exitCode = 1; });
}
