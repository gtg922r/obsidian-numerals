import { TFile } from 'obsidian';
import type { App, MarkdownPostProcessorContext, PluginManifest } from 'obsidian';
import { createTestHost, installHostDom } from './hostTestSupport';
import { HostEventHub } from '../src/host/events';
import type { SettingsChange } from '../src/settings/changes';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';
import { NumeralsScope } from '../src/numerals.types';
import { createResultFormatter, createNumberFormatProfile } from '../src/formatting';
import NumeralsPlugin from '../src/main';
import { createInlineNumeralsPostProcessor } from '../src/inline/inlinePostProcessor';
import { processAndRenderNumeralsBlockFromSource } from '../src/rendering/orchestrator';

jest.mock('../src/NumeralsSuggestor', () => ({ NumeralsSuggestor: class {} }));
jest.mock('../src/rendering/orchestrator', () => ({ processAndRenderNumeralsBlockFromSource: jest.fn() }));
jest.mock('obsidian', () => {
	class Component {
		private cleanups: (() => void)[] = [];
		register(cleanup: () => void) { this.cleanups.push(cleanup); }
		registerDomEvent(element: HTMLElement, name: string, callback: EventListener) {
			element.addEventListener(name, callback); this.register(() => element.removeEventListener(name, callback));
		}
		onunload() {}
		unload() { this.onunload(); for (const cleanup of this.cleanups.splice(0)) cleanup(); }
	}
	return {
		MarkdownRenderChild: class extends Component {},
		Plugin: class extends Component {
			constructor(readonly app: App) { super(); }
			registerMarkdownCodeBlockProcessor = jest.fn(); registerMarkdownPostProcessor = jest.fn();
			registerEditorExtension = jest.fn(); registerEditorSuggest = jest.fn(); addSettingTab = jest.fn();
			loadData = jest.fn().mockResolvedValue(undefined); saveData = jest.fn().mockResolvedValue(undefined);
		},
		PluginSettingTab: class {}, Modal: class {}, Notice: jest.fn(), MarkdownView: class {}, TFile: class {},
		loadMathJax: jest.fn().mockResolvedValue(undefined), renderMath: jest.fn(), finishRenderMath: jest.fn(),
	};
});

function context(path = 'source.md') {
	const children: { unload(): void }[] = [];
	const ctx = { sourcePath: path, getSectionInfo: () => ({ lineStart: 0 }),
		addChild: jest.fn((child: { unload(): void }) => children.push(child)) };
	return { ctx: ctx as unknown as MarkdownPostProcessorContext, children };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const renderBlock = jest.mocked(processAndRenderNumeralsBlockFromSource);

beforeAll(installHostDom);
beforeEach(() => {
	jest.clearAllMocks();
	renderBlock.mockImplementation((element, source) => {
		element.textContent = source;
		return { scope: new NumeralsScope(), referencedPaths: [], dependencies: [] };
	});
});

it('owns identical sibling blocks separately and reuses a duplicate same-element callback', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	await plugin.onload();
	const parent = document.createElement('div'), left = parent.createDiv(), right = parent.createDiv();
	const { ctx, children } = context();
	await plugin.numeralsMathBlockHandler(undefined, '1 + 2', left, ctx);
	await plugin.numeralsMathBlockHandler(undefined, '1 + 2', right, ctx);
	await plugin.numeralsMathBlockHandler(undefined, '1 + 2\n', left, ctx);
	expect(renderBlock).toHaveBeenCalledTimes(2);
	expect(parent.children).toHaveLength(2);
	expect(children).toHaveLength(2);
	expect(host.cacheEvents.size).toBe(3); expect(host.vaultEvents.size).toBe(3);
	await plugin.numeralsMathBlockHandler(undefined, '2 + 3', left, ctx);
	expect(left.textContent).toBe('2 + 3'); expect(children).toHaveLength(2);
	children[0].unload();
	host.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); await flush();
	expect(renderBlock).toHaveBeenCalledTimes(4); // only the right occurrence remains
	plugin.onunload();
	expect(host.cacheEvents.size).toBe(0); expect(host.vaultEvents.size).toBe(0);
});

