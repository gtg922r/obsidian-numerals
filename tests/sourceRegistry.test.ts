import { registeredSnapshotFixture as fixture } from './sourceRegistryTestSupport';
import { MarkdownView, TFile, type App, type MarkdownFileInfo, type MarkdownPostProcessorContext, type WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { SourceRegistry } from '../src/host/sourceRegistry';
import { snapshotFixture, flushSnapshots } from './hostSnapshotTestSupport';
import { SurfaceSubscription } from '../src/host/surfaceSubscription';
import * as evaluation from '../src/evaluation/evaluateNote';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));


afterEach(() => jest.restoreAllMocks());

it('retains one generation across hidden/visible occurrences and CM recreation', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), host = fixture();
 const hidden = host.view.containerEl.appendChild(document.createElement('div'));
 const visible = host.view.containerEl.appendChild(document.createElement('div'));
 expect(host.registry.fromOccurrence(hidden, host.context)?.identity).toBe(host.editor);
 expect(host.registry.fromOccurrence(visible, host.context)?.identity).toBe(host.editor);
 await flushSnapshots(); const current = host.coordinator.current(host.editor);
 for (let i = 0; i < 3; i++) host.registry.reconcile();
 await flushSnapshots();
 expect(host.coordinator.current(host.editor)?.state).toBe(current?.state);
 expect(evaluate).toHaveBeenCalledTimes(1); host.destroy();
});

it('requires actual full-editor identity, same file, matching document, and owned DOM', () => {
 const host = fixture();
 const dom = host.view.containerEl.appendChild(document.createElement('div'));
 const cm = {dom, state: {doc: {toString: host.text}}} as unknown as EditorView;
 const info = {editor: host.editor, file: host.file} as MarkdownFileInfo;
 expect(host.registry.fromCodeMirror(cm, info)?.editor).toBe(host.editor);
 expect(host.registry.fromCodeMirror({...cm, state: {doc: {toString: () => 'Calc'}}} as unknown as EditorView, info)).toBeUndefined();
 expect(host.registry.fromCodeMirror(cm, {...info, editor: undefined})).toBeUndefined();
 expect(host.registry.fromCodeMirror(cm, {...info, file: Object.assign(new TFile(), {path: host.file.path})})).toBeUndefined();
 expect(host.registry.fromCodeMirror({...cm, dom: document.createElement('div')} as unknown as EditorView, info)).toBeUndefined();
 host.destroy();
});

it.each(['markdown-embed', 'internal-embed'])('same-file %s remains read-only and retires after its last consumer', async className => {
 const host = fixture(); const embed = host.view.containerEl.appendChild(document.createElement('div')); embed.className = className;
 const left = embed.appendChild(document.createElement('div')), right = embed.appendChild(document.createElement('div'));
 const render = jest.fn();
 const first = new SurfaceSubscription(host.registry, left, host.context, render, jest.fn()); first.refresh();
 const second = new SurfaceSubscription(host.registry, right, host.context, render, jest.fn()); second.refresh();
 await flushSnapshots();
 const source = host.registry.fromOccurrence(left, host.context)!;
 expect(source.editor).toBeUndefined(); expect(source.identity).not.toBe(host.editor);
 expect(host.read).toHaveBeenCalledTimes(1); expect(host.coordinator.current(source.identity)?.state.status).toBe('ready');
 first.dispose(); expect(host.coordinator.current(source.identity)).toBeDefined();
 second.dispose(); expect(host.coordinator.current(source.identity)).toBeUndefined();
 const reopened = host.registry.fromOccurrence(left, host.context)!;
 expect(reopened.identity).not.toBe(source.identity); expect(host.read).toHaveBeenCalledTimes(2);
 host.registry.retain(reopened)(); host.destroy();
});

it('a detached callback or same-path sibling cannot select an editor through its context', async () => {
 const host = fixture();
 const detached = document.createElement('div');
 const source = host.registry.fromOccurrence(detached, {...host.context, containerEl: host.view.containerEl} as MarkdownPostProcessorContext)!;
 const release = host.registry.retain(source);
 await flushSnapshots(); expect(source.editor).toBeUndefined(); expect(host.coordinator.current(source.identity)).toBeDefined();
 release(); host.destroy();
});

it('ignores a late file read after its last occurrence closes', async () => {
 const host = fixture(); let resolve!: (text: string) => void;
 host.read.mockImplementation(() => new Promise<string>(yes => {resolve = yes;}));
 const occurrence = new SurfaceSubscription(host.registry, document.createElement('div'), host.context, jest.fn(), jest.fn());
 occurrence.refresh(); occurrence.dispose(); resolve('```math\n@[x] = 3\n```'); await flushSnapshots();
 expect(host.transaction).not.toHaveBeenCalled();
 expect(host.capture).toHaveBeenCalledTimes(2); // initial fixture was retired, then the proved full editor only
 host.destroy();
});

