import { NumeralsRenderStyle, StringReplaceMap } from '../numerals.types';
import { mathjaxLoop } from '../rendering/displayUtils';
import { expressionToTeX, resultToTeX } from '../rendering/texRendering';

function createSpan(parent: HTMLElement, className: string): HTMLElement {
	const span = parent.ownerDocument.createElement('span');
	span.className = className;
	parent.appendChild(span);
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
		void mathjaxLoop(texElement, tex).catch(() => {
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
	formattedResult: string,
	rawResult: unknown,
	renderStyle: NumeralsRenderStyle,
	preProcessors: StringReplaceMap[]
): void {
	renderTexOrText(
		container,
		formattedResult,
		renderStyle,
		() => resultToTeX(rawResult, preProcessors)
	);
}

export function preProcessorsEqual(
	a: StringReplaceMap[],
	b: StringReplaceMap[]
): boolean {
	return (
		a.length === b.length &&
		a.every((processor, index) => (
			processor.regex.toString() === b[index].regex.toString() &&
			processor.replaceStr === b[index].replaceStr
		))
	);
}
