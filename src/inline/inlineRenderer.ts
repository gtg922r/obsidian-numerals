import { NumeralsRenderStyle } from '../numerals.types';
import type { FormattedResult } from '../formatting';
import { mathjaxLoop } from '../rendering/displayUtils';
import { expressionToTeX } from '../rendering/texRendering';

function createSpan(parent: HTMLElement, className: string): HTMLElement {
	const span = parent.createSpan({ cls: className });
	return span;
}

function renderTexOrText(
	container: HTMLElement,
	text: string,
	renderStyle: NumeralsRenderStyle,
	toTex: () => string
): void {
	if (renderStyle !== NumeralsRenderStyle.TeX) {
		container.textContent = text;
		return;
	}

	try {
		const tex = toTex();
		const texElement = createSpan(container, 'numerals-tex');
		// mathjaxLoop is async, so a MathJax failure surfaces as a rejection
		// that the surrounding try/catch cannot see — fall back to plain text.
		void mathjaxLoop(texElement, tex, false).catch(() => {
			texElement.textContent = text;
		});
	} catch {
		container.textContent = text;
	}
}

export function renderInlineInputContent(
	container: HTMLElement,
	rawExpression: string,
	processedExpression: string,
	renderStyle: NumeralsRenderStyle
): void {
	renderTexOrText(
		container,
		rawExpression,
		renderStyle,
		() => expressionToTeX(processedExpression, rawExpression)
	);
}

export function renderInlineValueContent(
	container: HTMLElement,
	formattedResult: FormattedResult,
	renderStyle: NumeralsRenderStyle
): void {
	renderTexOrText(
		container,
		formattedResult.text,
		renderStyle,
		() => formattedResult.tex
	);
}
