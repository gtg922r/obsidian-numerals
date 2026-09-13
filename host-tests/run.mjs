import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import C from './contracts.cjs';

// This controller is intentionally unavailable for local desktop execution.
C.check(process.platform === 'linux' && process.arch === 'x64' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'Only a fresh GitHub-hosted Linux runner may launch Obsidian');
const directory = path.dirname(fileURLToPath(import.meta.url));
const inputs = JSON.parse(await fs.readFile(path.join(directory,'inputs.json')));
const sourceBytes = await fs.readFile(path.join(directory,'fixtures/sources.json'));
const catalog = JSON.parse(sourceBytes); C.catalogCheck(catalog);
const ids = process.argv.includes('--smoke') ? ['001','003','011','028'] : catalog.cases.map(c => c.id);
const output = path.join(directory, 'evidence');
await fs.mkdir(output); // Refuse stale evidence from a previous run.
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'numerals-host-'));
await fs.chmod(scratch, 0o700);
let profile, socket, stage = 'prepare', app, xvfb;
let shuttingDown = false;
const children = new Set();
const diagnostics = {schema:1, stage, status:'running', childExits:[]};
const cleanEnv = C.appEnvironment(process.env, ':91', scratch);
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function launch(command,args,options={}) {
  C.check(!shuttingDown, 'owned child stopped');
  const child = spawn(command,args,{env:cleanEnv,cwd:scratch,detached:true,stdio:'ignore',...options});
  children.add(child);
  child.on('error', () => { diagnostics.childError = true; });
  child.on('exit', (code,signal) => {
    diagnostics.childExits.push({role:child === app ? 'app' : child === xvfb ? 'display' : 'extractor', code, signal});
    if (!shuttingDown && (child === app || child === xvfb)) diagnostics.unexpectedExit = true;
  });
  return child;
}
function alive() { C.check(!diagnostics.unexpectedExit && !diagnostics.childError, 'owned child stopped'); }
async function until(probe, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { alive(); const result = await probe(); if (result) return result; await sleep(200); }
  throw Error('bounded wait expired');
}
async function download(input) {
  const response = await fetch(input.url, {signal:AbortSignal.timeout(120000)});
  C.check(response.ok, 'official input download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; C.check(size <= input.size, 'oversized official input'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  C.check(size === input.size && C.hash(bytes) === input.sha256, 'official input hash/size mismatch');
  const dest = path.join(scratch,input.name); await fs.writeFile(dest,bytes); return dest;
}
async function cleanup() {
  shuttingDown = true; socket?.close();
  for (const child of children) if (child.pid) { try { process.kill(-child.pid,'SIGTERM'); } catch {} }
  await sleep(500);
  for (const child of children) if (child.pid) { try { process.kill(-child.pid,'SIGKILL'); } catch {} }
  if (profile) await fs.rm(profile,{recursive:true,force:true});
  await fs.rm(scratch,{recursive:true,force:true});
}
let provenance;
let finalization;
function finalize() {
  return finalization ??= (async () => {
    diagnostics.stage = stage;
    clearTimeout(hardDeadline);
    await cleanup();
    await fs.writeFile(path.join(output,'diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n');
    if (provenance) await fs.writeFile(path.join(output,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
    const hashes = {};
    for (const name of C.OUTPUTS.filter(n => n !== 'sha256.json')) { try { hashes[name] = C.hash(await fs.readFile(path.join(output,name))); } catch {} }
    await fs.writeFile(path.join(output,'sha256.json'),JSON.stringify(hashes,null,2)+'\n');
    if (diagnostics.status === 'complete') C.outputCheck(await fs.readdir(output));
    console.log(JSON.stringify({status:diagnostics.status,stage:diagnostics.stage,cases:ids.length,modes:2}));
  })();
}
function terminate(reason) {
  diagnostics.status = 'failed'; diagnostics.termination = reason;
  void finalize().finally(() => process.exit(1));
}
const hardDeadline = setTimeout(() => terminate('controller deadline'),480000);
process.once('SIGTERM', () => terminate('SIGTERM'));
process.once('SIGINT', () => terminate('SIGINT'));
try {
  const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim();
  C.check(/^[a-f0-9]{40}$/.test(commit) && commit === process.env.HOST_TEST_COMMIT, 'test commit identity');
  const lockBytes = await fs.readFile(path.join(directory,'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  C.check(lock.packages['node_modules/obsidian-launcher'].version === inputs.launcher.version && lock.packages['node_modules/obsidian-launcher'].integrity === inputs.launcher.integrity, 'launcher lock provenance');
  provenance = {schema:1,inputs,testCommit:commit,workflowCommit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,platform:'linux-x64',fixtureIdentity:C.IDENTITY,casesSha256:C.CASES_HASH,sourceFileSha256:C.hash(sourceBytes),lockSha256:C.hash(lockBytes),ids,modes:['reading','live-preview'],verifiedInputs:false};
  stage = 'verified-downloads';
  const installer = await download(inputs.installer), compressed = await download(inputs.app);
  const asar = gunzipSync(await fs.readFile(compressed));
  C.check(C.hash(asar) === inputs.app.uncompressedSha256, 'expanded app hash');
  provenance.verifiedInputs = true;
  const appPath = path.join(scratch,'obsidian-1.13.7.asar'); await fs.writeFile(appPath,asar);
  stage = 'extract';
  const extracted = path.join(scratch,'installer');
  const sevenZip = fileURLToPath(new URL('./7z.js',import.meta.resolve('obsidian-launcher')));
  const extraction = launch(process.execPath,[sevenZip,'x',path.relative(scratch,installer),`-o${path.relative(scratch,extracted)}`]);
  const exit = await new Promise((resolve,reject) => { extraction.once('error',reject); extraction.once('exit',resolve); });
  C.check(exit === 0, 'verified installer extraction failed');
  stage = 'synthetic-profile';
  const root = path.join(scratch,C.VAULT_NAME); await fs.mkdir(root);
  for (const fixture of catalog.cases) { const dest = path.join(root,fixture.path); await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.writeFile(dest,fixture.text); C.sourceCheck(root,fixture); }
  await fs.writeFile(path.join(root,'Other.md'),'# Embedded calculations\n\n`#:201`\n\n```math\n202\n```\n^block\n');
  await fs.writeFile(path.join(root,'target.md'),'Synthetic local link target.\n');
  await fs.writeFile(path.join(root,'control.md'),'```math\n314159\n```\n\n`#:271828`');
  const config = {expectedRoot:await fs.realpath(root),nonce:crypto.randomBytes(32).toString('hex'),catalogHash:C.hash(sourceBytes)};
  await fs.writeFile(path.join(root,'.fixture-marker.json'),JSON.stringify({identity:C.IDENTITY,nonce:config.nonce}));
  await fs.writeFile(path.join(root,'.fixture-sources.json'),sourceBytes); C.guard(root,config);
  const recorderBytes = await fs.readFile(path.join(directory,'recorder.cjs'),'utf8');
  const contractsBytes = await fs.readFile(path.join(directory,'contracts.cjs'),'utf8');
  const main = `const FIXTURE_CONFIG=${JSON.stringify(config)};\nconst CONTRACTS=(()=>{const module={exports:{}};\n${contractsBytes}\nreturn module.exports;})();\n${recorderBytes}`;
  const pluginId = 'numerals-recovery-extraction-recorder';
  const plugin = path.join(root,'.obsidian/plugins',pluginId); await fs.mkdir(plugin,{recursive:true});
  await fs.writeFile(path.join(plugin,'main.js'),main);
  await fs.writeFile(path.join(plugin,'manifest.json'),JSON.stringify({id:pluginId,name:'Synthetic extraction recorder',version:'0.0.1',minAppVersion:'1.13.0',description:'Disposable fixture callbacks only',author:'Numerals',isDesktopOnly:true}));
  await fs.writeFile(path.join(root,'.obsidian/community-plugins.json'),JSON.stringify([pluginId]));
  await fs.writeFile(path.join(root,'.obsidian/core-plugins.json'),'[]');
  await fs.writeFile(path.join(root,'.obsidian/app.json'),JSON.stringify({livePreview:true,defaultViewMode:'preview'}));
  const metadata = {metadata:{schemaVersion:'2.2.0'},versions:[{version:inputs.version,isBeta:false,minInstallerVersion:inputs.version,maxInstallerVersion:inputs.version,downloads:{},installers:{}}]};
  const metadataPath = path.join(scratch,'versions.json'); await fs.writeFile(metadataPath,JSON.stringify(metadata));
  const emptyPath = path.join(scratch,'empty.json'); await fs.writeFile(emptyPath,'[]');
  const {default:ObsidianLauncher} = await import('obsidian-launcher');
  const launcher = new ObsidianLauncher({cacheDir:path.join(scratch,'cache'),versionsUrl:pathToFileURL(metadataPath).href,communityPluginsUrl:pathToFileURL(emptyPath).href,communityThemesUrl:pathToFileURL(emptyPath).href,interactive:false});
  profile = await launcher.setupConfigDir({appVersion:inputs.version,installerVersion:inputs.version,appPath,vault:root});
  const appSettingsPath = path.join(profile,'obsidian.json');
  const appSettings = JSON.parse(await fs.readFile(appSettingsPath)); appSettings.cli = false;
  await fs.writeFile(appSettingsPath,JSON.stringify(appSettings));
  Object.assign(provenance,{recorderSourceSha256:C.hash(recorderBytes),contractsSha256:C.hash(contractsBytes),materializedRecorderSha256:C.hash(main)});
  stage = 'launch-display';
  xvfb = launch('Xvfb',[':91','-screen','0','1280x1024x24','-nolisten','tcp']);
  await until(async () => fs.access('/tmp/.X11-unix/X91').then(()=>true,()=>false),10000);
  stage = 'launch-app';
  app = launch(path.join(extracted,'obsidian'),[`--user-data-dir=${profile}`,'--no-sandbox','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--disable-gpu','--disable-dev-shm-usage']);
  const port = await until(async () => { try { const text = await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8'); const number = Number(text.split('\n')[0]); return Number.isInteger(number) && number > 0 && number < 65536 ? number : false; } catch { return false; } },60000);
  const target = await until(async () => { try { const response = await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)}); const pages = await response.json(); return pages.find(p => p.type === 'page' && p.url.startsWith('app://obsidian.md/')); } catch { return false; } },60000);
  const wsUrl = new URL(target.webSocketDebuggerUrl);
  C.check(['localhost','127.0.0.1'].includes(wsUrl.hostname) && Number(wsUrl.port) === port, 'non-loopback CDP');
  socket = new WebSocket(wsUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let serial = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
  async function evaluate(expression, timeout = 10000) {
    const id = ++serial;
    let timer;
    try {
      const response = await Promise.race([new Promise(resolve => { pending.set(id,resolve); socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})); }),new Promise((_,reject) => { timer = setTimeout(()=>reject(Error('CDP deadline')),timeout); })]);
      alive(); C.check(!response.error && !response.result.exceptionDetails, 'recorder evaluation failed');
      return response.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  stage = 'recorder-readiness';
  await until(() => evaluate('Boolean(window.__numeralsFixtureRecorder)'),60000);
  stage = 'capture';
  const result = await evaluate(`window.__numeralsFixtureRecorder.capture(${JSON.stringify(ids)})`,300000);
  const capture = JSON.parse(await fs.readFile(path.join(root,'.fixture-capture.json')));
  await fs.writeFile(path.join(output,'capture.json'),JSON.stringify(capture,null,2)+'\n');
  await fs.writeFile(path.join(output,'sources.json'),sourceBytes);
  C.check(result.status === 'complete', 'recorder did not complete');
  stage = 'validate';
  C.captureCheck(capture,catalog,ids);
  diagnostics.status = 'complete';
} catch (error) {
  diagnostics.failure = C.failure(error,stage);
  diagnostics.status = 'failed'; process.exitCode = 1;
} finally {
  await finalize();
}
