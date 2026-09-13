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
const supportBytes=fs.readFileSync(new URL("./fixtures/support-sources.json",import.meta.url));
const support=JSON.parse(supportBytes);
const captureCheck=(capture,catalog,ids)=>C.captureCheck(capture,catalog,ids,support);

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
  const config = {expectedRoot:root,nonce:'a'.repeat(64),catalogHash:C.hash(bytes),supportHash:C.hash(supportBytes)};
  fs.writeFileSync(path.join(root,'.fixture-sources.json'),bytes);
  fs.writeFileSync(path.join(root,'.fixture-support.json'),supportBytes);
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
  const supportHashes=Object.fromEntries(support.sources.map(s=>[s.path,s.sha256]));
  const common = {id:fixture.id,path:fixture.path,sourceSha256:fixture.sha256,opened:true,settled:true,supportBefore:supportHashes,supportAfter:supportHashes};
  const controls=['reading','live-preview'].flatMap(mode=>['before','after'].map(position=>({mode,position,ok:true,events:mode === 'reading' ? [{origin:'reading',requestedMode:'reading',phase:'settling',kind:'block-handler',sourcePath:'control.md',source:'314159\n'},{origin:'reading',requestedMode:'reading',phase:'settling',kind:'inline-code',sourcePath:'control.md',text:'#:271828'}] : [{kind:'editor-tree',sourcePath:'control.md',livePreview:true,treeComplete:true,document:'```math\n314159\n```\n\n`#:271828`'}]})));
  return {status:'complete',fixtureIdentity:C.IDENTITY,host:{apiVersion:'1.13.7',platform:'linux',electron:'observed',chromium:'observed'},controls,results:[
    {...common,mode:'reading',actualMode:'preview',events:[{origin:'reading',requestedMode:'reading',phase:'settling',kind:'block-handler',sourcePath:fixture.path,source:'a=1\n',section:null}]},
    {...common,mode:'live-preview',actualMode:'source',events:[{kind:'editor-tree',sourcePath:fixture.path,livePreview:true,treeComplete:true,document:fixture.text,nodes:[]}]}
  ]};
}
test('capture validation refuses partial coverage and silent callbacks', () => {
  captureCheck(evidence(),catalog,['001']);
  for (const mutate of [e=>e.results.pop(),e=>e.results.push(e.results[0]),e=>e.controls.pop(),e=>e.controls[0].ok=false,e=>e.results[0].events=[],e=>e.results[0].events[0].kind='section',e=>e.status='running']) {
    const e=evidence(); mutate(e); assert.throws(()=>captureCheck(e,catalog,['001']));
  }
});
test('empty declarations need native render completion and controls need actual events', () => {
  const e=evidence(), fixture=catalog.cases.find(c=>c.id==='011');
  for(const r of e.results) { Object.assign(r,{id:fixture.id,path:fixture.path,sourceSha256:fixture.sha256}); for(const event of r.events) { event.sourcePath=fixture.path; if(event.document) event.document=fixture.text; } }
  e.results[0].events=[{kind:'view-open',sourcePath:fixture.path}];
  assert.throws(()=>captureCheck(e,catalog,['011']),/primary Reading|native empty/);
  e.results[0].events.push({kind:'section',origin:'reading',requestedMode:'reading',phase:'settling',sourcePath:fixture.path});
  e.results[0].emptyWitness={completed:true,sourceSha256:fixture.sha256,events:[{kind:'section',sourcePath:fixture.path}]};
  captureCheck(e,catalog,['011']);
  e.controls=e.controls.map(()=>({ok:true}));
  assert.throws(()=>captureCheck(e,catalog,['011']),/control/);
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
    const e=evidence(); mutate(e); assert.throws(()=>captureCheck(e,catalog,['001']));
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
test('real first-smoke Reading events cannot be replaced by its hidden CodeMirror callback', () => {
  const recorded=JSON.parse(fs.readFileSync(new URL('./fixtures/provisional-reading-001.json',import.meta.url)));
  const e=evidence();
  // First-run tags were requested-mode only. Root's host-source review identified
  // context-3 as the direct hidden CM widget and context-4 as the preview renderer.
  const events=recorded.result.events.map(event=>({...event,requestedMode:'reading',origin:event.docId==='context-4' ? 'reading' : event.docId==='context-3' ? 'codemirror' : 'unknown',phase:event.docId==='context-3' ? 'opening' : 'settling'}));
  e.results[0].events=events;
  captureCheck(e,catalog,['001']);
  e.results[0].events=events.filter(event=>event.docId!=='context-4');
  assert.throws(()=>captureCheck(e,catalog,['001']),/primary Reading|undeclared empty/);
});
test('DOM origin gives known CodeMirror roots priority over active Reading mode', () => {
  const node={}, context={};
  const root={contains:other=>other===node||other===context};
  assert.equal(C.callbackOrigin(node,context,[root],root,null),'codemirror');
  assert.equal(C.callbackOrigin(node,context,[],root,null),'reading');
  assert.equal(C.callbackOrigin(node,context,[],null,root),'native-render-witness');
  assert.equal(C.callbackOrigin(node,context,[],null,null),'unknown');
});
test('support bytes and allowed embeds are independent of the immutable 95-case hash', t => {
  C.supportCheck(support);
  const changed=structuredClone(support);changed.sources[0].text='unexpected';
  assert.throws(()=>C.supportCheck(changed),/support/);
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'numerals-support-'));
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const root=fs.realpathSync(parent),source=support.sources[0];
  fs.writeFileSync(path.join(root,source.path),source.text);C.sourceCheck(root,source);
  fs.appendFileSync(path.join(root,source.path),'changed');assert.throws(()=>C.sourceCheck(root,source),/byte/);
  const e=evidence();e.results[0].events.push({...e.results[0].events[0],sourcePath:'Other.md'});
  assert.throws(()=>captureCheck(e,catalog,['001']),/unexpected callback source/);
  const incomplete=evidence();delete incomplete.results[0].supportAfter['Other.md'];
  assert.throws(()=>captureCheck(incomplete,catalog,['001']),/support source/);
});
test('an allowed embed cannot replace the primary note Reading callback', () => {
  const e=evidence(),fixture=catalog.cases.find(c=>c.id==='054');
  for(const r of e.results) {Object.assign(r,{id:fixture.id,path:fixture.path,sourceSha256:fixture.sha256});for(const event of r.events){event.sourcePath=fixture.path;if(event.document)event.document=fixture.text;}}
  e.results[0].events[0].sourcePath='Other.md';
  e.results[0].events.push({kind:'view-open',sourcePath:fixture.path});
  assert.throws(()=>captureCheck(e,catalog,['054']),/primary Reading/);
  e.results[0].events.push({kind:'section',sourcePath:fixture.path,origin:'reading',requestedMode:'reading',phase:'settling'});
  captureCheck(e,catalog,['054']);
});
test('observed editor normalization removes initial BOM and normalizes CR without changing disk hashes', () => {
  const fixture=catalog.cases.find(c=>c.id==='043');
  assert.equal(C.normalizedEditorText(fixture.text),'---\ntitle: "`#:99`"\n---\n`#:1`');
  assert.equal(C.hash(fixture.text),fixture.sha256);
  assert.equal(C.normalizedEditorText('a\r\nb\rc'), 'a\nb\nc');
});
test('early guard failures retain case identity and a timed-out operation cannot resume work', async () => {
  const localRequire=createRequire(import.meta.url),module={exports:{}};
  const require=name=>name==='obsidian' ? {Plugin:class {}} : name.startsWith('@codemirror/') ? {} : localRequire(name);
  vm.runInNewContext(fs.readFileSync(new URL('./recorder.cjs',import.meta.url),'utf8'),{module,require,CONTRACTS:C,FIXTURE_CONFIG:{},setTimeout,clearTimeout});
  const recorder=new module.exports();recorder.timers=new Map();recorder.guard=()=>{throw Error('fixture byte mismatch');};
  await assert.rejects(recorder.one(catalog.cases[0],'reading'),error=>{
    assert.equal(C.failure(error,recorder.phase,recorder.failureIdentity).caseId,'001');
    assert.equal(C.failure(error,recorder.phase,recorder.failureIdentity).mode,'reading');return true;
  });
  recorder.guard=()=>{};let release,resumed=false;
  const pending=new Promise(resolve=>{release=resolve;});
  recorder.captureOne=async (_fixture,_mode,operation)=>{await pending;recorder.active(operation);resumed=true;};
  const deadline=recorder.deadline.bind(recorder);recorder.deadline=operation=>deadline(operation,10);
  await assert.rejects(recorder.one(catalog.cases[0],'reading'),/deadline/);
  assert.equal(recorder.operation.active,false);release();
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(resumed,false);assert.equal(recorder.current,null);
});
