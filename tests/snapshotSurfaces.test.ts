import { type MarkdownPostProcessorContext } from 'obsidian';
import { registeredSnapshotFixture as fixture } from './sourceRegistryTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { installHostDom } from './hostTestSupport';
import { BlockSurface } from '../src/host/blockSurface';
import { createInlineNumeralsPostProcessor } from '../src/inline/inlinePostProcessor';
import { bindBlock, bindInlineSection } from '../src/host/occurrenceBinding';
import { indexNote } from '../src/evaluation/sourceIndex';
import * as evaluation from '../src/evaluation/evaluateNote';
import { NumeralsRenderStyle } from '../src/numerals.types';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
beforeAll(installHostDom);
afterEach(() => jest.restoreAllMocks());

function context(source: string, first: number, last: number) {
	const children: {unload(): void}[] = [];
	const ctx = {sourcePath: 'source.md', getSectionInfo: () => ({text: source, lineStart: first, lineEnd: last}),
		addChild: (child: {unload(): void}) => children.push(child)} as unknown as MarkdownPostProcessorContext;
	return {ctx, children};
}

it('projects repeated blocks and inline @prev from one complete ordered generation', async () => {
	const source = '```math\n$rate = 3\n```\n\n```math\n$rate * 2\n```\n\n```math\n$rate * 2\n```\n\n`#: $rate * 4` and `#: @prev + 1`';
	const evaluate = jest.spyOn(evaluation, 'evaluateNote'), host = fixture(source);
	const left = host.view.containerEl.createDiv(), right = host.view.containerEl.createDiv();
	const first = new BlockSurface(left, context(source, 4, 6).ctx, '$rate * 2', NumeralsRenderStyle.Plain, host.registry, host.app, jest.fn());
	const second = new BlockSurface(right, context(source, 8, 10).ctx, '$rate * 2', NumeralsRenderStyle.Plain, host.registry, host.app, jest.fn());
	first.refresh(); second.refresh();
	const paragraph = host.view.containerEl.createDiv(); paragraph.createEl('code', {text: '#: $rate * 4'});
	paragraph.createSpan({text: ' and '}); paragraph.createEl('code', {text: '#: @prev + 1'});
	const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
	const inlineContext = context(source, 12, 12); inline(paragraph, inlineContext.ctx);
	await flush();
	expect(left.querySelector('.numerals-result')?.textContent).toContain('6');
	expect(right.querySelector('.numerals-result')?.textContent).toContain('6');
	expect(paragraph.textContent).toBe('12 and 13'); expect(evaluate).toHaveBeenCalledTimes(1);
	first.refresh(); second.refresh(); inline(paragraph, inlineContext.ctx); await flush();
	expect(evaluate).toHaveBeenCalledTimes(1);
	first.dispose(); second.dispose(); inline.dispose();
	expect(paragraph.textContent).toBe('#: $rate * 4 and #: @prev + 1'); host.destroy();
});

it('withholds obsolete inline output immediately and removes deleted globals after a revision', async () => {
	const source = '```math\n$x = 4\n```\n\n`#: $x`';
	const host = fixture(source), element = host.view.containerEl.createDiv(); element.createEl('code', {text: '#: $x'});
	const ctx = context(source, 4, 4).ctx;
	const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
	inline(element, ctx); await flush(); expect(element.textContent).toBe('4');
	const next = source.replace('$x = 4', '2'); host.setText(next);
	ctx.getSectionInfo = () => ({text: next, lineStart: 4, lineEnd: 4});
	host.registry.sourceChanged(host.editor, false);
	expect(element.textContent).toContain('Updating calculation'); expect(element.textContent).not.toBe('4');
	await flush(); expect(element.textContent).toContain('Undefined symbol $x');
	inline.dispose(); host.destroy();
});

it('binds UTF16/CRLF/container blocks and section-only embeds without first-text matching', () => {
	const source = '😀 intro\r\n> ````math\r\n> 2 + 2\r\n> ````\r\n\r\n```math\r\n2 + 2\r\n```';
	const index = indexNote({sourceId: 'source', revision: 1, text: source});
	expect(bindBlock(index, {text: source, lineStart: 1, lineEnd: 3}, '2 + 2\n')?.id).toBe(index.calculations[0].id);
	expect(bindBlock(index, {text: '> ````math\n> 2 + 2\n> ````', lineStart: 0, lineEnd: 2}, '2 + 2')?.id).toBe(index.calculations[0].id);
	expect(bindBlock(index, {text: source, lineStart: 0, lineEnd: 7}, '2 + 2')).toBeUndefined();
	expect(bindBlock(index, null, '2 + 2')).toBeUndefined();
	expect(bindBlock(index, {text: source, lineStart: 5, lineEnd: 7}, 'wrong source')).toBeUndefined();
});