it('normalizes native and DV events independently, including late DV readiness and vault topology', () => {
	const host = createTestHost(), hub = new HostEventHub(host.app), receive = jest.fn();
	const stop = hub.subscribe(receive);
	host.cacheEvents.fire('changed', { path: 'native.md' }, 'raw text', { frontmatter: {} });
	host.cacheEvents.fire('dataview:metadata-change', 'update', { path: 'dv.md' });
	host.cacheEvents.fire('dataview:api-ready');
	host.vaultEvents.fire('create', { path: 'new.md' }); host.vaultEvents.fire('delete', { path: 'deleted.md' });
	host.vaultEvents.fire('rename', { path: 'new-name.md' }, 'old-name.md');
	expect(receive.mock.calls.map(([event]) => event)).toEqual([
		{ kind: 'metadata', paths: ['native.md'] }, { kind: 'dataview', paths: ['dv.md'] }, { kind: 'ready', paths: [] },
		{ kind: 'create', paths: ['new.md'] }, { kind: 'delete', paths: ['deleted.md'] },
		{ kind: 'rename', paths: ['old-name.md', 'new-name.md'], oldPath: 'old-name.md', newPath: 'new-name.md' },
	]);
	stop(); expect(host.cacheEvents.size + host.vaultEvents.size).toBe(0);
	hub.dispose();
});

it('coalesces metadata/settings work, renders diagnostics, and cancels queued work on unload', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	await plugin.onload(); const element = document.createElement('div'), { ctx, children } = context();
	await plugin.numeralsMathBlockHandler(undefined, '1', element, ctx);
	renderBlock.mockImplementationOnce(() => { throw new Error('A useful renderer diagnostic'); });
	host.cacheEvents.fire('changed', { path: 'source.md' }, '', {});
	host.cacheEvents.fire('dataview:metadata-change', 'update', { path: 'source.md' }); await flush();
	expect(renderBlock).toHaveBeenCalledTimes(2); expect(element.textContent).toContain('A useful renderer diagnostic');
	await plugin.updateSettings({ resultSeparator: '=' }); await flush();
	expect(element.textContent).toBe('1');
	host.cacheEvents.fire('changed', { path: 'source.md' }, '', {});
	children[0].unload(); plugin.onunload(); await flush();
	expect(renderBlock).toHaveBeenCalledTimes(3);
});

it('invalidates unresolved block dependencies when a referenced note is created, deleted or renamed', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	await plugin.onload(); const element = document.createElement('div'), { ctx } = context();
	renderBlock.mockReturnValue({ scope: new NumeralsScope(), referencedPaths: [], dependencies: [{
		sourcePath: 'source.md', noteName: 'missing', propertyPath: 'price', fullMatch: '[[missing]].price', start: 0, end: 17, status: 'missing-note',
	}] });
	await plugin.numeralsMathBlockHandler(undefined, '[[missing]].price', element, ctx);
	for (const event of ['create', 'delete', 'rename']) {
		host.vaultEvents.fire(event, { path: 'missing.md' }, 'old.md'); await flush();
	}
	host.cacheEvents.fire('changed', { path: 'missing.md' }, '', {}); await flush();
	expect(renderBlock).toHaveBeenCalledTimes(5); plugin.onunload();
});

function reading() {
	const host = createTestHost(), settings = createDefaultSettings();
	let settingsListener: (event: SettingsChange) => void = () => {};
	const stopSettings = jest.fn();
	const hub = new HostEventHub(host.app, listener => { settingsListener = listener; return stopSettings; });
	const formatter = createResultFormatter({ profile: createNumberFormatProfile(settings.numberFormat) });
	const processor = createInlineNumeralsPostProcessor(host.app, () => settings, () => formatter, () => [], new Map(), hub);
	const change = () => settingsListener({ generation: 1, evaluationGeneration: 1, keys: ['enableInlineNumerals'], effects: new Set(['evaluation']), settings });
	return { ...host, settings, processor, change, hub, stopSettings };
}

it('keeps Reading inline ownership through duplicate callbacks, disable, trigger changes and unload', async () => {
	const current = reading(), paragraph = document.createElement('p'), code = paragraph.createEl('code');
	code.textContent = '#: 2+3'; const { ctx, children } = context();
	current.processor(paragraph, ctx); current.processor(paragraph, ctx);
	expect(code.textContent).toBe('5'); expect(children).toHaveLength(1);
	current.settings.enableInlineNumerals = false; current.change(); await flush();
	expect(code.textContent).toBe('#: 2+3'); expect(code.classList.contains('numerals-inline')).toBe(false);
	current.settings.enableInlineNumerals = true; current.settings.inlineResultTrigger = '!!'; current.change(); await flush();
	expect(code.textContent).toBe('#: 2+3');
	current.settings.inlineResultTrigger = '#:'; current.change(); await flush(); expect(code.textContent).toBe('5');
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); children[0].unload(); await flush();
	expect(code.textContent).toBe('#: 2+3'); expect(current.stopSettings).toHaveBeenCalledTimes(1);
	expect(current.cacheEvents.size + current.vaultEvents.size).toBe(0); current.processor.dispose(); current.hub.dispose();
});