it('file switches and real closure retire the editor while layout synchronization cannot create a fresh allowance', async () => {
 const host = fixture('```math\n@[x] = random()\n```'); await flushSnapshots();
 expect(host.transaction).toHaveBeenCalledTimes(1);
 const getData = jest.spyOn(host.view, 'getViewData').mockReturnValue('temporarily old subview');
 host.registry.reconcile(); getData.mockRestore(); host.registry.reconcile(); await flushSnapshots();
 expect(host.transaction).toHaveBeenCalledTimes(1);
 host.view.file = Object.assign(new TFile(), {path: 'other.md'}); host.registry.reconcile();
 expect(host.registry.fromEditor(host.editor)).toBeUndefined(); expect(host.coordinator.current(host.editor)).toBeUndefined();
 host.destroy();
});

it('shares existing mathematics for detached Reading/hidden-CM callbacks with exact full-owner evidence only', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), host = fixture();
 const containerEl = host.view.containerEl.appendChild(document.createElement('div'));
 const ctx = {...host.context, containerEl, getSectionInfo: () => ({text: host.text(), lineStart: 0, lineEnd: 2})} as MarkdownPostProcessorContext;
 const left = new SurfaceSubscription(host.registry, document.createElement('p'), ctx, jest.fn(), jest.fn());
 const right = new SurfaceSubscription(host.registry, document.createElement('div'), ctx, jest.fn(), jest.fn());
 left.refresh(); right.refresh(); await flushSnapshots();
 const source = host.registry.fromOccurrence(document.createElement('div'), ctx)!;
 expect(source.identity).toBe(host.editor); expect(source.editor).toBeUndefined(); expect(evaluate).toHaveBeenCalledTimes(1);
 expect(host.read).not.toHaveBeenCalled(); left.dispose(); right.dispose();
 expect(host.coordinator.current(host.editor)).toBeDefined(); host.destroy();
});

it.each(['snippet', 'foreign-container', 'same-file-embed', 'stale-buffer'])('rejects detached owner reuse with %s evidence', async reason => {
 const host = fixture(), containerEl = host.view.containerEl.appendChild(document.createElement('div'));
 const ctx = {...host.context, containerEl, getSectionInfo: () => ({text: host.text(), lineStart: 0, lineEnd: 2})} as MarkdownPostProcessorContext & {containerEl: HTMLElement};
 if (reason === 'snippet') ctx.getSectionInfo = () => ({text: '2', lineStart: 0, lineEnd: 0});
 if (reason === 'foreign-container') ctx.containerEl = document.body.appendChild(document.createElement('div'));
 if (reason === 'same-file-embed') containerEl.className = 'internal-embed';
 if (reason === 'stale-buffer') host.setText('new source not yet captured');
 const source = host.registry.fromOccurrence(document.createElement('div'), ctx)!;
 const release = host.registry.retain(source); await flushSnapshots();
 expect(source.identity).not.toBe(host.editor); expect(source.editor).toBeUndefined(); expect(host.transaction).not.toHaveBeenCalled();
 release(); if (reason === 'foreign-container') ctx.containerEl.remove(); host.destroy();
});

it('coalesces reentrant surface invalidations and cancels their queued render on disposal', async () => {
 const host = fixture(), element = host.view.containerEl.appendChild(document.createElement('div'));
 await flushSnapshots(); const revisions: string[] = [];
 let changed = false;
 const subscription = new SurfaceSubscription(host.registry, element, host.context, (_source, state) => {
  revisions.push(state?.index.source.text ?? 'missing');
  if (!changed) {changed = true; host.setText('```math\n3\n```'); host.registry.sourceChanged(host.editor, false);}
 }, jest.fn());
 subscription.refresh(); await flushSnapshots();
 expect(revisions[0]).toContain('2'); expect(revisions.at(-1)).toContain('3');
 let disposed: SurfaceSubscription;
 const render = jest.fn(() => {disposed.refresh(); disposed.dispose();});
 disposed = new SurfaceSubscription(host.registry, element, host.context, render, jest.fn());
 disposed.refresh(); await flushSnapshots(); expect(render).toHaveBeenCalledTimes(1);
 subscription.dispose(); host.destroy();
});

it('an invalidated owned occurrence waits for its editor instead of evaluating a stale disk capture', async () => {
 const host = fixture(), element = host.view.containerEl.appendChild(document.createElement('div'));
 const subscription = new SurfaceSubscription(host.registry, element, host.context, jest.fn(), jest.fn());
 subscription.refresh(); await flushSnapshots(); host.setText('```math\n3\n```'); const staleView = jest.spyOn(host.view, 'getViewData').mockReturnValue('```math\n2\n```'); host.registry.invalidateEditor(host.editor);
 expect(host.registry.fromOccurrence(element, host.context)?.identity).toBe(host.editor);
 expect(host.coordinator.current(host.editor)).toBeUndefined(); expect(host.read).not.toHaveBeenCalled();
 expect(host.registry.fromOccurrence(element, host.context)?.editor).toBeUndefined(); staleView.mockRestore();
 host.registry.sourceChanged(host.editor, false); await flushSnapshots(); expect(host.coordinator.current(host.editor)?.state.status).toBe('ready');
 subscription.dispose(); host.destroy();
});
