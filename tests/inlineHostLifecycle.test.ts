import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { createTestHost } from './hostTestSupport';
import { createInlineLivePreviewExtension } from '../src/inline/inlineLivePreview';
import { createDefaultSettings } from '../src/settings/normalization';
import { createResultFormatter, createNumberFormatProfile } from '../src/formatting';
import { HostEventHub } from '../src/host/events';
import type { SettingsChange } from '../src/settings/changes';

jest.mock('obsidian', () => {
	const { StateField, StateEffect } = jest.requireActual<typeof import('@codemirror/state')>('@codemirror/state');
	const mode = StateEffect.define<boolean>();
	return {
		__mode: mode,
		editorInfoField: StateField.define({ create: () => ({ file: { path: 'source.md' } }), update: value => value }),
		editorLivePreviewField: StateField.define({ create: () => false, update: (value, transaction) => {
			for (const effect of transaction.effects) if (effect.is(mode)) value = effect.value;
			return value;
		} }),
		renderMath: jest.fn(), finishRenderMath: jest.fn(), TFile: class {},
	};
});
// This fixture models Obsidian's inline-content node ranges. F owns parser/extraction QA.
// EditorView, StateFields and state-effect transitions below are real CodeMirror instances.
jest.mock('@codemirror/language', () => ({ syntaxTree: (state: EditorState) => ({
	iterate: ({ from, to, enter }: { from: number; to: number; enter: (node: { from: number; to: number }) => void }) => {
		const source = state.doc.toString();
		for (const match of source.matchAll(/`([^`]+)`/g)) {
			const start = match.index! + 1, end = start + match[1].length;
			if (start <= to && end >= from) enter({ from: start, to: end });
		}
	},
}) }));

const mode = (jest.requireMock('obsidian') as { __mode: ReturnType<typeof StateEffect.define<boolean>> }).__mode;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.textContent = ''; });

function editor(doc = 'before `#: 2+3` after') {
	const host = createTestHost(), settings = createDefaultSettings();
	let settingsListener: (change: SettingsChange) => void = () => {};
	const stopSettings = jest.fn();
	const hub = new HostEventHub(host.app, listener => { settingsListener = listener; return stopSettings; });
	const formatter = createResultFormatter({ profile: createNumberFormatProfile(settings.numberFormat) });
	const format = jest.spyOn(formatter, 'format');
	const extension = createInlineLivePreviewExtension(() => settings, () => formatter, () => [], new Map(), host.app, hub);
	const view = new EditorView({ state: EditorState.create({ doc, extensions: [editorInfoField, editorLivePreviewField, extension] }), parent: document.body });
	views.push(view);
	const changed = () => settingsListener({ generation: 1, evaluationGeneration: 1, keys: ['enableInlineNumerals'], effects: new Set(['evaluation']), settings });
	return { ...host, settings, changed, stopSettings, hub, view, format, extension };
}

it('subscribes in Source mode, stays hidden through edits, and rebuilds on an effect-only Live Preview transition', async () => {
	const current = editor();
	expect(current.cacheEvents.size).toBe(3); expect(current.vaultEvents.size).toBe(3);
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(0); expect(current.format).not.toHaveBeenCalled();
	current.view.dispatch({ changes: { from: 12, to: 13, insert: '4' } });
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); await flush();
	expect(current.format).not.toHaveBeenCalled();
	current.view.dispatch({ effects: mode.of(true) });
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(1);
	expect(current.format).toHaveBeenCalledTimes(1);
	current.view.dispatch({ effects: mode.of(false) });
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(0);
	current.settings.enableInlineNumerals = false; current.changed(); await flush();
	current.view.dispatch({ effects: mode.of(true) });
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(0);
	current.settings.enableInlineNumerals = true; current.changed(); await flush();
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(1);
});

it('defers and coalesces host dispatch, updates newly visible document spans, and cancels queued work on destroy', async () => {
	const current = editor(); current.view.dispatch({ effects: mode.of(true) });
	const dispatch = jest.spyOn(current.view, 'dispatch');
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {});
	current.cacheEvents.fire('dataview:metadata-change', 'update', { path: 'source.md' });
	expect(dispatch).not.toHaveBeenCalled(); await flush(); expect(dispatch).toHaveBeenCalledTimes(1);
	current.view.dispatch({ changes: { from: current.view.state.doc.length, insert: ' and `#: 7`' } });
	expect(current.view.plugin(current.extension)?.decorations.size).toBe(2);
	dispatch.mockClear();
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {});
	current.view.destroy(); views.splice(views.indexOf(current.view), 1); await flush();
	expect(dispatch).not.toHaveBeenCalled(); expect(current.stopSettings).toHaveBeenCalledTimes(1);
	expect(current.cacheEvents.size + current.vaultEvents.size).toBe(0);
});

it('refreshes missing references on note creation after Source-mode initialization', async () => {
	const current = editor('before `#: [[materials]].price` after');
	current.view.dispatch({ effects: mode.of(true) });
	expect(current.view.dom.querySelector('.numerals-inline-error')).not.toBeNull();
	current.files.set('materials.md', { path: 'materials.md' }); current.frontmatter.set('materials.md', { numerals: 'all', price: 12 });
	current.vaultEvents.fire('create', { path: 'materials.md' }); await flush();
	expect(current.view.dom.querySelector('.numerals-inline-error')).toBeNull();
	expect(current.view.dom.querySelector('.numerals-inline-value')?.textContent).toBe('12');
});

it('cancels a queued dispatch at plugin-hub unload before CodeMirror destroys its view', async () => {
	const current = editor(); current.view.dispatch({ effects: mode.of(true) });
	const dispatch = jest.spyOn(current.view, 'dispatch');
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); current.hub.dispose(); await flush();
	expect(dispatch).not.toHaveBeenCalled(); expect(current.view.plugin(current.extension)?.decorations.size).toBe(0);
	expect(current.cacheEvents.size + current.vaultEvents.size).toBe(0);
});
