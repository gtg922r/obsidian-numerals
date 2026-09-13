import type { App, EditorSuggestContext } from 'obsidian';
import { NumeralsSuggestor, type NumeralsSuggestion } from '../src/NumeralsSuggestor';
import { suggestorFixture } from './suggestorTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import * as evaluation from '../src/evaluation/evaluateNote';
import { installHostDom } from './hostTestSupport';

jest.mock('obsidian', () => ({...jest.requireActual('./snapshotHostMock'), setIcon: jest.fn(),
 EditorSuggest: class {
  context: EditorSuggestContext | null = null;
  constructor(readonly app: App) {}
  close() {this.context = null;}
 },
}));
beforeAll(installHostDom);
const cleanups: (() => void)[] = [];
afterEach(() => {for (const cleanup of cleanups.splice(0)) cleanup(); jest.restoreAllMocks();});
async function fixture(source: string, saved: Record<string, unknown> = {}) {const host = await suggestorFixture(source, {suggestionsIncludeMathjsSymbols: true, ...saved}); cleanups.push(host.dispose); return host;}
const select = (suggestor: NumeralsSuggestor, item: NumeralsSuggestion) => suggestor.selectSuggestion(item, new KeyboardEvent('keydown', {key: 'Enter'}));
const texts = (items: readonly NumeralsSuggestion[]) => items.map(item => item.text);

it('registers once even with block suggestions disabled and gates independent toggles without restarting', async () => {
 const source = '```math\nsq\n```\n`#: sq`', host = await fixture(source, {provideSuggestions: false});
 const block = source.indexOf('sq') + 2, inline = source.lastIndexOf('sq') + 2;
 expect(host.plugin.registerEditorSuggest).toHaveBeenCalledTimes(1);
 expect(host.suggestor).toBeInstanceOf(NumeralsSuggestor);
 expect(host.trigger(host.first, block)).toBeNull(); expect(texts(await host.suggestions(host.first, inline))).toContain('sqrt()');
 for (let i = 0; i < 3; i++) {
  await host.plugin.updateSettings({provideSuggestions: true, provideInlineSuggestions: false}); await flush();
  expect(texts(await host.suggestions(host.first, block))).toContain('sqrt()'); expect(host.trigger(host.first, inline)).toBeNull();
  await host.plugin.updateSettings({provideSuggestions: false, provideInlineSuggestions: true}); await flush();
  expect(host.trigger(host.first, block)).toBeNull(); expect(texts(await host.suggestions(host.first, inline))).toContain('sqrt()');
 }
 await host.plugin.updateSettings({enableInlineNumerals: false}); await flush();
 expect(host.trigger(host.first, inline)).toBeNull(); expect(host.plugin.registerEditorSuggest).toHaveBeenCalledTimes(1);
 const another = await fixture(source, {provideSuggestions: false}); expect(another.plugin.registerEditorSuggest).toHaveBeenCalledTimes(1);
 expect(another.suggestor).not.toBe(host.suggestor);
});

it.each([
 '```math\nsq¦\n```', '```Math\nsq¦\n```', '```math-plain\nsq¦\n```', '```math-tex\nsq¦\n```', '```math-TeX\nsq¦\n```', '```math-highlight\nsq¦\n```',
 '~~~~math\nsq¦\n~~~~', '`````math\nsq¦\n`````', '```js\nordinary\n```\n```math\nsq¦\n```',
 '- ```math\n  sq¦\n  ```', '> [!note]\n> ```math\n> sq¦\n> ```',
 'before `#: sq¦` after', 'before ``#: sq¦`` after', 'before ```#: sq¦``` after',
 'before ``#: 1 + ` + sq¦`` after', 'before ``#: 1+\nsq¦`` after', '> before ``#: 1+\n> sq¦`` after',
 '- before ``#: 1+\n  sq¦`` after', '😀 before `#: sq¦` after', 'before `#: sq¦', 'before ``#: sq¦',
 'before ``#: 1+\r\nsq¦`` after', '> ```math\r\n> sq¦\r\n> ```',
])('completes only the copied token and preserves every delimiter/container byte: %s', async marked => {
 const at = marked.indexOf('¦'), source = marked.replace('¦', ''), host = await fixture(source);
 const beforeCalls = jest.spyOn(evaluation, 'evaluateNote');
 const items = await host.suggestions(host.first, at), item = items.find(item => item.text === 'sqrt()');
 expect(item).toBeDefined(); expect(beforeCalls).not.toHaveBeenCalled(); select(host.suggestor, item!);
 expect(host.text()).toBe(source.slice(0, at - 2) + 'sqrt()' + source.slice(at));
 expect(host.replaceRange).toHaveBeenCalledTimes(1);
 expect(host.editor.posToOffset(host.editor.getCursor())).toBe(at - 2 + 5);
 expect(host.editor.transaction).not.toHaveBeenCalled(); await flush(); expect(beforeCalls).toHaveBeenCalledTimes(1);
});

