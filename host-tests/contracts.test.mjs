import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import C from './contracts.cjs';
const bytes = fs.readFileSync(new URL('./fixtures/sources.json', import.meta.url));
const catalog = JSON.parse(bytes);

test('all 95 original synthetic sources retain their byte hashes, including CRLF and astral text', () => {
  C.catalogCheck(catalog);
  assert.match(catalog.cases.find(c => c.id === '081').text, /😀\r\n/);
  const changed = structuredClone(catalog); changed.cases[0].text += '\n';
  assert.throws(() => C.catalogCheck(changed), /hash/);
});
test('portable guards reject missing/wrong markers, wrong roots, symlinks and altered bytes', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(),'numerals-guard-'));
  t.after(() => fs.rmSync(parent,{recursive:true,force:true}));
  const root = path.join(fs.realpathSync(parent),C.VAULT_NAME); fs.mkdirSync(root);
  const config = {expectedRoot:root,nonce:'a'.repeat(64),catalogHash:C.hash(bytes)};
  fs.writeFileSync(path.join(root,'.fixture-sources.json'),bytes);
  assert.throws(() => C.guard(root,config));
  fs.writeFileSync(path.join(root,'.fixture-marker.json'),JSON.stringify({identity:C.IDENTITY,nonce:config.nonce}));
  C.guard(root,config);
  assert.throws(() => C.guard(root,{...config,expectedRoot:parent}),/path/);
  assert.throws(() => C.guard(root,{...config,nonce:'b'.repeat(64)}),/marker/);
  const fixture = catalog.cases[0]; fs.mkdirSync(path.join(root,'cases')); fs.writeFileSync(path.join(root,fixture.path),fixture.text);
  C.sourceCheck(root,fixture);
  fs.appendFileSync(path.join(root,fixture.path),' ');
  assert.throws(() => C.sourceCheck(root,fixture),/byte/);
  fs.unlinkSync(path.join(root,fixture.path)); fs.symlinkSync(path.join(root,'.fixture-sources.json'),path.join(root,fixture.path));
  assert.throws(() => C.sourceCheck(root,fixture),/symlink/);
});
function evidence() {
  const fixture = catalog.cases[0];
  const common = {id:fixture.id,path:fixture.path,sourceSha256:fixture.sha256,opened:true,settled:true};
  const controls=['reading','live-preview'].flatMap(mode=>['before','after'].map(position=>({mode,position,ok:true,events:mode === 'reading' ? [{kind:'block-handler',sourcePath:'control.md',source:'314159\n'},{kind:'inline-code',sourcePath:'control.md',text:'#:271828'}] : [{kind:'editor-tree',sourcePath:'control.md',livePreview:true,treeComplete:true,document:'```math\n314159\n```\n\n`#:271828`'}]})));
  return {status:'complete',fixtureIdentity:C.IDENTITY,host:{apiVersion:'1.13.7',platform:'linux',electron:'observed',chromium:'observed'},controls,results:[
    {...common,mode:'reading',actualMode:'preview',events:[{kind:'block-handler',sourcePath:fixture.path,source:'a=1\n',section:null}]},
    {...common,mode:'live-preview',actualMode:'source',events:[{kind:'editor-tree',sourcePath:fixture.path,livePreview:true,treeComplete:true,document:fixture.text,nodes:[]}]}
  ]};
}
test('capture validation refuses partial coverage and silent callbacks', () => {
  C.captureCheck(evidence(),catalog,['001']);
  for (const mutate of [e=>e.results.pop(),e=>e.results.push(e.results[0]),e=>e.controls.pop(),e=>e.controls[0].ok=false,e=>e.results[0].events=[],e=>e.results[0].events[0].kind='section',e=>e.status='running']) {
    const e=evidence(); mutate(e); assert.throws(()=>C.captureCheck(e,catalog,['001']));
  }
});
test('empty declarations need native render completion and controls need actual events', () => {
  const e=evidence(), fixture=catalog.cases.find(c=>c.id==='011');
  for(const r of e.results) { Object.assign(r,{id:fixture.id,path:fixture.path,sourceSha256:fixture.sha256}); for(const event of r.events) { event.sourcePath=fixture.path; if(event.document) event.document=fixture.text; } }
  e.results[0].events=[{kind:'view-open',sourcePath:fixture.path}];
  assert.throws(()=>C.captureCheck(e,catalog,['011']),/native empty/);
  e.results[0].emptyWitness={completed:true,sourceSha256:fixture.sha256,events:[{kind:'section',sourcePath:fixture.path}]};
  C.captureCheck(e,catalog,['011']);
  e.controls=e.controls.map(()=>({ok:true}));
  assert.throws(()=>C.captureCheck(e,catalog,['011']),/control/);
});
test('recorder owns deadlines and latches callback errors even when the host catches them', async () => {
  const localRequire=createRequire(import.meta.url), module={exports:{}};
  const require=name => name==='obsidian' ? {Plugin:class {}} : name.startsWith('@codemirror/') ? {} : localRequire(name);
  vm.runInNewContext(fs.readFileSync(new URL('./recorder.cjs',import.meta.url),'utf8'),{module,require,CONTRACTS:C,FIXTURE_CONFIG:{},setTimeout,clearTimeout});
  const recorder=new module.exports(); recorder.timers=new Map();
  await assert.rejects(recorder.deadline(()=>new Promise(()=>{}),10),/fixture settling deadline/);
  assert.equal(recorder.timers.size,0);
  recorder.observe(()=>{throw Error('callback limit');});
  assert.equal(recorder.asyncError.message,'callback limit');
  assert.deepEqual(C.failure(Error('/private/profile/secret'),'capture',{id:'011',mode:'reading'}),{stage:'capture',reason:'unexpected harness/host error',caseId:'011',mode:'reading'});
});
test('capture validation requires real mode, complete editor document and observed provenance', () => {
  for (const mutate of [e=>e.host.platform='darwin',e=>e.host.apiVersion='1.13.0',e=>e.results[1].events[0].treeComplete=false,e=>e.results[1].events[0].livePreview=false,e=>e.results[1].events[0].document+='x',e=>e.results[0].sourceSha256='0'.repeat(64),e=>e.results[0].events[0].sourcePath='private.md']) {
    const e=evidence(); mutate(e); assert.throws(()=>C.captureCheck(e,catalog,['001']));
  }
});
test('artifact allowlist rejects extra profile/config files', () => {
  C.outputCheck(C.OUTPUTS);
  for (const names of [[...C.OUTPUTS,'Preferences'],['capture.json'],[...C.OUTPUTS,'.obsidian/app.json']]) assert.throws(()=>C.outputCheck(names));
});
test('app child environment keeps HOME while dropping all credential variables', () => {
  const env=C.appEnvironment({HOME:'/home/runner',PATH:'/usr/bin',GITHUB_TOKEN:'secret',ACTIONS_RUNTIME_TOKEN:'secret',AWS_SECRET_ACCESS_KEY:'secret',NODE_OPTIONS:'--require=evil'},':91','/tmp/fixture');
  assert.deepEqual(env,{HOME:'/home/runner',PATH:'/usr/bin',DISPLAY:':91',TMPDIR:'/tmp/fixture',XDG_RUNTIME_DIR:'/tmp/fixture'});
});
test('controller refuses local execution before creating output or loading app dependencies', () => {
  const result=spawnSync(process.execPath,['run.mjs'],{cwd:path.dirname(new URL(import.meta.url).pathname),env:{...process.env,GITHUB_ACTIONS:'false'},encoding:'utf8'});
  assert.notEqual(result.status,0); assert.match(result.stderr,/Only a fresh GitHub-hosted Linux runner/);
});
test('launcher package lock matches the reviewed npm integrity', () => {
  const lock=JSON.parse(fs.readFileSync(new URL('./package-lock.json',import.meta.url)));
  const inputs=JSON.parse(fs.readFileSync(new URL('./inputs.json',import.meta.url)));
  const entry=lock.packages['node_modules/obsidian-launcher'];
  assert.equal(entry.version,inputs.launcher.version); assert.equal(entry.integrity,inputs.launcher.integrity);
  for (const [key,value] of Object.entries(lock.packages)) if (key) { assert.match(value.resolved,/^https:\/\/registry\.npmjs\.org\//); assert.match(value.integrity,/^sha512-/); }
});
