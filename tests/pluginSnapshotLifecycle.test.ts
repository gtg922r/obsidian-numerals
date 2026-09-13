import { MarkdownView, TFile, type Editor, type MarkdownPostProcessorContext, type PluginManifest, type WorkspaceLeaf, type Command } from 'obsidian';
import NumeralsPlugin from '../src/main';
import { createTestHost, installHostDom } from './hostTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { sourceLineAt, sourceLineStarts } from '../src/evaluation/sourceIndex';
import * as evaluation from '../src/evaluation/evaluateNote';
import { NumeralsRenderStyle, NumeralsNumberFormat } from '../src/numerals.types';
import type { InlinePostProcessor } from '../src/inline/inlinePostProcessor';
import { customCurrency } from '../src/settings/normalization';

jest.mock('../src/NumeralsSuggestor', () => ({NumeralsSuggestor: class {}}));
jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
beforeAll(installHostDom);
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); jest.restoreAllMocks(); });

async function fixture(initial: string, saved?: unknown, targetSources: Record<string, string> = {}) {
 const host = createTestHost(), file = Object.assign(new TFile(), {path: 'source.md'});
 host.files.set(file.path, file); let text = initial;
 const buffers = new Map([[file.path, initial]]), read = jest.fn(async (target: TFile) => buffers.get(target.path) ?? '');
 for (const [path, source] of Object.entries(targetSources)) {
  host.files.set(path, Object.assign(new TFile(), {path})); buffers.set(path, source);
 }
 Object.assign(host.app.vault, {read});
 const transaction = jest.fn((input: {changes: {from: {line: number; ch: number}; to: {line: number; ch: number}; text: string}[]}) => {
  const starts = sourceLineStarts(text);
  for (const change of input.changes.slice().reverse()) text = text.slice(0, starts[change.from.line] + change.from.ch) + change.text + text.slice(starts[change.to.line] + change.to.ch);
  host.workspaceEvents.fire('editor-change', editor);
 });
 const editor = {getValue: () => text, transaction, focus: jest.fn(), setCursor: jest.fn(), offsetToPos: (offset: number) => {
  const starts = sourceLineStarts(text), line = sourceLineAt(starts, offset); return {line, ch: offset - starts[line]};
 }} as unknown as Editor;
 const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {file, editor}); document.body.append(view.containerEl);
 jest.mocked(host.app.workspace.iterateAllLeaves).mockImplementation(callback => callback({view} as unknown as WorkspaceLeaf));
 const plugin = new NumeralsPlugin(host.app, {} as PluginManifest); jest.mocked(plugin.loadData).mockResolvedValue(saved);
 await plugin.onload();
 const processor = jest.mocked(plugin.registerMarkdownPostProcessor).mock.calls[0][0] as InlinePostProcessor;
 const children: {unload(): void}[] = [];
 const context = (first: number, last = first) => ({sourcePath: file.path, docId: 'fixture-native', frontmatter: undefined,
  getSectionInfo: () => ({text, lineStart: first, lineEnd: last}), addChild: (child: {unload(): void}) => {children.push(child);}} as MarkdownPostProcessorContext);
 const setText = (next: string) => {text = next; host.workspaceEvents.fire('editor-change', editor);};
 cleanups.push(() => {plugin.unload(); view.containerEl.remove();});
 return {...host, file, buffers, read, editor, view, plugin, processor, context, children, transaction, setText, text: () => text};
}

it('shares one complete generation across repeated block callbacks and independently owned siblings', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote');
 const host = await fixture('```math\n$x = 3\n```\n\n```math\n$x * 2\n```\n\n```math\n$x * 2\n```');
 const left = host.view.containerEl.createDiv(), right = host.view.containerEl.createDiv();
 const a = host.context(4, 6), b = host.context(8, 10);
 await host.plugin.numeralsMathBlockHandler(NumeralsRenderStyle.Plain, '$x * 2', left, a);
 await host.plugin.numeralsMathBlockHandler(NumeralsRenderStyle.Plain, '$x * 2', right, b);
 await host.plugin.numeralsMathBlockHandler(NumeralsRenderStyle.Plain, '$x * 2\n', left, a); await flush();
 expect(left.textContent).toContain('6'); expect(right.textContent).toContain('6');
 expect(host.children).toHaveLength(2); expect(evaluate).toHaveBeenCalledTimes(1);
 const next = {...a}; await host.plugin.numeralsMathBlockHandler(NumeralsRenderStyle.Plain, '$x * 2', left, next);
 host.children[0].unload(); host.cacheEvents.fire('changed', host.file, host.text(), {}); await flush();
 expect(left.textContent).toContain('6'); expect(host.children).toHaveLength(3);
 host.plugin.unload(); expect(host.cacheEvents.size + host.vaultEvents.size + host.workspaceEvents.size).toBe(0);
});