it.each([
 'prose sq¦', '`ordinary sq¦`', '```js\nsq¦\n```', '%% `#: sq¦` %%', '<!-- `#: sq¦` -->',
 '`#: sq`¦', '``#: sq``¦', '```math\n# sq¦\n```', '```math\n"sq¦"\n```',
])('excludes non-calculation contexts: %s', async marked => {
 const at = marked.indexOf('¦'), host = await fixture(marked.replace('¦', ''));
 expect(host.trigger(host.first, at)).toBeNull(); expect(host.replaceRange).not.toHaveBeenCalled();
});

it('keeps longest triggers, empty disabled triggers, Greek and context-appropriate directives', async () => {
 const host = await fixture('`!!sq`', {inlineResultTrigger: '!', inlineEquationTrigger: '!!'});
 expect(texts(await host.suggestions(host.first, 5))).toContain('sqrt()');
 await host.plugin.updateSettings({inlineResultTrigger: '', inlineEquationTrigger: ''}); await flush();
 expect(host.trigger(host.first, 5)).toBeNull();
 host.setText('`#: @p`'); await host.plugin.updateSettings({inlineResultTrigger: '#:'}); await flush();
 expect(texts(await host.suggestions(host.first, 6))).toEqual(['@prev']);
 host.setText('`#: @s`'); await flush(); expect(texts(await host.suggestions(host.first, 6))).toEqual([]);
 host.setText('`#: :alp`'); await flush(); expect(texts(await host.suggestions(host.first, 8))).toContain('α');
 await host.plugin.updateSettings({enableGreekAutoComplete: false}); await flush(); expect(await host.suggestions(host.first, 8)).toEqual([]);
});

it.each(['source-edit', 'equal-text-reversion', 'cursor', 'selection', 'settings', 'same-path-replacement', 'different-path-replacement', 'close', 'unload'])('rejects an old completion after %s', async cause => {
 const source = '`#: sq`', host = await fixture(source), items = await host.suggestions(host.first, 6), item = items.find(item => item.text === 'sqrt()')!;
 expect(item).toBeDefined();
 if (cause === 'source-edit') host.setText(source + ' changed');
 if (cause === 'equal-text-reversion') {host.setText(source + ' changed'); host.setText(source);}
 if (cause === 'cursor') host.cursor(0);
 if (cause === 'selection') host.cursor(4, 6);
 if (cause === 'settings') await host.plugin.updateSettings({suggestionsIncludeMathjsSymbols: false});
 if (cause === 'same-path-replacement') host.retarget('source.md');
 if (cause === 'different-path-replacement') host.retarget('other.md');
 if (cause === 'close') host.suggestor.close();
 if (cause === 'unload') host.plugin.unload();
 select(host.suggestor, item); expect(host.replaceRange).not.toHaveBeenCalled();
});

it('does not associate a delayed request or selected item with a newer note/query', async () => {
 const host = await fixture('```math\napple = 1\na\n```', {suggestionsIncludeMathjsSymbols: false});
 const a = host.trigger(host.first, host.text().lastIndexOf('a\n') + 1)!;
 const old = (await host.suggestor.getSuggestions(a)).find(item => item.text === 'apple')!;
 const next = host.addEditor('```math\nbanana = 1\nb\n```', 'other.md'); host.workspaceEvents.fire('layout-change'); await flush();
 const b = host.trigger(next, next.text().lastIndexOf('b\n') + 1)!;
 expect(texts(await host.suggestor.getSuggestions(b))).toEqual(['banana']);
 expect(await host.suggestor.getSuggestions(a)).toEqual([]);
 select(host.suggestor, old); expect(host.replaceRange).not.toHaveBeenCalled(); expect(next.replaceRange).not.toHaveBeenCalled();
});

