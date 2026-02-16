import * as math from "mathjs";
import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
} from "obsidian";
import { RendererFactory } from "../renderers";
import {
	EvaluationResult,
	FrontmatterProcessingWarning,
	mathjsFormat,
	NumeralsRenderStyle,
	NumeralsScope,
	NumeralsSettings,
	ProcessedBlock,
	RenderContext,
	StringReplaceMap,
} from "../numerals.types";
import { evaluateMathFromSourceStrings } from "../processing/evaluator";
import {
	preProcessBlockForNumeralsDirectives,
} from "../processing/preprocessor";
import { getScopeFromFrontmatterWithWarnings } from "../scope/frontmatter";
import { applyBlockStyles } from "./blockStyles";
import { prepareLineData } from "./linePreparation";

function getEditorForSourcePath(
	app: App,
	sourcePath: string
): MarkdownView["editor"] | null {
	const markdownLeaves = app.workspace.getLeavesOfType?.("markdown") ?? [];
	for (const leaf of markdownLeaves) {
		const view = leaf.view as Partial<MarkdownView> | undefined;
		if (view?.file?.path === sourcePath && view.editor) {
			return view.editor;
		}
	}

	return app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
}

/**
 * Renders warning information into the container element.
 */
export function renderFrontmatterWarnings(
	container: HTMLElement,
	warnings: FrontmatterProcessingWarning[]
): void {
	for (const warning of warnings) {
		const line = container.createEl("div", {
			cls: ["numerals-warning-line", "numerals-line"],
		});
		line.createEl("span", {
			cls: "numerals-input",
			text: `Frontmatter ${warning.key}: ${String(warning.value ?? "")}`,
		});
		line.createEl("span", {
			cls: ["numerals-result", "numerals-warning-message"],
			text: warning.message,
		});
	}
}

/**
 * Renders error information into the container element.
 */
export function renderError(
	container: HTMLElement,
	evaluationResult: EvaluationResult
): void {
	const line = container.createEl("div", {
		cls: ["numerals-error-line", "numerals-line"],
	});
	line.createEl("span", {
		text: evaluationResult.errorInput,
		cls: "numerals-input",
	});
	const resultElement = line.createEl("span", { cls: "numerals-result" });
	resultElement.createEl("span", {
		cls: "numerals-error-name",
		text: `${evaluationResult.errorMsg?.name}:`,
	});
	resultElement.createEl("span", {
		cls: "numerals-error-message",
		text: evaluationResult.errorMsg?.message ?? "",
	});
}

/**
 * Renders a complete Numerals block using the Strategy Pattern.
 */
export function renderNumeralsBlock(
	container: HTMLElement,
	evaluationResult: EvaluationResult,
	processedBlock: ProcessedBlock,
	context: RenderContext,
	warnings: FrontmatterProcessingWarning[] = []
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

		const lineContainer = container.createEl("div", { cls: "numerals-line" });
		if (lineData.isEmitter) {
			lineContainer.toggleClass("numerals-emitter", true);
		}

		renderer.renderLine(lineContainer, lineData, context);
	}

	if (warnings.length > 0) {
		renderFrontmatterWarnings(container, warnings);
	}

	if (evaluationResult.errorMsg) {
		renderError(container, evaluationResult);
	}
}

/**
 * Handles result insertion side effects by updating source lines in the editor.
 */
export function handleResultInsertions(
	results: unknown[],
	insertionLines: number[],
	numberFormat: mathjsFormat,
	ctx: MarkdownPostProcessorContext,
	app: App,
	el: HTMLElement
): void {
	const editor = getEditorForSourcePath(app, ctx.sourcePath);
	if (!editor) {
		return;
	}

	for (const i of insertionLines) {
		const sectionInfo = ctx.getSectionInfo(el);
		const lineStart = sectionInfo?.lineStart;
		if (lineStart === undefined) {
			continue;
		}

		if (i >= results.length || results[i] === undefined) {
			continue;
		}

		const curLine = lineStart + i + 1;
		const sourceLine = editor.getLine(curLine);
		const insertionValue = math.format(results[i], numberFormat);

		const modifiedSource = sourceLine.replace(
			/(@\s*\[)([^\]:]+)(::([^\]]*))?(\].*)$/gm,
			`$1$2::${insertionValue}$5`
		);

		if (modifiedSource !== sourceLine) {
			setTimeout(() => {
				editor.setLine(curLine, modifiedSource);
			}, 0);
		}
	}
}

/**
 * Process and render a Numerals block from source.
 */
export function processAndRenderNumeralsBlockFromSource(
	el: HTMLElement,
	source: string,
	ctx: MarkdownPostProcessorContext,
	metadata: { [key: string]: unknown } | undefined,
	type: NumeralsRenderStyle | null,
	settings: NumeralsSettings,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[],
	app: App
): NumeralsScope {
	const blockRenderStyle: NumeralsRenderStyle =
		type ?? settings.defaultRenderStyle;

	const processedBlock = preProcessBlockForNumeralsDirectives(
		source,
		preProcessors
	);

	applyBlockStyles({
		el,
		settings,
		blockRenderStyle,
		hasEmitters: processedBlock.blockInfo.emitter_lines.length > 0,
	});

	const scopeResult = getScopeFromFrontmatterWithWarnings(
		metadata,
		undefined,
		settings.forceProcessAllFrontmatter,
		preProcessors
	);

	const evaluationResult = evaluateMathFromSourceStrings(
		processedBlock.processedSource,
		scopeResult.scope
	);

	handleResultInsertions(
		evaluationResult.results,
		processedBlock.blockInfo.insertion_lines,
		numberFormat,
		ctx,
		app,
		el
	);

	const renderContext: RenderContext = {
		renderStyle: blockRenderStyle,
		settings,
		numberFormat,
		preProcessors,
	};
	renderNumeralsBlock(
		el,
		evaluationResult,
		processedBlock,
		renderContext,
		scopeResult.warnings
	);

	return scopeResult.scope;
}