it('repairs missing references and follows fresh native source through create, modify and delete', async () => {
 const host = await fixture('`#: [[Target]].price * 2`'), paragraph = host.view.containerEl.createEl('p');
 const code = paragraph.createEl('code', {text: '#: [[Target]].price * 2'});
 host.processor(paragraph, host.context(0)); await flush(); expect(code.textContent).toContain('not found');
 const target = Object.assign(new TFile(), {path: 'Target.md'}); host.files.set(target.path, target);
 host.buffers.set(target.path, '---\nnumerals: all\nprice: 10\n---'); host.vaultEvents.fire('create', target); await flush(); expect(code.textContent).toBe('20');
 host.buffers.set(target.path, '---\nnumerals: all\nprice: 15\n---'); host.frontmatter.set(target.path, {numerals: 'all', price: 999});
 host.cacheEvents.fire('changed', target, '', {}); await flush(); expect(code.textContent).toBe('30');
 host.buffers.set(target.path, '---\nnumerals: all\nprice: 20\n---'); host.cacheEvents.fire('dataview:metadata-change', 'update', target);
 await flush(); expect(code.textContent).toBe('40'); host.files.delete(target.path); host.vaultEvents.fire('delete', target);
 await flush(); expect(code.textContent).toContain('not found');
});

it('subscribes to late Dataview readiness and preserves native source authority', async () => {
 const host = await fixture('---\nnumerals: all\nprice: 2\n---\n`#: price + cost`'), paragraph = host.view.containerEl.createEl('p');
 const code = paragraph.createEl('code', {text: '#: price + cost'}); host.processor(paragraph, host.context(4)); await flush();
 expect(code.textContent).toContain('Undefined symbol cost');
 Object.assign(host.app, {plugins: {plugins: {dataview: {api: {page: () => ({price: 99, cost: 4, file: {frontmatter: {numerals: 'all', price: 99}}})}}}}});
 host.cacheEvents.fire('dataview:api-ready'); await flush(); expect(code.textContent).toBe('6');
 host.setText(host.text().replace('price: 2', 'price: 3')); expect(code.textContent).not.toBe('6');
 await flush(); expect(code.textContent).toBe('7');
});

it('keeps a cold configuration error visible until settings repair', async () => {
 const host = await fixture('```math\n1 + 2\n```', {customCurrencySymbol: customCurrency('₿', 'm')});
 const element = host.view.containerEl.createDiv(); await host.plugin.numeralsMathBlockHandler(NumeralsRenderStyle.Plain, '1 + 2', element, host.context(0, 2));
 await flush(); expect(element.textContent).toContain('Numerals settings');
 await host.plugin.updateSettings({customCurrencySymbol: null}); await flush();
 expect(element.querySelector('.numerals-result')?.textContent).toContain('3'); expect(host.plugin.configurationError).toBeUndefined();
});

it('the stored-result command checks only the supplied current editor and executes once without future permission', async () => {
 const host = await fixture('```math\n@[x] = random()\n```'); await flush(); expect(host.transaction).toHaveBeenCalledTimes(1);
 const command = jest.mocked(host.plugin.addCommand).mock.calls.map(([entry]) => entry).find(entry => entry.id === 'update-stored-results') as Command;
 const check = command.editorCheckCallback!; const before = host.plugin.getEditorSnapshot(host.editor)?.state;
 for (let count = 0; count < 3; count++) expect(check(true, host.editor, host.view)).toBe(true);
 expect(host.plugin.getEditorSnapshot(host.editor)?.state).toBe(before); expect(host.transaction).toHaveBeenCalledTimes(1);
 expect(check(true, {...host.editor} as Editor, host.view)).toBe(false);
 expect(check(false, host.editor, host.view)).toBe(true); await flush(); expect(host.transaction).toHaveBeenCalledTimes(2);
 host.cacheEvents.fire('changed', host.file, '', {}); await flush(); expect(host.transaction).toHaveBeenCalledTimes(2);
});