it('uses successful preceding globals/current locals across blocks and inline spans without retaining old names', async () => {
 const source = '```math\n$apple = 1\nordinary = 2\n1 +\n$bad = 3\n```\n```math\n$a\n```\n`#: ord`\n`#: $b`';
 const host = await fixture(source, {suggestionsIncludeMathjsSymbols: false});
 expect(texts(await host.suggestions(host.first, source.indexOf('$a\n') + 2))).toEqual(['$apple']);
 expect(texts(await host.suggestions(host.first, source.indexOf('ord`') + 3))).toEqual([]);
 expect(texts(await host.suggestions(host.first, source.indexOf('$b`') + 2))).toEqual([]);
 host.setText(source.replace('$apple = 1', '2')); await flush();
 expect(texts(await host.suggestions(host.first, host.text().indexOf('$a\n') + 2))).toEqual([]);
});

it('gets ordinary seed names for unfinished spans without resurrecting original dollar seeds or evaluating suggestions', async () => {
 const source = '---\nnumerals: all\nordinary: 7\n$seed: 2\n---\n```math\n$seed = 9\n```\n`#: ord';
 const host = await fixture(source, {suggestionsIncludeMathjsSymbols: false}), evaluate = jest.spyOn(evaluation, 'evaluateNote');
 expect(texts(await host.suggestions())).toEqual(['ordinary']); expect(evaluate).not.toHaveBeenCalled();
 const state = host.plugin.getEditorSnapshot(host.editor)!.state;
 if (state.status !== 'ready') throw new Error('Expected ready');
 expect(state.snapshot.symbolsAt(source.length).find(symbol => symbol.name === '$seed')?.value).toBe(9);
});

it('withholds dynamic symbols while pending and invalidates old results on metadata publication', async () => {
 const host = await fixture('---\nnumerals: all\nseed: 2\n---\n`#: se`', {suggestionsIncludeMathjsSymbols: false});
 const at = host.text().lastIndexOf('se`') + 2;
 const old = (await host.suggestions(host.first, at))[0]; expect(old.text).toBe('seed');
 host.cacheEvents.fire('changed', host.file, '', {});
 const context = host.trigger(host.first, at)!; expect(await host.suggestor.getSuggestions(context)).toEqual([]);
 await flush(); select(host.suggestor, old); expect(host.replaceRange).not.toHaveBeenCalled();
});

it('cross-note property lookup is origin-bound, synchronous, opt-in filtered and never evaluates values', async () => {
 const host = await fixture('`#: [[Target]].`');
 const target = host.addEditor('ordinary', 'Target.md').file;
 host.frontmatter.set(target.path, {numerals: ['price'], price: 'createUnit("suggestorShouldNotRun", "1 m")', hidden: 3, $allowed: 4});
 const evaluate = jest.spyOn(evaluation, 'evaluateNote');
 const context = host.trigger(host.first, host.text().length - 1)!;
 const items = await host.suggestor.getSuggestions(context);
 expect(texts(items)).toEqual(['$allowed', 'price']); expect(evaluate).not.toHaveBeenCalled();
 const price = items.find(item => item.text === 'price')!; select(host.suggestor, price);
 expect(host.text()).toBe('`#: [[Target]].price`'); expect(host.replaceRange).toHaveBeenCalledTimes(1);
});

