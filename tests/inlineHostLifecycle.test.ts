import { StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField, TFile } from 'obsidian';
import { registeredSnapshotFixture } from './sourceRegistryTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { createInlineLivePreviewExtension } from '../src/inline/inlineLivePreview';
import * as evaluation from '../src/evaluation/evaluateNote';
import { setLivePreview } from './snapshotHostMock';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); jest.restoreAllMocks(); });

function editor(text = 'before `#: 2+3` after', presentation: Extension = []) {
 text = EditorState.create({doc: text}).doc.toString(); // the public Editor exposes CM's normalized full document
 const host = registeredSnapshotFixture(text);
 const extension = createInlineLivePreviewExtension(host.registry);
 const info = {app: host.app, file: host.file, editor: host.editor, hoverPopover: null};
 const view = new EditorView({state: EditorState.create({doc: text, extensions: [
  editorInfoField.init(() => info), editorLivePreviewField, extension, presentation,
 ]}), parent: host.view.containerEl});
 host.registry.reconcile();
 const change = (next: string, anchor?: number) => {
  host.setText(next); view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: next}, ...(anchor === undefined ? {} : {selection: {anchor}})});
 };
 cleanups.push(() => {view.destroy(); host.destroy();});
 return {...host, cm: view, extension, info, change};
}

it('evaluates in Source mode and changes only projection on mode, selection and viewport updates', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), current = editor(); await flush();
 expect(evaluate).toHaveBeenCalledTimes(1); expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
 current.change('before `#: 2+4` after'); await flush(); expect(evaluate).toHaveBeenCalledTimes(2);
 current.cm.dispatch({effects: setLivePreview.of(true)}); await flush();
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1);
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('6');
 current.cm.dispatch({selection: {anchor: 10}}); expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
 current.cm.dispatch({selection: {anchor: 0}, effects: setLivePreview.of(false)});
 current.cm.dispatch({effects: setLivePreview.of(true)}); current.cm.requestMeasure(); await flush();
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1); expect(evaluate).toHaveBeenCalledTimes(2);
});

it('uses offscreen and selected predecessors for the full inline previous-result chain', async () => {
 const text = '```math\n$x = 10\n```\n\n`#: $x * 2`\n\n`#: @prev + 3`';
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), current = editor(text); await flush();
 const last = text.lastIndexOf('`#:');
 Object.defineProperty(current.cm, 'visibleRanges', {configurable: true, get: () => [{from: last, to: text.length}]});
 current.cm.dispatch({selection: {anchor: text.indexOf('`#:') + 4}, effects: setLivePreview.of(true)});
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1);
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('23');
 expect(evaluate).toHaveBeenCalledTimes(1);
});

it('combined document/visibility updates remove old globals and stale widgets', async () => {
 const current = editor('```math\n$x = 10\n```\n`#: $x`'); await flush();
 current.cm.dispatch({effects: setLivePreview.of(true)}); expect(current.cm.dom.textContent).toContain('10');
 current.change('```math\n2\n```\n`#: $x`'); await flush();
 expect(current.cm.dom.querySelector('.numerals-inline-error')?.textContent).toContain('Undefined symbol $x');
 const old = current.configuration();
 current.configure({...old, settings: {...old.settings, enableInlineNumerals: false}, evaluationSettingsGeneration: 1, settingsGeneration: 1});
 current.coordinator.settingsChanged(true); await flush(); expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
});

it('coalesces ready publications and cancels queued dispatch on registry unload', async () => {
 const current = editor(); await flush(); current.cm.dispatch({effects: setLivePreview.of(true)});
 const dispatch = jest.spyOn(current.cm, 'dispatch');
 current.coordinator.inputsChanged(); current.coordinator.inputsChanged();
 expect(dispatch).not.toHaveBeenCalled(); await flush();
 expect(dispatch).toHaveBeenCalled();
 dispatch.mockClear(); current.coordinator.inputsChanged(); current.registry.dispose(); await flush();
 expect(dispatch).not.toHaveBeenCalled(); expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
});

it('rebuilds presentation settings without mathematical evaluation', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), current = editor('`#=: 2+3`'); await flush();
 current.cm.dispatch({effects: setLivePreview.of(true), selection: {anchor: current.cm.state.doc.length}});
 current.cm.dispatch({selection: {anchor: 0}}); // the cursor guard remains authoritative at delimiters
 const before = evaluate.mock.calls.length, old = current.configuration();
 current.configure({...old, settings: {...old.settings, inlineEquationSeparator: ' equals '}, settingsGeneration: 1});
 current.coordinator.settingsChanged(false); await flush();
 expect(evaluate).toHaveBeenCalledTimes(before);
});


