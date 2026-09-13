import { type MarkdownPostProcessorContext, renderMath } from 'obsidian';
import { registeredSnapshotFixture } from './sourceRegistryTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { installHostDom } from './hostTestSupport';
import { createInlineNumeralsPostProcessor } from '../src/inline/inlinePostProcessor';
import type { NumeralsSettings } from '../src/numerals.types';
import * as evaluation from '../src/evaluation/evaluateNote';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
beforeAll(installHostDom);
afterEach(() => jest.restoreAllMocks());

function reading(codes: string[], prefix = '') {
 let source = prefix + codes.map(code => '`' + code + '`').join(' ');
 const host = registeredSnapshotFixture(source), paragraph = host.view.containerEl.createEl('p');
 const nodes = codes.map(code => paragraph.createEl('code', {text: code}));
 const children: {unload(): void}[] = [];
 const context = {sourcePath: host.file.path, getSectionInfo: () => ({text: source, lineStart: prefix.split('\n').length - 1,
  lineEnd: source.split('\n').length - 1}), addChild: (child: {unload(): void}) => children.push(child)} as unknown as MarkdownPostProcessorContext;
 const processor = createInlineNumeralsPostProcessor(host.registry, () => host.configuration().settings);
 const change = (settings: Partial<NumeralsSettings>, evaluationChange = true) => {
  const current = host.configuration();
  host.configure({...current, settings: {...current.settings, ...settings}, settingsGeneration: current.settingsGeneration + 1,
   evaluationSettingsGeneration: current.evaluationSettingsGeneration + Number(evaluationChange)});
  host.coordinator.settingsChanged(evaluationChange);
 };
 return {...host, nodes, paragraph, context, children, processor, change,
  setSource(next: string) {source = next; host.setText(next); host.registry.sourceChanged(host.editor, false);},
  dispose() {processor.dispose(); host.destroy();}};
}

it.each([
 ['#: 3ft in inches', '36', false, false],
 ['#=: 3ft + 2ft', '5 ft', true, false],
 ['#=: sqrt(144)', '12', true, false],
 ['#$: sqrt(144)', '12', false, true],
 ['#$=: sqrt(144)', '12', true, true],
] as const)('renders %s from the complete snapshot', async (code, expected, equation, tex) => {
 const host = reading([code]); host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].textContent).toContain(expected);
 expect(Boolean(host.nodes[0].querySelector('.numerals-inline-input'))).toBe(equation);
 expect(Boolean(host.nodes[0].querySelector('.numerals-tex'))).toBe(tex);
 if (tex && equation) expect(renderMath).toHaveBeenCalledWith('\\sqrt{144}', false);
 host.dispose();
});

it('retains settings-selected legacy TeX triggers and longest-prefix matching', async () => {
 const host = reading(['#=$: sqrt(144)']); host.change({inlineTexEquationTrigger: '#=$:'});
 host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].querySelector('.numerals-inline-input .numerals-tex')?.textContent).toContain('sqrt');
 expect(host.nodes[0].querySelector('.numerals-inline-value')?.textContent).toBe('12'); host.dispose();
});

it('follows inline globals and @prev while keeping ordinary assignments expression-local', async () => {
 const host = reading(['#: $x = 10', '#: $y = $x * 2', '#: $total = @prev', '#: $x + $y + $total', '#: local = 8', '#: local']);
 host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes.slice(0, 5).map(node => node.textContent)).toEqual(['10', '20', '20', '50', '8']);
 expect(host.nodes[5].textContent).toContain('Undefined symbol local'); host.dispose();
});

it('reports invalid TeX calculations without losing the original expression', async () => {
 const host = reading(['#$: 1 +']); host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].classList.contains('numerals-inline-error')).toBe(true);
 expect(host.nodes[0].textContent).toContain('1 +'); expect(host.nodes[0].textContent).toContain('Unexpected end'); host.dispose();
});