it.each(['query', 'toggle', 'target-rename', 'target-remove', 'property-policy'])('rejects an old cross-note selection after %s', async cause => {
 const host = await fixture('`#: [[Target]].p`'), target = host.addEditor('ordinary', 'Target.md').file;
 host.frontmatter.set(target.path, {numerals: 'all', price: 2});
 const context = host.trigger(host.first, host.text().length - 1)!;
 const items = host.suggestor.getSuggestions(context);
 expect(Array.isArray(items)).toBe(true); expect(texts(items)).toEqual(['price']);
 if (cause === 'query') {host.setText('`#: sq`'); await flush(); host.trigger(host.first, 6);}
 if (cause === 'toggle') await host.plugin.updateSettings({enableCrossNoteReferences: false});
 if (cause === 'target-rename') target.path = 'Renamed.md';
 if (cause === 'target-remove') host.files.delete('Target.md');
 if (cause === 'property-policy') host.frontmatter.set(target.path, {numerals: 'none', price: 2});
 select(host.suggestor, items[0]); expect(host.replaceRange).not.toHaveBeenCalled();
 expect(host.suggestor.getSuggestions(context)).toEqual([]);
});

it('rechecks cross-note property policy on explicit selection after results were delivered', async () => {
 const host = await fixture('`#: [[Target]].p`'), target = host.addEditor('ordinary', 'Target.md').file;
 host.frontmatter.set(target.path, {numerals: 'all', price: 2});
 const items = await host.suggestions(host.first, host.text().length - 1); expect(texts(items)).toEqual(['price']);
 host.frontmatter.set(target.path, {numerals: 'none', price: 2}); select(host.suggestor, items[0]);
 expect(host.replaceRange).not.toHaveBeenCalled();
});


it('keeps two editors at one path separate and never offers a later definition before it succeeds', async () => {
 const source = '```math\n$a\n```\n```math\n$apple = 1\n```\n`#: $a`';
 const host = await fixture(source, {suggestionsIncludeMathjsSymbols: false});
 expect(texts(await host.suggestions(host.first, source.indexOf('$a\n') + 2))).toEqual([]);
 expect(texts(await host.suggestions(host.first, source.lastIndexOf('$a') + 2))).toEqual(['$apple']);
 const second = host.addEditor('```math\n$banana = 1\n```\n`#: $b`', 'source.md');
 host.workspaceEvents.fire('layout-change'); await flush();
 expect(texts(await host.suggestions(second, second.text().lastIndexOf('$b') + 2))).toEqual(['$banana']);
 expect(texts(await host.suggestions(host.first, source.lastIndexOf('$a') + 2))).toEqual(['$apple']);
});

it('retires the popup when a toggle changes and has no stale context after a rejected trigger', async () => {
 const host = await fixture('`#: sq`'), close = jest.spyOn(host.suggestor, 'close');
 const context = host.trigger(host.first, 6)!;
 expect(texts(await host.suggestor.getSuggestions(context))).toContain('sqrt()');
 await host.plugin.updateSettings({provideSuggestions: false, provideInlineSuggestions: false});
 expect(close).toHaveBeenCalled(); expect(host.suggestor.context).toBeNull();
 expect(host.trigger(host.first, 6)).toBeNull(); expect(await host.suggestor.getSuggestions(context)).toEqual([]);
 await host.plugin.updateSettings({provideInlineSuggestions: true}); await flush(); host.trigger(host.first, 6);
 expect(host.trigger(host.first, 0)).toBeNull(); expect(host.suggestor.context).toBeNull();
});

it('preserves function/constant opt-in and does not interpret explicit completion as automatic insertion input', async () => {
 const host = await fixture('```math\n@[x::2] = 2\n```\n`#: sq`', {suggestionsIncludeMathjsSymbols: false});
 const at = host.text().length - 1;
 expect(await host.suggestions(host.first, at)).toEqual([]);
 await host.plugin.updateSettings({suggestionsIncludeMathjsSymbols: true}); await flush();
 const item = (await host.suggestions(host.first, at)).find(item => item.text === 'sqrt()')!;
 select(host.suggestor, item); await flush();
 expect(host.editor.transaction).not.toHaveBeenCalled();
 expect(host.plugin.getEditorSnapshot(host.editor)?.insertionExhausted).toBe(true);
});


it('offers only property names that the existing reference syntax can address as a single token', async () => {
 const host = await fixture('`#: [[Target]].`'), target = host.addEditor('ordinary', 'Target.md').file;
 host.frontmatter.set(target.path, {numerals: 'all', price: 2, 'gross margin': 3, 'price-with-tax': 4,
  'bad`name': 5, 'bad\nname': 6, 'a|b': 7, 'α': 8});
 const items = await host.suggestions(host.first, host.text().length - 1);
 expect(texts(items)).toEqual(['price', 'α']);
 select(host.suggestor, items[0]); expect(host.text()).toBe('`#: [[Target]].price`');
});