it('propagates inherited CM token formatting through the production adapter without more evaluation', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote');
 // Real CM StreamLanguage encodes combined token styles in its node metadata,
 // matching the pinned parser API used by Obsidian; this is presentation only.
 const language = StreamLanguage.define({
  token(stream) { stream.skipToEnd(); return 'strong em highlight strikethrough'; },
  tokenTable: {highlight: tags.special(tags.string), em: tags.emphasis},
 });
 const current = editor('before `#: 2+3` after', language); await flush();
 current.cm.dispatch({effects: setLivePreview.of(true)});
 const widget = current.cm.dom.querySelector('.numerals-inline');
 for (const name of ['cm-strong', 'cm-em', 'cm-highlight', 'cm-strikethrough']) expect(widget?.classList.contains(name)).toBe(true);
 current.cm.dispatch({selection: {anchor: 1}}); current.cm.requestMeasure(); await flush();
 expect(evaluate).toHaveBeenCalledTimes(1);
});

it.each([
 'before ``#: 2+\n3`` after',
 'before ``#$=: 2+\n3`` after',
 '> before ``#: 2+\n> 3`` after',
 '- before ``#$: 2+\n  3`` after',
 'before ``#: 2+\r\n3`` after',
])('renders and reveals a complete multiline occurrence through direct CM decorations: %s', async text => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), current = editor(text); await flush();
 expect(() => current.cm.dispatch({effects: setLivePreview.of(true)})).not.toThrow(); await flush();
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1);
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('5');
 const source = current.coordinator.current(current.editor)!, calculation = source.index.calculations[0];
 current.cm.dispatch({selection: {anchor: calculation.opener.end + 1}});
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
 expect(current.cm.contentDOM.textContent).toContain('2+');
 current.cm.dispatch({selection: {anchor: 0}}); await flush();
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('5');
 current.cm.dispatch({effects: setLivePreview.of(false)}); expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
 current.cm.dispatch({effects: setLivePreview.of(true)}); current.cm.requestMeasure(); await flush();
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1);
 expect(current.cm.state.doc.toString()).toBe(text.replace(/\r\n/g, '\n'));
 expect(evaluate).toHaveBeenCalledTimes(1); expect(current.transaction).not.toHaveBeenCalled();
});

it('prepares all indexed ranges before viewport layout while excluding selected predecessors', async () => {
 const current = editor('before ``#: 2+\n3``\n\nlast `#: @prev + 1` after'); await flush();
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), last = current.text().lastIndexOf('`#:');
 Object.defineProperty(current.cm, 'visibleRanges', {configurable: true, get: () => [{from: last, to: current.text().length}]});
 current.cm.dispatch({effects: setLivePreview.of(true)}); await flush();
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(2);
 current.cm.dispatch({selection: {anchor: current.text().indexOf('2+')}});
 expect(current.cm.plugin(current.extension)?.decorations.size).toBe(1);
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('6');
 expect(evaluate).not.toHaveBeenCalled();
});

it.each(['other.md', 'source.md'])('rebinds a reused Editor to the replacement session at %s and follows later metadata', async path => {
 const current = editor(); await flush(); current.cm.dispatch({effects: setLivePreview.of(true)});
 const oldId = current.coordinator.current(current.editor)!.sourceId;
 const captured = await current.capture.mock.results.at(-1)!.value;
 let release!: (input: typeof captured) => void;
 current.capture.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
 const next = Object.assign(new TFile(), {path}); current.files.set(path, next);
 current.view.file = next; current.setFile(next); current.info.file = next; current.registry.reconcile(); await flush();
 expect(current.coordinator.current(current.editor)?.sourceId).not.toBe(oldId);
 expect(current.cm.dom.querySelector('.numerals-inline-error')?.textContent).toContain('Updating calculation');
 release(captured); await flush(); expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('5');
 current.capture.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
 current.coordinator.inputsChanged({kind: 'metadata', path}); await flush();
 expect(current.cm.dom.querySelector('.numerals-inline-error')?.textContent).toContain('Updating calculation');
 release(captured); await flush(); expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('5');
});

it.each(['edit', 'revert', 'retarget'])('rejects an old prepared effect after %s without removing the new projection', async cause => {
 const original = 'before ``#: 2+\n3`` after', current = editor(original); await flush();
 current.cm.dispatch({effects: setLivePreview.of(true)}); await flush();
 let delayed: TransactionSpec[] = [];
 jest.spyOn(current.cm, 'dispatch').mockImplementationOnce((...specs) => {delayed = specs;});
 current.coordinator.settingsChanged(false); await flush(); expect(delayed).toHaveLength(1);
 if (cause === 'retarget') {
  const next = Object.assign(new TFile(), {path: 'source.md'}); current.files.set(next.path, next);
  current.view.file = next; current.setFile(next); current.info.file = next; current.registry.reconcile();
 } else {
  current.change(original.replace('3``', '4``'), original.indexOf('2+'));
  expect(current.cm.plugin(current.extension)?.decorations.size).toBe(0);
  if (cause === 'revert') current.change(original, 0);
  else current.cm.dispatch({selection: {anchor: 0}});
 }
 await flush(); const expected = cause === 'edit' ? '6' : '5';
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe(expected);
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'); current.cm.dispatch(...delayed);
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe(expected);
 expect(evaluate).not.toHaveBeenCalled();
});