it('owns duplicate callbacks through disable, trigger changes and occurrence unload', async () => {
 const evaluate = jest.spyOn(evaluation, 'evaluateNote'), host = reading(['#: 2+3']);
 host.processor(host.paragraph, host.context); host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].textContent).toBe('5'); expect(host.children).toHaveLength(1); expect(evaluate).toHaveBeenCalledTimes(1);
 host.change({enableInlineNumerals: false}); await flush(); expect(host.nodes[0].textContent).toBe('#: 2+3');
 host.change({enableInlineNumerals: true, inlineResultTrigger: '!!'}); await flush(); expect(host.nodes[0].textContent).toBe('#: 2+3');
 host.change({inlineResultTrigger: '#:'}); await flush(); expect(host.nodes[0].textContent).toBe('5');
 host.children[0].unload(); host.coordinator.inputsChanged(); await flush(); expect(host.nodes[0].textContent).toBe('#: 2+3'); host.dispose();
});

it.each([true, false])('preserves foreign ordinary code DOM with inline enabled=%s', async enabled => {
 const host = reading(['ordinary()']); host.change({enableInlineNumerals: enabled});
 host.nodes[0].innerHTML = '<span class="other-plugin-highlight">ordinary()</span>'; const child = host.nodes[0].firstChild;
 host.processor(host.paragraph, host.context); host.processor(host.paragraph, host.context); host.coordinator.inputsChanged(); await flush();
 expect(host.nodes[0].firstChild).toBe(child); host.dispose(); expect(host.nodes[0].firstChild).toBe(child);
});

it('adopts host-replaced code source only when the complete source generation agrees', async () => {
 const host = reading(['#: 2+3']); host.processor(host.paragraph, host.context); await flush();
 host.nodes[0].textContent = '#: 7+8'; host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].textContent).toBe('#: 7+8'); expect(host.paragraph.textContent).toContain('incomplete or ambiguous');
 host.setSource('`#: 7+8`'); await flush(); expect(host.nodes[0].textContent).toBe('15');
 host.nodes[0].textContent = 'ordinary()'; host.processor(host.paragraph, host.context); await flush();
 host.dispose(); expect(host.nodes[0].textContent).toBe('ordinary()');
});

it('transfers reused DOM between contexts and ignores the old child unload', async () => {
 const host = reading(['#: 2']); host.processor(host.paragraph, host.context); await flush();
 const old = host.children[0], next = {...host.context}; host.processor(host.paragraph, next); await flush();
 old.unload(); host.coordinator.inputsChanged(); await flush();
 expect(host.nodes[0].textContent).toBe('2'); expect(host.children).toHaveLength(2); host.dispose();
});

it('recreates a section when the same host context changes sourcePath without reusing its disposed subscription', async () => {
 const host = reading(['#: 2']); host.processor(host.paragraph, host.context); await flush();
 const old = host.children[0]; host.files.delete(host.file.path); host.file.path = 'renamed.md';
 host.files.set(host.file.path, host.file); host.context.sourcePath = host.file.path; host.registry.reconcile();
 host.processor(host.paragraph, host.context); await flush();
 expect(host.nodes[0].textContent).toBe('2'); expect(host.children).toHaveLength(2);
 old.unload(); host.coordinator.inputsChanged(); await flush(); expect(host.nodes[0].textContent).toBe('2'); host.dispose();
});

it('retargets every previously owned section member when only one subtree is called again', async () => {
 const host = reading(['#: 2', '#: @prev + 1']); host.processor(host.paragraph, host.context); await flush();
 const old = [...host.children]; host.files.delete(host.file.path); host.file.path = 'renamed.md'; host.files.set(host.file.path, host.file);
 host.context.sourcePath = host.file.path; host.registry.reconcile(); host.processor(host.nodes[0], host.context); await flush();
 expect(host.nodes.map(node => node.textContent)).toEqual(['2', '3']); expect(host.children).toHaveLength(4);
 for (const child of old) child.unload(); host.coordinator.inputsChanged(); await flush();
 expect(host.nodes.map(node => node.textContent)).toEqual(['2', '3']); host.dispose();
});