it('rejects a new trigger carrying the retired TFile after replacement at the same path', async () => {
 const host = await fixture('`#: sq`'), oldFile = host.file;
 host.retarget('source.md'); await flush(); host.cursor(6);
 const info = host.suggestor.onTrigger(host.editor.offsetToPos(6), host.editor, oldFile);
 expect(info).toBeNull(); expect(host.replaceRange).not.toHaveBeenCalled();
 expect(texts(await host.suggestions(host.first, 6))).toContain('sqrt()');
});

it.each(['native', 'dataview'])('property discovery never invokes unrelated %s accessors or mutates the engine', async provider => {
 const host = await fixture('`#: [[Target]].p`'), target = host.addEditor('ordinary', 'Target.md').file;
 const engine = host.plugin.getRuntimeContext().engine, original = engine.config({}).precision;
 const read = jest.fn(() => {engine.config({precision: 2}); return 3;});
 const page: Record<string, unknown> = {numerals: 'all', price: 2};
 Object.defineProperty(page, 'unrelated', {enumerable: true, get: read});
 if (provider === 'native') host.frontmatter.set(target.path, page);
 else Object.assign(host.app, {plugins: {plugins: {dataview: {api: {page: () => page}}}}});
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), items = await host.suggestions(host.first, host.text().length - 1);
 expect(texts(items)).toEqual(['price']); expect(read).not.toHaveBeenCalled(); expect(engine.config({}).precision).toBe(original);
 expect(evaluate).not.toHaveBeenCalled(); select(host.suggestor, items[0]); expect(read).not.toHaveBeenCalled();
});

it.each(['accessor', 'array-accessor', 'array-object', 'array-iterator'])('does not execute a %s numerals opt-in control', async kind => {
 const host = await fixture('`#: [[Target]].`'), target = host.addEditor('ordinary', 'Target.md').file;
 const called = jest.fn(() => 'price'), page: Record<string, unknown> = {price: 2, $always: 3};
 if (kind === 'accessor') Object.defineProperty(page, 'numerals', {enumerable: true, get: called});
 else {
  const policy: unknown[] = ['price'];
  if (kind === 'array-accessor') Object.defineProperty(policy, '0', {enumerable: true, get: called});
  if (kind === 'array-object') policy[0] = {toString: called};
  if (kind === 'array-iterator') Object.defineProperty(policy, Symbol.iterator, {value: called});
  page.numerals = policy;
 }
 host.frontmatter.set(target.path, page);
 const items = await host.suggestions(host.first, host.text().length - 1);
 expect(texts(items)).toEqual(kind === 'array-iterator' ? ['$always', 'price'] : ['$always']);
 expect(called).not.toHaveBeenCalled();
});


it('returns reference results synchronously so an old host continuation cannot close a newer popup', async () => {
 const host = await fixture('`#: [[Target]].p`'), target = host.addEditor('ordinary', 'Target.md').file;
 host.frontmatter.set(target.path, {numerals: 'all', price: 2});
 const oldContext = host.trigger(host.first, host.text().length - 1)!;
 const oldResult = host.suggestor.getSuggestions(oldContext);
 // The native EditorSuggest awaits Promise results before showing them, without
 // a later context check. This path must never schedule such a continuation.
 expect(Array.isArray(oldResult)).toBe(true); expect(texts(oldResult)).toEqual(['price']);
 host.setText('`#: sq`'); await flush();
 const nextContext = host.trigger(host.first, 6)!;
 const currentResult = host.suggestor.getSuggestions(nextContext);
 expect(texts(currentResult)).toContain('sqrt()');
 await flush(); expect(host.suggestor.context).toBe(nextContext);
 select(host.suggestor, oldResult[0]); expect(host.suggestor.context).toBe(nextContext);
 expect(host.replaceRange).not.toHaveBeenCalled();
 select(host.suggestor, currentResult.find(item => item.text === 'sqrt()')!);
 expect(host.text()).toBe('`#: sqrt()`');
});
