import { InlineNumeralsMode, NumeralsRenderStyle } from '../numerals.types';
import type { FormattedResult } from '../formatting';
import { renderOwnedMath } from '../rendering/mathLifecycle';

export interface InlinePresentation {
 readonly rawExpression: string;
 readonly mode: InlineNumeralsMode;
 readonly renderStyle: NumeralsRenderStyle;
 readonly formattedResult: FormattedResult;
 readonly inputTeX?: string;
 readonly separator: string;
 readonly error?: string;
}

export function renderInlineInputContent(container: HTMLElement, rawExpression: string, inputTeX: string | undefined,
 renderStyle: NumeralsRenderStyle, signal: AbortSignal): void {
 if (renderStyle === NumeralsRenderStyle.TeX && inputTeX !== undefined) renderOwnedMath(container.createSpan({cls: 'numerals-tex'}), inputTeX, signal, false);
 else container.textContent = rawExpression;
}

export function renderInlineValueContent(container: HTMLElement, result: FormattedResult,
 renderStyle: NumeralsRenderStyle, signal: AbortSignal): void {
 if (renderStyle === NumeralsRenderStyle.TeX) renderOwnedMath(container.createSpan({cls: 'numerals-tex'}), result.tex, signal, false);
 else container.textContent = result.text;
}

export function renderInlinePresentation(container: HTMLElement, data: InlinePresentation, signal: AbortSignal): void {
 container.replaceChildren();
 container.classList.add('numerals-inline');
 container.classList.toggle('numerals-inline-tex', data.renderStyle === NumeralsRenderStyle.TeX);
 if (data.error) {
  container.classList.add('numerals-inline-error');
  container.textContent = data.rawExpression;
  container.createSpan({cls: 'numerals-error-message', text: ` (${data.error})`});
  return;
 }
 if (data.mode === InlineNumeralsMode.Equation) {
  container.classList.add('numerals-inline-equation');
  renderInlineInputContent(container.createSpan({cls: 'numerals-inline-input'}), data.rawExpression,
   data.inputTeX, data.renderStyle, signal);
  container.createSpan({cls: 'numerals-inline-separator', text: data.separator});
 } else container.classList.add('numerals-inline-result');
 renderInlineValueContent(container.createSpan({cls: 'numerals-inline-value'}), data.formattedResult, data.renderStyle, signal);
}
