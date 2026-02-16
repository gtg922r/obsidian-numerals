import * as math from 'mathjs';
import { App, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { NumeralsLayout, NumeralsRenderStyle, NumeralsSettings, mathjsFormat, NumeralsScope, numeralsBlockInfo, StringReplaceMap, LineRenderData, ProcessedBlock, EvaluationResult, RenderContext } from '../numerals.types';
import { RendererFactory } from '../renderers';
import { getScopeFromFrontmatter } from '../processing/scope';
import { preProcessBlockForNumeralsDirectives } from '../processing/preprocessor';
import { evaluateMathFromSourceStrings } from '../processing/evaluator';
import { prepareLineData, extractComment, cleanRawInput, renderComment } from './linePreparation';

/**
 * Renders error information into the container element.
 *
 * Creates a formatted error display showing the input that caused the error
 * and the error message with appropriate styling.
 *
 * @param container - HTML element to render the error into
 * @param evaluationResult - Evaluation result containing error information
 */
export function renderError(
	container: HTMLElement,
	evaluationResult: EvaluationResult
): void {
	const line = container.createEl("div", {cls: ["numerals-error-line", "numerals-line"]});
	line.createEl("span", { text: evaluationResult.errorInput, cls: "numerals-input"});
	const resultElement = line.createEl("span", {cls: "numerals-result" });
	resultElement.createEl("span", {cls:"numerals-error-name", text: evaluationResult.errorMsg!.name + ":"});
	resultElement.createEl("span", {cls:"numerals-error-message", text: evaluationResult.errorMsg!.message});
}

/**
 * Renders a complete Numerals block using the Strategy Pattern.
 *
 * This function orchestrates the rendering of all lines in a Numerals block.
 * It uses the RendererFactory to create the appropriate renderer based on the
 * render style, then iterates through all lines, preparing data and delegating
 * rendering to the strategy implementation.
 *
 * Hidden lines (based on @hide directive or emitter visibility settings) are
 * skipped during rendering. Each visible line gets a container div with appropriate
 * CSS classes, and the renderer handles the actual content rendering.
 *
 * @param container - HTML element to render the block into
 * @param evaluationResult - Results from evaluating the block
 * @param processedBlock - Preprocessed block data including raw rows and metadata
 * @param context - Rendering configuration and settings
 */
export function renderNumeralsBlock(
	container: HTMLElement,
	evaluationResult: EvaluationResult,
	processedBlock: ProcessedBlock,
	context: RenderContext
): void {
	const renderer = RendererFactory.createRenderer(context.renderStyle);

	for (let i = 0; i < evaluationResult.inputs.length; i++) {
		const lineData = prepareLineData(
			i,
			processedBlock.rawRows,
			evaluationResult.inputs,
			evaluationResult.results,
			processedBlock.blockInfo,
			context.settings
		);

		if (lineData.isHidden) {
			continue;
		}

		const lineContainer = container.createEl("div", {cls: "numerals-line"});
		if (lineData.isEmitter) {
			lineContainer.toggleClass("numerals-emitter", true);
		}

		renderer.renderLine(lineContainer, lineData, context);
	}

	if (evaluationResult.errorMsg) {
		renderError(container, evaluationResult);
	}
}

/**
 * Handles result insertion side effects by updating source lines in the editor.
 *
 * This function modifies the editor content to insert calculated results into
 * the source using the @[variable::result] syntax. This is a side effect that
 * writes back to the document.
 *
 * The insertion uses the format: @[variableName::calculatedValue]
 * where calculatedValue is the formatted result from evaluation.
 *
 * @param results - Array of evaluated results
 * @param insertionLines - Array of line indices that have insertion directives
 * @param numberFormat - Format specification for displaying numbers
 * @param ctx - Markdown post processor context (provides section info)
 * @param app - Obsidian App instance (provides editor access)
 * @param el - The HTML element being rendered (used to get section info)
 *
 * @example
 * ```typescript
 * // Source line: @[profit] = sales - costs
 * // After evaluation with result=100:
 * // Updated to: @[profit::100] = sales - costs
 *
 * handleResultInsertions(
 *   [100],
 *   [0],
 *   numberFormat,
 *   ctx,
 *   app,
 *   el
 * );
 * ```
 *
 * @remarks
 * This function has side effects:
 * - Modifies editor content via `editor.setLine()`
 * - Uses setTimeout to defer the modification
 * - Only modifies lines where the value has actually changed
 */
export function handleResultInsertions(
	results: unknown[],
	insertionLines: number[],
	numberFormat: mathjsFormat,
	ctx: MarkdownPostProcessorContext,
	app: App,
	el: HTMLElement
): void {
	for (const i of insertionLines) {
		const sectionInfo = ctx.getSectionInfo(el);
		const lineStart = sectionInfo?.lineStart;

		if (lineStart === undefined) {
			continue;
		}

		const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!editor) {
			continue;
		}

		// Skip if result doesn't exist (evaluation stopped early due to error)
		if (i >= results.length || results[i] === undefined) {
			continue;
		}

		const curLine = lineStart + i + 1;
		const sourceLine = editor.getLine(curLine);
		const insertionValue = math.format(results[i], numberFormat);

		// Replace @[variable] or @[variable::oldValue] with @[variable::newValue]
		const modifiedSource = sourceLine.replace(
			/(@\s*\[)([^\]:]+)(::([^\]]*))?(\].*)$/gm,
			`$1$2::${insertionValue}$5`
		);

		// Only update if the line actually changed
		if (modifiedSource !== sourceLine) {
			setTimeout(() => {
				editor.setLine(curLine, modifiedSource);
			}, 0);
		}
	}
}