it('requires the complete inline sequence and an occurrence ordinal within its validated section', () => {
	const text = '`#: 2` and `#: 2`', index = indexNote({sourceId: 'source', revision: 1, text});
	const section = {text, lineStart: 0, lineEnd: 0};
	expect(bindInlineSection(index, section, ['#: 2', '#: 2'])?.map(item => item.id)).toEqual(index.calculations.map(item => item.id));
	expect(bindInlineSection(index, section, ['#: 2'])).toBeUndefined();
	expect(bindInlineSection(index, {text: 'unrelated', lineStart: 0, lineEnd: 0}, ['#: 2', '#: 2'])).toBeUndefined();
});

it('preserves unrelated inline DOM and refuses changed external source on unload', async () => {
	const source = '`#: 2` and a link', host = fixture(source), element = host.view.containerEl.createDiv();
	const code = element.createEl('code', {text: '#: 2'}), link = element.createEl('a', {text: 'a link'});
	const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
	inline(element, context(source, 0, 0).ctx); await flush(); expect(code.textContent).toBe('2');
	code.textContent = 'externally replaced'; inline.dispose();
	expect(code.textContent).toBe('externally replaced'); expect(element.contains(link)).toBe(true); host.destroy();
});

it('coalesces separate subtree callbacks into the complete physical section sequence', async () => {
 const source = '`#: 1` and `#: @prev + 1`', host = fixture(source), paragraph = host.view.containerEl.createDiv();
 const first = paragraph.createEl('code', {text: '#: 1'}), second = paragraph.createEl('code', {text: '#: @prev + 1'});
 const ctx = context(source, 0, 0).ctx, inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(first, ctx); await flush(); expect(first.textContent).toBe('1'); expect(second.textContent).toBe('#: @prev + 1');
 inline(second, ctx); await flush(); expect(first.textContent).toBe('1'); expect(second.textContent).toBe('2');
 inline.dispose(); host.destroy();
});

it('reconciles a newly assembled node with existing section members after source changes', async () => {
 let source = '`#: 1`'; const host = fixture(source), paragraph = host.view.containerEl.createDiv();
 const first = paragraph.createEl('code', {text: '#: 1'}), ctx = context(source, 0, 0).ctx;
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(paragraph, ctx); await flush(); expect(first.textContent).toBe('1');
 source += ' `#: @prev + 1`'; host.setText(source); ctx.getSectionInfo = () => ({text: source, lineStart: 0, lineEnd: 0});
 const second = paragraph.createEl('code', {text: '#: @prev + 1'});
 host.registry.sourceChanged(host.editor, false); inline(paragraph, ctx); await flush();
 expect(first.textContent).toBe('1'); expect(second.textContent).toBe('2');
 inline.dispose(); host.destroy();
});

it.each([
 'text <code>#:1</code> `#:1` `ordinary` `#: @prev + 1`',
 'text <span><code>#:1</code></span> `#:1` `ordinary` `#: @prev + 1`',
])('preserves raw HTML and ordinary code while binding identical Markdown code: %s', async source => {
 const host = fixture(source), paragraph = host.view.containerEl.createDiv();
 const raw = paragraph.createEl('code'); raw.innerHTML = '<b>#:1</b>'; const original = raw.firstChild;
 const valid = paragraph.createEl('code', {text: '#:1'}), ordinary = paragraph.createEl('code', {text: 'ordinary'});
 const next = paragraph.createEl('code', {text: '#: @prev + 1'});
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(paragraph, context(source, 0, 0).ctx); await flush();
 expect(raw.firstChild).toBe(original); expect(raw.className).toBe(''); expect(valid.textContent).toBe('1');
 expect(ordinary.textContent).toBe('ordinary'); expect(next.textContent).toBe('2');
 inline.dispose(); expect(raw.firstChild).toBe(original); host.destroy();
});

