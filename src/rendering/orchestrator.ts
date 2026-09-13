import { NumeralsLayout, NumeralsRenderStyle, type NumeralsSettings, type LineRenderData, type RenderContext } from '../numerals.types';
import { RendererFactory } from '../renderers';

export function renderDiagnostic(container: HTMLElement, message: string, input = ''): void {
 const line = container.createDiv({cls: ['numerals-error-line', 'numerals-line']});
 if (input) line.createSpan({cls: 'numerals-input', text: input});
 line.createSpan({cls: 'numerals-error-message', text: message});
}

/** DOM-only strategy orchestration. Mathematical input preparation belongs to the snapshot owner. */
export function renderNumeralsBlock(container: HTMLElement, lines: readonly LineRenderData[], context: RenderContext): void {
 const renderer = RendererFactory.createRenderer(context.renderStyle);
 for (const line of lines) {
  if (line.isHidden) continue;
  const element = container.createDiv({cls: 'numerals-line'});
  element.dataset.sourceLine = String(line.index);
  element.toggleClass('numerals-emitter', line.isEmitter);
  try { renderer.renderLine(element, line, context); }
  catch (error: unknown) { renderDiagnostic(element, error instanceof Error ? error.message : String(error), line.rawInput); }
 }
}

export const numeralsLayoutClasses = {
	[NumeralsLayout.TwoPanes]: 		"numerals-panes",
	[NumeralsLayout.AnswerRight]: 	"numerals-answer-right",
	[NumeralsLayout.AnswerBelow]: 	"numerals-answer-below",
	[NumeralsLayout.AnswerInline]: 	"numerals-answer-inline",	
}

export const numeralsRenderStyleClasses = {
	[NumeralsRenderStyle.Plain]: 			"numerals-plain",
	[NumeralsRenderStyle.TeX]: 			 	"numerals-tex",
	[NumeralsRenderStyle.SyntaxHighlight]: 	"numerals-syntax",
}

/**
 * Applies the styles specified in the given settings to the given HTML element.
 *
 * This function takes an HTML element and a NumeralsSettings object, and applies the styles
 * specified in the settings to the element. The function modifies the element's class list to
 * add or remove classes based on the settings.
 *
 * @param el - The HTML element to which to apply the styles.
 * @param settings - A NumeralsSettings object 
 * @param blockRenderStyle - A NumeralsRenderStyle value that specifies the rendering style to be used for the
 * Numerals block.
 */
export function applyBlockStyles({
	el,
	settings,
	blockRenderStyle,
	hasEmitters = false
}: {
	el: HTMLElement,
	settings: NumeralsSettings,
	blockRenderStyle: NumeralsRenderStyle,
	hasEmitters?: boolean
}) {
	el.toggleClass("numerals-block", true);
	for (const className of Object.values(numeralsLayoutClasses)) el.toggleClass(className, className === numeralsLayoutClasses[settings.layoutStyle]);
	for (const className of Object.values(numeralsRenderStyleClasses)) el.toggleClass(className, className === numeralsRenderStyleClasses[blockRenderStyle]);
	el.toggleClass("numerals-alt-row-color", settings.alternateRowColor)

	el.toggleClass("numerals-emitters-present", hasEmitters);
	el.toggleClass("numerals-hide-non-emitters", hasEmitters && settings.hideLinesWithoutMarkupWhenEmitting);
}