/**
 * Renders a Numerals block from a given source string, using provided metadata and settings.  
 *   
 * This function takes a source string, which represents a block of Numerals code, and processes it   
 * to generate a rendered Numerals block. The block is appended to a given HTML element. The function   
 * also uses provided metadata and settings to control the rendering process.  
 *  
 * @param el - The HTML element to which the rendered Numerals block is appended.  
 * @param source - The source string representing the Numerals block to be rendered.  
 * @param metadata - An object containing metadata that is used during the rendering process. This   
 * metadata can include information about the Numerals block, such as frontmatter keys and values.  
 * @param type - A NumeralsRenderStyle value that specifies the rendering style to be used for the   
 * Numerals block.  
 * @param settings - A NumeralsSettings object that provides settings for the rendering process. These   
 * settings can control aspects such as the layout style, whether to alternate row colors, and whether   
 * to hide lines without markup when emitting.  
 * @param numberFormat - A mathjsFormat function that is used to format numbers in the Numerals block.  
 * @param preProcessors - An array of StringReplaceMap objects that specify text replacements to be   
 * made in the source string before it is processed.  
 * @param app - The Obsidian App instance.
 *  
 * @returns void  
 *
 */  
export function processAndRenderNumeralsBlockFromSource(
	el: HTMLElement,
	source: string,
	ctx: MarkdownPostProcessorContext,
	metadata: {[key: string]: unknown} | undefined,
	type: NumeralsRenderStyle | undefined,
	settings: NumeralsSettings,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[],
	app: App
): NumeralsScope {

	// Phase 1: Determine render style
	const blockRenderStyle: NumeralsRenderStyle = type ?? settings.defaultRenderStyle;

	// Phase 2: Preprocess
	const processedBlock = preProcessBlockForNumeralsDirectives(source, preProcessors);

	// Phase 3: Apply block styles
	applyBlockStyles({
		el,
		settings,
		blockRenderStyle,
		hasEmitters: processedBlock.blockInfo.emitter_lines.length > 0,
	});

	// Phase 4: Build scope
	const { scope, warnings } = getScopeFromFrontmatter(
		metadata,
		undefined,
		settings.forceProcessAllFrontmatter,
		preProcessors
	);

	// Phase 5: Evaluate
	const evaluationResult = evaluateMathFromSourceStrings(
		processedBlock.processedSource,
		scope
	);

	// Phase 6: Handle side effects (result insertions)
	handleResultInsertions(
		evaluationResult.results,
		processedBlock.blockInfo.insertion_lines,
		numberFormat,
		ctx,
		app,
		el
	);

	// Phase 7: Render
	const renderContext: RenderContext = {
		renderStyle: blockRenderStyle,
		settings,
		numberFormat,
		preProcessors,
	};

	renderNumeralsBlock(el, evaluationResult, processedBlock, renderContext);

	// Phase 8: Render warnings (frontmatter errors, etc.)
	for (const warning of warnings) {
		const warningEl = el.createEl('div', { cls: 'numerals-warning' });
		warningEl.createEl('span', { cls: 'numerals-warning-message', text: warning });
	}

	return scope;

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
	el.toggleClass(numeralsLayoutClasses[settings.layoutStyle], true);
	el.toggleClass(numeralsRenderStyleClasses[blockRenderStyle], true);			
	el.toggleClass("numerals-alt-row-color", settings.alternateRowColor)

	if (hasEmitters) {
		el.toggleClass("numerals-emitters-present", true);
		el.toggleClass("numerals-hide-non-emitters", settings.hideLinesWithoutMarkupWhenEmitting);
	}	
}