it.each([
 ['text[^n]\n\n[^n]: `#:1`', 3],
 ['text ^[note `#:1`]', 1],
 ['text ^[nested [label](target) `#:1`]', 1],
] as const)('binds a unique complete footnote code sequence without clamping synthetic section lines', async (source, line) => {
 const host = fixture(source), footnotes = host.view.containerEl.createEl('section', {cls: 'footnotes'});
 const item = footnotes.createEl('ol').createEl('li'), code = item.createEl('p').createEl('code', {text: '#:1'});
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(code, context(source, line, line).ctx); await flush();
 expect(code.textContent).toBe('1'); inline.dispose(); host.destroy();
});

it('withholds duplicate footnote identities and preserves original code with an occurrence-local limitation', async () => {
 const source = 'text[^a] and text[^b]\n\n[^a]: `#:1`\n[^b]: `#:1`', host = fixture(source);
 const footnotes = host.view.containerEl.createEl('section', {cls: 'footnotes'}), item = footnotes.createEl('ol').createEl('li');
 const code = item.createEl('code', {text: '#:1'}), original = code.firstChild;
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(code, context(source, 4, 4).ctx); await flush();
 expect(code.firstChild).toBe(original); expect(item.textContent).toContain('incomplete or ambiguous');
 expect(item.textContent).not.toContain('Reopen'); inline.dispose(); expect(item.textContent).toBe('#:1'); host.destroy();
});

it('uses a validated signed native footnote line to disambiguate identical definition bodies', async () => {
 const source = 'text[^b] and text[^a]\n\n[^a]: `#: $x = 1`\n\n[^b]: `#: $x = 1`', host = fixture(source);
 const footnotes = host.view.containerEl.createEl('section', {cls: 'footnotes'}), item = footnotes.createEl('ol').createEl('li');
 item.dataset.line = '-1'; item.dataset.footnoteId = 'fn-1-native-doc';
 const code = item.createEl('code', {text: '#: $x = 1'}), ctx = context(source, 5, 5).ctx; ctx.docId = 'native-doc';
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(code, ctx); await flush(); expect(code.textContent).toBe('1'); expect(item.textContent).not.toContain('ambiguous');
 inline.dispose(); host.destroy();
});

it.each(['-1oops', ' -1', '-99', '9007199254740993'])('rejects invalid signed footnote line evidence %s', async delta => {
 const source = 'text[^a]\n\n[^a]: `#:1`', host = fixture(source);
 const footnotes = host.view.containerEl.createEl('section', {cls: 'footnotes'}), item = footnotes.createEl('ol').createEl('li');
 item.dataset.line = delta; item.dataset.footnoteId = 'fn-1'; const code = item.createEl('code', {text: '#:1'});
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(code, context(source, 3, 3).ctx); await flush(); expect(code.textContent).toBe('#:1');
 expect(item.textContent).toContain('incomplete or ambiguous'); inline.dispose(); host.destroy();
});

it('preserves authored raw HTML that imitates the native footnote DOM and attributes', async () => {
 const raw = '<section class="footnotes"><ol><li data-line="2" data-footnote-id="fn-1"><code>#:1</code></li></ol></section>';
 const source = raw + '\ntext[^a]\n[^a]: `#:1`', host = fixture(source), element = host.view.containerEl.createDiv();
 element.innerHTML = raw; const code = element.querySelector('code')!, original = code.firstChild;
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(element, context(source, 0, 0).ctx); await flush();
 expect(code.firstChild).toBe(original); expect(code.classList.contains('numerals-inline')).toBe(false);
 inline.dispose(); expect(code.firstChild).toBe(original); host.destroy();
});

it('withholds adjacent footnote bodies when the authoritative parser supplies one combined container', async () => {
 const source = 'text[^b] and text[^a]\n\n[^a]: `#:1`\n[^b]: `#:1`', host = fixture(source);
 const footnotes = host.view.containerEl.createEl('section', {cls: 'footnotes'}), item = footnotes.createEl('ol').createEl('li');
 item.dataset.line = '-1'; item.dataset.footnoteId = 'fn-1'; const code = item.createEl('code', {text: '#:1'});
 const inline = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 inline(code, context(source, 4, 4).ctx); await flush(); expect(code.textContent).toBe('#:1');
 expect(item.textContent).toContain('incomplete or ambiguous'); inline.dispose(); host.destroy();
});