it('repairs a missing Reading reference and updates native, Dataview and source metadata', async () => {
	const current = reading(), paragraph = document.createElement('p'), code = paragraph.createEl('code');
	code.textContent = '#: [[materials]].price * 2'; const { ctx } = context();
	current.processor(paragraph, ctx);
	expect(code.classList.contains('numerals-inline-error')).toBe(true);
	expect(code.title).toContain('materials');
	current.files.set('materials.md', { path: 'materials.md' });
	current.frontmatter.set('materials.md', { numerals: 'all', price: 10 });
	current.vaultEvents.fire('create', { path: 'materials.md' }); await flush(); expect(code.textContent).toBe('20');
	current.frontmatter.set('materials.md', { numerals: 'all', price: 15 });
	current.cacheEvents.fire('changed', { path: 'materials.md' }, 'text', {}); await flush(); expect(code.textContent).toBe('30');
	current.frontmatter.set('materials.md', { numerals: 'all', price: 20 });
	current.cacheEvents.fire('dataview:metadata-change', 'update', { path: 'materials.md' }); await flush(); expect(code.textContent).toBe('40');
	current.files.delete('materials.md'); current.vaultEvents.fire('delete', { path: 'materials.md' }); await flush();
	expect(code.classList.contains('numerals-inline-error')).toBe(true);
	current.processor.dispose(); current.hub.dispose();
});

it('keeps cold-configuration repair wired through host settings invalidation', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	jest.mocked(plugin.loadData).mockResolvedValue({ customCurrencySymbol: customCurrency('₿', 'm') });
	await plugin.onload(); const { ctx } = context(), element = document.createElement('div');
	await plugin.numeralsMathBlockHandler(undefined, '1', element, ctx);
	await plugin.updateSettings({ customCurrencySymbol: null }); await flush();
	expect(plugin.configurationError).toBeUndefined(); expect(renderBlock).toHaveBeenCalledTimes(2); plugin.onunload();
});

it('refreshes source frontmatter and a Dataview API loaded after the Reading controller', async () => {
	const current = reading(), paragraph = document.createElement('p'), code = paragraph.createEl('code');
	const file = Object.assign(new TFile(), { path: 'source.md' }); current.files.set(file.path, file);
	current.frontmatter.set(file.path, { numerals: 'all', price: 2 }); code.textContent = '#: price';
	current.processor(paragraph, context().ctx); expect(code.textContent).toBe('2');
	current.frontmatter.set(file.path, { numerals: 'all', price: 3 });
	current.cacheEvents.fire('changed', file, '', {}); await flush(); expect(code.textContent).toBe('3');
	Object.assign(current.app, { plugins: { plugins: { dataview: { api: { page: () => ({ numerals: 'all', price: 4 }) } } } } });
	current.cacheEvents.fire('dataview:api-ready'); await flush(); expect(code.textContent).toBe('4');
	current.hub.dispose(); expect(code.textContent).toBe('#: price'); expect(current.stopSettings).toHaveBeenCalledTimes(1);
});

it('reattaches a reused block element to the new context so old-context unload cannot remove it', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	await plugin.onload(); const element = document.createElement('div'), old = context('A.md'), next = context('B.md');
	renderBlock.mockImplementation((el, _source, ctx) => {
		el.textContent = ctx.sourcePath;
		return { scope: new NumeralsScope(), dependencies: [], referencedPaths: [] };
	});
	await plugin.numeralsMathBlockHandler(undefined, 'price', element, old.ctx);
	await plugin.numeralsMathBlockHandler(undefined, 'price', element, next.ctx);
	expect(element.textContent).toBe('B.md'); expect(next.children).toHaveLength(1);
	old.children[0].unload(); host.cacheEvents.fire('changed', { path: 'B.md' }, '', {}); await flush();
	expect(renderBlock).toHaveBeenCalledTimes(3); expect(element.textContent).toBe('B.md');
	plugin.onunload();
});