it.each(['public-first', 'cm-first'])('keeps the independent native-input witness through %s invalidation', async order => {
 const current = editor('```math\n@[x::2] = 2\n```'); await flush();
 expect(current.transaction).not.toHaveBeenCalled();
 const offset = current.text().indexOf('= 2') + 3, before = current.text(); current.cm.dispatch({selection: {anchor: offset}});
 const attachment = current.coordinator.attachmentId(current.editor);
 current.cm.plugin(current.extension)!.observe({type: 'input', target: current.cm.contentDOM, isTrusted: true,
  defaultPrevented: false, inputType: 'insertText', data: '+1', isComposing: false} as unknown as Event);
 current.setText(before.slice(0, offset) + '+1' + before.slice(offset));
 if (order === 'public-first') {
  current.coordinator.invalidateChangedSource(current.editor);
  expect(current.coordinator.current(current.editor)).toBeUndefined();
  expect(current.coordinator.attachmentId(current.editor)).toBe(attachment);
 }
 current.cm.dispatch({changes: {from: offset, insert: '+1'}, userEvent: 'input.type'});
 if (order === 'cm-first') current.coordinator.invalidateChangedSource(current.editor);
 current.coordinator.sourceChanged(current.editor, false); await flush();
 expect(current.transaction).toHaveBeenCalledTimes(1); expect(current.text()).toContain('@[x::3]');
});

it.each(['source.md', 'other.md'])('cannot carry a trusted input into a replacement file at %s before its new snapshot is current', async path => {
 const before = '```math\n@[x::2] = 2\n```', current = editor(before); await flush();
 expect(current.transaction).not.toHaveBeenCalled();
 const offset = before.indexOf('= 2') + 3; current.cm.dispatch({selection: {anchor: offset}});
 const oldId = current.coordinator.attachmentId(current.editor);
 current.cm.plugin(current.extension)!.observe({type: 'input', target: current.cm.contentDOM, isTrusted: true,
  defaultPrevented: false, inputType: 'insertText', data: '+1', isComposing: false} as unknown as Event);
 const next = Object.assign(new TFile(), {path}); current.files.set(path, next);
 current.view.file = next; current.setFile(next); current.info.file = next; current.registry.reconcile();
 const newId = current.coordinator.attachmentId(current.editor); expect(newId).not.toBe(oldId);
 const classify = jest.spyOn(current.registry, 'sourceChanged');
 const after = before.slice(0, offset) + '+1' + before.slice(offset); current.setText(after);
 current.coordinator.invalidateChangedSource(current.editor);
 expect(current.coordinator.current(current.editor)).toBeUndefined();
 expect(current.coordinator.attachmentId(current.editor)).toBe(newId);
 current.cm.dispatch({changes: {from: offset, insert: '+1'}, userEvent: 'input.type'}); await flush();
 expect(classify.mock.calls.map(call => call[1])).toEqual([false]);
 expect(current.transaction).not.toHaveBeenCalled(); expect(current.text()).toBe(after);
});

it('drops prepared effects after disposal and never dispatches queued refresh work', async () => {
 const current = editor('before ``#: 2+\n3`` after'); await flush();
 current.cm.dispatch({effects: setLivePreview.of(true)}); await flush();
 let delayed: TransactionSpec[] = [];
 const dispatch = jest.spyOn(current.cm, 'dispatch').mockImplementationOnce((...specs) => {delayed = specs;});
 current.coordinator.settingsChanged(false); await flush(); expect(delayed).toHaveLength(1);
 dispatch.mockClear(); current.coordinator.inputsChanged(); current.registry.dispose(); await flush();
 expect(dispatch).not.toHaveBeenCalled(); current.cm.dispatch(...delayed);
 expect(current.cm.dom.querySelector('.numerals-inline')).toBeNull();
});

it('clears cached projection for a foreign editor and never projects a cell document', async () => {
 const current = editor(); await flush(); current.cm.dispatch({effects: setLivePreview.of(true)}); await flush();
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), captureCount = current.capture.mock.calls.length;
 current.info.editor = {...current.editor} as typeof current.editor; current.cm.dispatch({}); await flush();
 expect(current.cm.dom.querySelector('.numerals-inline')).toBeNull();
 current.info.editor = current.editor; current.cm.dispatch({}); await flush();
 expect(current.cm.dom.querySelector('.numerals-inline-value')?.textContent).toBe('5');
 const cell = new EditorView({parent: current.view.containerEl, state: EditorState.create({doc: '`#: 2+3`', extensions: [
  editorInfoField.init(() => current.info), editorLivePreviewField, current.extension,
 ]})});
 try {
  cell.dispatch({effects: setLivePreview.of(true), selection: {anchor: cell.state.doc.length}}); await flush();
  expect(cell.dom.querySelector('.numerals-inline')).toBeNull();
  expect(evaluate).not.toHaveBeenCalled(); expect(current.capture).toHaveBeenCalledTimes(captureCount);
 } finally {cell.destroy();}
});
