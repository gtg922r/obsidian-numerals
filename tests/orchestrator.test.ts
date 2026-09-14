import { renderDiagnostic } from '../src/rendering/orchestrator';
import { renderSnapshotFixture } from './renderSnapshotFixture';
import { installHostDom } from './hostTestSupport';
import { NumeralsRenderStyle, NumeralsLayout } from '../src/numerals.types';
import { createDefaultSettings } from '../src/settings/normalization';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
beforeAll(installHostDom);

it('renders a useful diagnostic while preserving successful preceding rows', () => {
 const element = document.createElement('div');
 renderSnapshotFixture(element, '1 + 1\nmissing\n3 + 3', {style: NumeralsRenderStyle.Plain});
 expect(element.querySelector('.numerals-result')?.textContent).toContain('2');
 expect(element.querySelector('.numerals-error-message')?.textContent).toContain('Undefined symbol missing');
 expect(element.textContent).not.toContain('3 + 3');
});

it('renders diagnostic text safely with the original input', () => {
 const element = document.createElement('div'); renderDiagnostic(element, '<script>bad()</script>', '1 + x');
 expect(element.querySelector('script')).toBeNull();
 expect(element.querySelector('.numerals-input')?.textContent).toBe('1 + x');
 expect(element.querySelector('.numerals-error-line')).not.toBeNull();
});

it('retains comments, emitters and hidden-row behavior from the snapshot', () => {
 const element = document.createElement('div');
 renderSnapshotFixture(element, 'a = 2\na + 3 => # result', {style: NumeralsRenderStyle.Plain});
 expect(element.querySelector('.numerals-emitter')).not.toBeNull();
 expect(element.textContent).toContain('result'); expect(element.textContent).toContain('5');
});

it('replaces layout and style classes when settings change', () => {
 const element = document.createElement('div'), settings = createDefaultSettings();
 renderSnapshotFixture(element, '2', {settings: {...settings, layoutStyle: NumeralsLayout.AnswerRight}, style: NumeralsRenderStyle.Plain});
 element.empty();
 renderSnapshotFixture(element, '2', {settings: {...settings, layoutStyle: NumeralsLayout.AnswerBelow}, style: NumeralsRenderStyle.SyntaxHighlight});
 expect(element.classList.contains('numerals-answer-right')).toBe(false);
 expect(element.classList.contains('numerals-answer-below')).toBe(true);
 expect(element.classList.contains('numerals-plain')).toBe(false);
 expect(element.classList.contains('numerals-syntax')).toBe(true);
});

it.each([NumeralsRenderStyle.Plain, NumeralsRenderStyle.TeX, NumeralsRenderStyle.SyntaxHighlight])(
 'retains reference names and typed negative-value precedence in %s', async style => {
  const element = document.createElement('div');
  const snapshot = renderSnapshotFixture(element, '[[Budget 💰]].price ^ 2', {style, references: new Map([['[[Budget 💰]].price', -2]])});
  await Promise.resolve(); await Promise.resolve();
  expect(snapshot.dependencies[0].status).toBe('resolved');
  expect(element.querySelector('.numerals-input')?.textContent).toContain('Budget 💰');
  expect(element.querySelector('.numerals-result')?.textContent).toContain('4');
  expect(element.textContent).not.toMatch(/__numerals_ref|NumeralsReferenceLabel/);
 });

it('syntax highlighting preserves magic-variable text in reference labels', () => {
 const element = document.createElement('div');
 renderSnapshotFixture(element, '[[n]].__total + [[__total]].x', {style: NumeralsRenderStyle.SyntaxHighlight,
  references: new Map([['[[n]].__total', 2], ['[[__total]].x', 3]])});
 expect(element.querySelector('.numerals-input')?.textContent).toBe('[[n]].__total+[[__total]].x');
 expect(element.querySelector('.numerals-result')?.textContent).toContain('5');
});

it('does not invent a formatting diagnostic from a row inside a multiline quoted literal', () => {
 const element = document.createElement('div');
 renderSnapshotFixture(element, '"prefix\n@format hexadecimal"', {style: NumeralsRenderStyle.Plain});
 expect(element.textContent).not.toContain('Unknown @format');
});
