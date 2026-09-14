import fs from 'node:fs';
import C from '../contracts.cjs';
import {Journal, Ownership} from '../observer-core.cjs';
export const catalog = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url)));
export function owner() {
  const journal = new Journal(), ownership = new Ownership(journal), win = {closed: false}, document = {defaultView: win}; win.document = document;
  const file = {path: 'acceptance/ordering.md'}, editor = {text: '1+2', getValue() { return this.text; }, transaction(tx) { this.text = tx.text; }};
  const view = {file, editor, containerEl: {isConnected: true, ownerDocument: document, contains: () => true}};
  ownership.addWindow(win, {document}); ownership.addEditor(editor, {view, file, window: win});
  return {journal, ownership, win, document, file, view, editor};
}
export function selection() {
  return {schema: 2, repository: 'gtg922r/obsidian-numerals', integrationCommit: 'a'.repeat(40), integrationTree: 'b'.repeat(40), harnessCommit: 'c'.repeat(40),
    runId: 1, runAttempt: 2, artifactId: 3, artifactZipSha256: 'd'.repeat(64), catalogSha256: 'e'.repeat(64), inputsSha256: 'f'.repeat(64), helperSha256: '1'.repeat(64), controlSha256: '3'.repeat(64), planSha256: '2'.repeat(64),
    branch: 'chore/recovery-1.11', event: 'push', workflowPath: '.github/workflows/ci.yml', mode: 'instrumented', integration: 'none',
    files: Object.fromEntries(C.FILES.map(name => [name, {size: 3, sha256: C.hash(name.slice(0, 3))}])), manifest: {id: 'numerals', version: '1.11.0', minAppVersion: '1.13.0'}};
}
export function receipt(s) { return {run: {id: s.runId, run_attempt: s.runAttempt, event: s.event, head_sha: s.integrationCommit, head_branch: s.branch, status: 'completed', conclusion: 'success', path: s.workflowPath, repository: {full_name: s.repository}, head_repository: {full_name: s.repository}}, artifact: {id: s.artifactId, name: `numerals-acceptance-${s.integrationCommit}`, expired: false, workflow_run: {id: s.runId, head_sha: s.integrationCommit, head_branch: s.branch}}, commit: {sha: s.integrationCommit, tree: {sha: s.integrationTree}}}; }
export function plan() { return {schema: 1, cases: [{id: 'ORD-01', path: 'acceptance/ordering.md', actions: [{op: 'open', path: 'acceptance/ordering.md'}, {op: 'sample'}], assertions: [{kind: 'observed-dom-text', text: '14'}]}]}; }

export function paneHost() {
  const win = {closed: false}, document = {defaultView: win}; win.document = document;
  const files = new Map(['a', 'b', 'c'].map(name => [`acceptance/${name}.md`, {path: `acceptance/${name}.md`}]));
  const leaves = []; let active;
  function makeLeaf() {
    const editor = {getValue: () => '', transaction() {}}, view = {editor, containerEl: {ownerDocument: document, isConnected: true}};
    const leaf = {view, async setViewState(value) { view.file = files.get(value.state.file); active = leaf; }};
    leaves.push(leaf); return leaf;
  }
  const app = {plugins: {getPlugin: () => null}, vault: {adapter: {getBasePath: () => '/fixture'}, getAbstractFileByPath: key => files.get(key)}, workspace: {
    iterateAllLeaves(fn) { leaves.forEach(fn); }, getLeaf(kind) { return kind === 'split' || !active ? makeLeaf() : active; },
  }}; win.app = app;
  return {win, document, app, leaves, files, makeLeaf};
}

export const paneInvalidations = {
  unexpectedFile(h, leaf) { leaf.view.file = {path: 'unexpected.md'}; },
  replacedAllowedFile(h, leaf) { leaf.view.file = {path: 'acceptance/a.md'}; },
  replacedVaultFile(h) { h.files.set('acceptance/a.md', {path: 'acceptance/a.md'}); },
  disconnected(h, leaf) { leaf.view.containerEl.isConnected = false; },
  differentDocument(h, leaf) { leaf.view.containerEl.ownerDocument = {}; },
  replacedEditor(h, leaf) { leaf.view.editor = {...leaf.view.editor}; },
  replacedView(h, leaf) { leaf.view = {...leaf.view}; },
};
export const existingPaneActions = ['focus', 'select', 'scroll', 'mode', 'sample', 'dataview', 'close', 'current-owner', 'current-read', 'reveal'];
export function spyPaneActions(h, leaf) {
  const calls = [], record = name => () => { calls.push(name); };
  h.app.workspace.setActiveLeaf = record('activate');
  Object.assign(leaf.view.editor, {focus: record('focus'), setSelection: record('select'), scrollIntoView: record('scroll'), offsetToPos: () => ({line: 0, ch: 0})});
  leaf.setViewState = record('mode'); leaf.detach = record('close'); leaf.view.containerEl.querySelectorAll = () => { calls.push('sample'); return []; };
  h.app.plugins.getPlugin = () => ({api: {page: record('dataview')}});
  return calls;
}