it('transfers a Reading code element to a new context without leaving ownership in the old child', async () => {
	const current = reading(), paragraph = document.createElement('p'), code = paragraph.createEl('code');
	const old = context('A.md'), next = context('B.md');
	for (const [path, price] of [['A.md', 2], ['B.md', 3]] as const) {
		current.files.set(path, Object.assign(new TFile(), { path })); current.frontmatter.set(path, { numerals: 'all', price });
	}
	code.textContent = '#: price'; current.processor(paragraph, old.ctx); expect(code.textContent).toBe('2');
	current.processor(paragraph, next.ctx); expect(code.textContent).toBe('3'); expect(next.children).toHaveLength(1);
	old.children[0].unload(); current.frontmatter.set('B.md', { numerals: 'all', price: 4 });
	current.cacheEvents.fire('changed', { path: 'B.md' }, '', {}); await flush(); expect(code.textContent).toBe('4');
	current.processor.dispose(); current.hub.dispose();
});

it('queues nested renames in causal order and skips subscriptions removed during delivery', async () => {
	const host = createTestHost(), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
	await plugin.onload();
	// The first direct hub subscriber emits the next rename while the first is delivered.
	const hub = new HostEventHub(host.app);
	hub.subscribe(event => { if (event.kind === 'rename' && event.oldPath === 'A.md') host.vaultEvents.fire('rename', { path: 'C.md' }, 'B.md'); });
	const paths: string[] = []; let path = 'A.md';
	hub.subscribe(event => { if (event.kind === 'rename' && path === event.oldPath) path = event.newPath; paths.push(path); });
	host.vaultEvents.fire('rename', { path: 'B.md' }, 'A.md');
	expect(paths).toEqual(['B.md', 'C.md']);
	let stopSecond = () => {}; const second = jest.fn();
	const stopFirst = hub.subscribe(() => stopSecond()); stopSecond = hub.subscribe(second);
	host.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); expect(second).not.toHaveBeenCalled();
	stopFirst(); hub.dispose(); plugin.onunload();
});

it('owns duplicate callback registrations independently without connecting duplicate host listeners', () => {
	const host = createTestHost(), hub = new HostEventHub(host.app), listener = jest.fn();
	const stopFirst = hub.subscribe(listener), stopSecond = hub.subscribe(listener);
	expect(host.cacheEvents.size).toBe(3); expect(host.vaultEvents.size).toBe(3);
	host.cacheEvents.fire('changed', { path: 'A.md' }, '', {}); expect(listener).toHaveBeenCalledTimes(2);
	stopFirst(); stopFirst(); host.cacheEvents.fire('changed', { path: 'A.md' }, '', {}); expect(listener).toHaveBeenCalledTimes(3);
	expect(host.cacheEvents.size).toBe(3); stopSecond(); expect(host.cacheEvents.size + host.vaultEvents.size).toBe(0);
	hub.dispose();
});

it.each([true, false])('preserves unrelated inline DOM with enabled=%s through callbacks, invalidation and unload', async enabled => {
	const current = reading(); current.settings.enableInlineNumerals = enabled;
	const paragraph = document.createElement('p'), code = paragraph.createEl('code'), highlight = code.createSpan({ cls: 'other-plugin-highlight', text: 'ordinary()' });
	const original = code.outerHTML, { ctx } = context();
	current.processor(paragraph, ctx); current.processor(paragraph, ctx);
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); await flush();
	expect(code.outerHTML).toBe(original); expect(code.firstChild).toBe(highlight);
	current.processor.dispose(); current.hub.dispose(); expect(code.outerHTML).toBe(original); expect(code.firstChild).toBe(highlight);
});

it('recognizes host-replaced inline source on an existing element without treating its own output as source', async () => {
	const current = reading(), paragraph = document.createElement('p'), code = paragraph.createEl('code'), { ctx, children } = context();
	code.textContent = '#: 2+3'; current.processor(paragraph, ctx); expect(code.textContent).toBe('5');
	const rendered = code.firstChild; current.processor(paragraph, ctx); expect(code.firstChild).toBe(rendered);
	code.textContent = '#: 7+8'; current.processor(paragraph, ctx); expect(code.textContent).toBe('15'); expect(children).toHaveLength(1);
	current.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); await flush(); expect(code.textContent).toBe('15');
	code.textContent = 'ordinary()'; current.processor(paragraph, ctx); expect(code.textContent).toBe('ordinary()'); expect(code.classList.contains('numerals-inline')).toBe(false);
	current.processor.dispose(); current.hub.dispose(); expect(code.textContent).toBe('ordinary()');
});
