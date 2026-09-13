import { StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { registeredSnapshotFixture } from './sourceRegistryTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { createInlineLivePreviewExtension } from '../src/inline/inlineLivePreview';
import * as evaluation from '../src/evaluation/evaluateNote';
import { setLivePreview } from './snapshotHostMock';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); jest.restoreAllMocks(); });

function editor(text = 'before `#: 2+3` after', presentation: Extension = []) {
 const host = registeredSnapshotFixture(text);
 const extension = createInlineLivePreviewExtension(host.registry);
 const view = new EditorView({state: EditorState.create({doc: text, extensions: [
  editorInfoField.init(() => ({app: host.app, file: host.file, editor: host.editor, hoverPopover: null})), editorLivePreviewField, extension, presentation,
 ]}), parent: host.view.containerEl});
 host.registry.reconcile();
 const change = (next: string) => {
  host.setText(next); view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: next}});
 };
 cleanups.push(() => {view.destroy(); host.destroy();});
 return {...host, cm: view, extension, change};
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