it('keeps inline currency expressions and owned TeX preparation on the retained private runtime', async () => {
 const host = await fixture('---\nnumerals: all\n$pizza: $2\n---\n`#: $36.03 + $2*3 + $pizza` `#$=: $2 * 3`');
 const paragraph = host.view.containerEl.createEl('p'), plain = paragraph.createEl('code', {text: '#: $36.03 + $2*3 + $pizza'});
 const tex = paragraph.createEl('code', {text: '#$=: $2 * 3'}); host.processor(paragraph, host.context(4)); await flush();
 expect(plain.textContent).toContain('44.03'); expect(tex.querySelector('.numerals-inline-input .numerals-tex')).not.toBeNull();
 expect(tex.querySelector('.numerals-inline-value .numerals-tex')?.textContent).toContain('6');
});

it.each(['matching', 'unavailable', 'missing'])('a ready %s result cannot spend its old input allowance after reference repair', async initial => {
 const text = '```math\n@[x::2] = [[Target]].price\n```';
 const host = await fixture(text, undefined, initial === 'missing' ? {} : {
  'Target.md': initial === 'matching' ? '---\nnumerals: all\nprice: 2\n---' : '---\nprice: 2\n---',
 });
 await flush(); expect(host.transaction).not.toHaveBeenCalled();
 expect(host.plugin.getEditorSnapshot(host.editor)?.insertionExhausted).toBe(true);
 const target = host.files.get('Target.md') ?? Object.assign(new TFile(), {path: 'Target.md'});
 host.files.set(target.path, target); host.buffers.set(target.path, '---\nnumerals: all\nprice: 3\n---');
 if (initial === 'missing') host.vaultEvents.fire('create', target);
 else host.cacheEvents.fire('changed', target, '', {});
 await flush(); expect(host.text()).toBe(text); expect(host.transaction).not.toHaveBeenCalled();
 const state = host.plugin.getEditorSnapshot(host.editor)?.state;
 if (state?.status !== 'ready') throw new Error('Expected repaired snapshot');
 expect(state.snapshot.format(state.snapshot.calculations[0].calculationId, 0)).toMatchObject({value: {canonical: '3'}});
 const command = jest.mocked(host.plugin.addCommand).mock.calls.map(([entry]) => entry).find(entry => entry.id === 'update-stored-results')!;
 expect(command.editorCheckCallback!(true, host.editor, host.view)).toBe(true);
 expect(host.transaction).not.toHaveBeenCalled();
 expect(command.editorCheckCallback!(false, host.editor, host.view)).toBe(true); await flush();
 expect(host.transaction).toHaveBeenCalledTimes(1); expect(host.text()).toContain('@[x::3]');
 host.buffers.set(target.path, '---\nnumerals: all\nprice: 4\n---'); host.cacheEvents.fire('changed', target, '', {});
 await flush(); expect(host.transaction).toHaveBeenCalledTimes(1);
});

it('a matching stored value stays unchanged when presentation formatting changes', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote');
 const host = await fixture('```math\n@[x::1.235] = 1.23456\n```'); await flush();
 expect(host.transaction).not.toHaveBeenCalled(); const before = evaluate.mock.calls.length;
 await host.plugin.updateSettings({numberFormat: NumeralsNumberFormat.Fixed}); await flush();
 expect(evaluate).toHaveBeenCalledTimes(before); expect(host.transaction).not.toHaveBeenCalled();
 const state = host.plugin.getEditorSnapshot(host.editor)?.state;
 if (state?.status !== 'ready') throw new Error('Expected formatted snapshot');
 expect(state.snapshot.format(state.snapshot.calculations[0].calculationId, 0)).toMatchObject({value: {canonical: '1.23456'}});
 expect(host.text()).toContain('@[x::1.235]');
});
