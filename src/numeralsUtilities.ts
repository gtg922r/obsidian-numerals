import * as math from 'mathjs';
import { getAPI } from 'obsidian-dataview';
import { App, TFile, finishRenderMath, renderMath, sanitizeHTMLToDom, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { NumeralsLayout, NumeralsRenderStyle, NumeralsSettings, NumeralsError, CurrencyType, mathjsFormat, NumeralsScope, numeralsBlockInfo, StringReplaceMap, LineRenderData, ProcessedBlock, EvaluationResult, RenderContext } from './numerals.types';
import { RendererFactory } from './renderers';

// TODO: Addition of variables not adding up

/**
 * Process frontmatter and return updated scope object
 * - Numbers are converted to mathjs numbers. Strings are processed as mathjs expressions.
 * - Objects are ignored
 * - Frontmatter key `numerals` sets which frontmatter keys are processed (none is default)):
 *  - `numerals: all` processes all frontmatter keys
 *  - `numerals: none` processes no frontmatter keys
 *  - `numerals: key1` processes only the frontmatter key `key1`
 *  - `numerals: [key1, key2, ...]` processes only the listed frontmatter keys
 *  * 
 * @param scope Numerals scope object (Map)
 * @param frontmatter Frontmatter object
 * @returns Updated scope object
 */
export interface ScopeResult {
	scope: NumeralsScope;
	warnings: string[];
}

export function getScopeFromFrontmatter(
	frontmatter: { [key: string]: unknown } | undefined,
	scope: NumeralsScope|undefined,
	forceAll=false,
	stringReplaceMap: StringReplaceMap[] = [],
	keysOnly=false
): ScopeResult {
	const warnings: string[] = [];
	
	if (!scope) {
		scope = new NumeralsScope();
	}

	if (frontmatter && typeof frontmatter === "object") {
		let frontmatter_process:{ [key: string]: unknown } = {}

		// Determine which metadata keys to process
		if (frontmatter.hasOwnProperty("numerals")) {
			if (frontmatter["numerals"] === "none") {
				frontmatter_process = {};
			} else if (frontmatter.hasOwnProperty("numerals") && frontmatter["numerals"] === "all") {
				// Build frontmatter_process from all keys in frontmatter
				for (const [key, value] of Object.entries(frontmatter)) {
					if (key !== "numerals") {
						frontmatter_process[key] = value;
					}
				}
			} else if (typeof frontmatter["numerals"] === "string") {
				if (frontmatter.hasOwnProperty(frontmatter["numerals"])) {
					frontmatter_process[frontmatter["numerals"]] = frontmatter[frontmatter["numerals"]];
				}
			} else if (Array.isArray(frontmatter["numerals"])) {
				for (const key of frontmatter["numerals"]) {
					if (frontmatter.hasOwnProperty(key)) {
						frontmatter_process[key] = frontmatter[key];
					}
				}
			}
		} else if (forceAll) {
			frontmatter_process = frontmatter;
		}

		// Iterate through frontmatter and add any key/value pair to frontmatter_process if the key starts with `$`
		//   These keys are assumed to be numerals globals that are to be added to the scope regardless of the `numerals` key
		for (const [key, value] of Object.entries(frontmatter)) {
			if (key.startsWith('$')) {
				frontmatter_process[key] = value;
			}
		}

		// if keysOnly is true, only add keys to scope. Otherwise, add values to scope
		if (keysOnly === false) {
			for (const [key, rawValue] of Object.entries(frontmatter_process)) {
				let value = rawValue;
				
				// If value is a mathjs unit, convert to string representation
				value = math.isUnit(value) ? value.valueOf() : value;

				// if processedValue is array-like, take the last element. For inline dataview fields, this generally means the most recent line will be used
				if (Array.isArray(value)) {
					value = value[value.length - 1];
				}

				if (typeof value === "number") {
					scope.set(key, math.number(value));
				} else if (typeof value === "string") {
					const processedValue = replaceStringsInTextFromMap(value, stringReplaceMap);
					
					// Check if the key contains function assignment syntax (e.g., "$v(x)" or "f(x, y)")
					const functionAssignmentMatch = key.match(/^([^(]+)\(([^)]*)\)$/);
					
					if (functionAssignmentMatch) {
						// This is a function assignment like "$v(x)" with value "x + $b - $a"
						const functionName = functionAssignmentMatch[1];
						const parameters = functionAssignmentMatch[2];
						const fullExpression = `${functionName}(${parameters}) = ${processedValue}`;
						
						try {
							// Evaluate the complete function assignment expression
							const evaluatedFunction = math.evaluate(fullExpression, scope);
							// Store the function under the function name (without parentheses)
							scope.set(functionName, evaluatedFunction);
						} catch (error: unknown) {
							warnings.push(`Frontmatter: error evaluating function "${key}": ${error instanceof Error ? error.message : String(error)}`);
						}
					} else {
						// Regular variable assignment
						let evaluatedValue;
						try {
							evaluatedValue = math.evaluate(processedValue, scope);
						} catch (error: unknown) {
							warnings.push(`Frontmatter: error evaluating "${key}": ${error instanceof Error ? error.message : String(error)}`);
							evaluatedValue = undefined;
						}
						if (evaluatedValue !== undefined) {
							scope.set(key, evaluatedValue);
						}
					}
				} else if (typeof value === "function") {
					// Functions (like those cached from previous evaluations) should be stored directly
					scope.set(key, value);
				} else if (typeof value === "object") {
					warnings.push(`Frontmatter: value for "${key}" is an object and will be ignored. ` +
						`Consider surrounding the value with quotes (e.g. \`${key}: "value"\`).`);
				}
			}
		} else {
			for (const key of Object.keys(frontmatter_process)) {
				scope.set(key, undefined);
			}
		}

		return { scope, warnings };
	} else {
		return { scope, warnings };
	}
}	

/** 
 * Add globals from a scope to the Numerals page cache
 * 
 * Globals are keys in the scope Map that start with `$`
 * @param sourcePath Path of the source file
 * @param scope Scope object
 * @returns void
 */
export function addGlobalsFromScopeToPageCache(sourcePath: string, scope: NumeralsScope, scopeCache: Map<string, NumeralsScope>) {
	for (const [key, value] of scope.entries()) {
		if (key.startsWith('$')) {
			if (scopeCache.has(sourcePath)) {
				scopeCache.get(sourcePath)?.set(key, value);
			} else {
				const newScope = new NumeralsScope();
				newScope.set(key, value);
				scopeCache.set(sourcePath, newScope);
			}
		}
	}
}

/**
 * Process a block of text to convert from Numerals syntax to MathJax syntax
 * @param text Text to process
 * @param stringReplaceMap Array of StringReplaceMap objects to use for replacement
 * @returns Processed text 
 */
export function replaceStringsInTextFromMap(text: string, stringReplaceMap: StringReplaceMap[]): string {
	for (const processor of stringReplaceMap ) {
		text = text.replace(processor.regex, processor.replaceStr)
	}
	return text;
}

/**
 * Retrieves metadata for a file at the specified path.
 * 
 * This function takes a source path as input and retrieves the metadata associated with the file at that path. 
 * It first checks the metadata cache for the file and retrieves the frontmatter. 
 * If the file is a Dataview file, it also retrieves the Dataview metadata. 
 * The function then combines the frontmatter and Dataview metadata, with the Dataview metadata taking precedence.
 * 
 * @param sourcePath - The path of the file for which to retrieve metadata.
 * @param app - The Obsidian App instance.
 * @param scopeCache - A Map containing NumeralsScope objects for each file path.
 * @returns The metadata for the file, including both frontmatter and Dataview metadata.
 */
export function getMetadataForFileAtPath(
	sourcePath: string, 
	app: App,
	scopeCache: Map<string, NumeralsScope>
): {[key: string]: unknown} | undefined {
	const f_path:string = sourcePath;
	const handle = app.vault.getAbstractFileByPath(f_path);
	const f_handle = (handle instanceof TFile) ? handle : undefined;
	const f_cache = f_handle ? app.metadataCache.getFileCache(f_handle as TFile) : undefined;
	const frontmatter:{[key: string]: unknown} | undefined = {...(f_cache?.frontmatter), position: undefined};

	const dataviewAPI = getAPI();
	let dataviewMetadata:{[key: string]: unknown} | undefined;
	if (dataviewAPI) {
		const dataviewPage = dataviewAPI.page(f_path)
		dataviewMetadata = {...dataviewPage, file: undefined, position: undefined}
	}
 
	const numeralsPageScope = scopeCache.get(f_path);
	const numeralsPageScopeMetadata:{[key: string]: unknown} = numeralsPageScope ? Object.fromEntries(numeralsPageScope) : {};
  
	// combine frontmatter and dataview metadata, with dataview metadata taking precedence and numerals scope taking precedence over both
	const metadata = {...frontmatter, ...dataviewMetadata, ...numeralsPageScopeMetadata};		
	return metadata;
}

/**
 * Extracts inline comment from a raw input string.
 * Comments in Numerals start with # and continue to the end of the line.
 *
 * @param rawInput - The raw input string that may contain a comment
 * @returns Object with the input without comment and the extracted comment (or null)
 *
 * @example
 * ```typescript
 * extractComment("2 + 2 # this is a comment")
 * // Returns: { inputWithoutComment: "2 + 2 ", comment: " this is a comment" }
 *
 * extractComment("2 + 2")
 * // Returns: { inputWithoutComment: "2 + 2", comment: null }
 * ```
 */
export function extractComment(rawInput: string): {
	inputWithoutComment: string;
	comment: string | null;
} {
	const commentMatch = rawInput.match(/#.+$/);
	if (commentMatch) {
		return {
			inputWithoutComment: rawInput.replace(/#.+$/, ""),
			comment: commentMatch[0],
		};
	}
	return {
		inputWithoutComment: rawInput,
		comment: null,
	};
}

/**
 * Renders an inline comment into an HTML element.
 * Appends a span with the "numerals-inline-comment" class containing the comment text.
 *
 * @param element - The parent element to append the comment to
 * @param comment - The comment string (including the # symbol)
 *
 * @example
 * ```typescript
 * const container = document.createElement('div');
 * renderComment(container, "# this is a comment");
 * // Appends: <span class="numerals-inline-comment"># this is a comment</span>
 * ```
 */
export function renderComment(element: HTMLElement, comment: string): void {
	element.createEl("span", { cls: "numerals-inline-comment", text: comment });
}

/**
 * Cleans raw input string by removing Numerals directives for display.
 * - Removes emitter markup (=>) if hideEmitterMarkupInInput setting is true
 * - Removes result insertion directive syntax (@[variable::result])
 *
 * This function returns a new string and does not mutate the input.
 *
 * @param rawInput - The raw input string to clean
 * @param settings - Numerals settings that control which directives to hide
 * @returns Cleaned input string ready for display
 *
 * @example
 * ```typescript
 * cleanRawInput("result = 42 =>", { hideEmitterMarkupInInput: true })
 * // Returns: "result = 42 "
 *
 * cleanRawInput("@[profit::100] = sales - costs", settings)
 * // Returns: "profit = sales - costs"
 * ```
 */
export function cleanRawInput(rawInput: string, settings: NumeralsSettings): string {
	let cleaned = rawInput;

	// Remove emitter markup (=>) if setting is enabled
	if (settings.hideEmitterMarkupInInput) {
		cleaned = cleaned.replace(/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm, "$1$4");
	}

	// Remove result insertion directive, keeping only the variable name
	cleaned = cleaned.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3");

	return cleaned;
}

/**
 * Prepares data for rendering a single line in a Numerals block.
 * Extracts metadata, cleans input, and determines line characteristics.
 *
 * This is a pure function that transforms raw data into a structured format
 * ready for rendering. It does not mutate any inputs.
 *
 * @param index - Zero-based index of the line in the block
 * @param rawRows - Array of raw input strings from the original source
 * @param inputs - Array of processed input strings that were evaluated
 * @param results - Array of evaluation results
 * @param blockInfo - Metadata about special lines (emitters, insertions, etc.)
 * @param settings - Numerals settings that affect line preparation
 * @returns LineRenderData object ready for rendering
 *
 * @example
 * ```typescript
 * const lineData = prepareLineData(
 *   0,
 *   ["2 + 2 # sum", ""],
 *   ["2 + 2"],
 *   [4, undefined],
 *   { emitter_lines: [], insertion_lines: [], hidden_lines: [], shouldHideNonEmitterLines: false },
 *   settings
 * );
 * // Returns: { index: 0, rawInput: "2 + 2", processedInput: "2 + 2", result: 4,
 * //           isEmpty: false, isEmitter: false, isHidden: false, comment: "# sum" }
 * ```
 */
export function prepareLineData(
	index: number,
	rawRows: string[],
	inputs: string[],
	results: unknown[],
	blockInfo: numeralsBlockInfo,
	settings: NumeralsSettings
): LineRenderData {
	const {
		emitter_lines,
		insertion_lines,
		hidden_lines,
		shouldHideNonEmitterLines,
	} = blockInfo;

	// Get raw input and clean directives
	const rawInput = rawRows[index] || "";
	const cleanedInput = cleanRawInput(rawInput, settings);

	// Extract comment from cleaned input
	const { inputWithoutComment, comment } = extractComment(cleanedInput);

	// Determine line characteristics
	const result = results[index];
	const isEmpty = result === undefined;
	const isEmitter = emitter_lines.includes(index);
	const isHidden =
		hidden_lines.includes(index) ||
		(shouldHideNonEmitterLines && !isEmitter);

	return {
		index,
		rawInput: inputWithoutComment,
		processedInput: inputs[index] || "",
		result,
		isEmpty,
		isEmitter,
		isHidden,
		comment,
	};
}

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

/**
 * Regular expression for matching variables with subscript notation 
 * using `\_`.
 */
const subscriptRegex = /(?<varStart>[\p{L}\p{Nl}_$])(?<varBody>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]*)(\\_)(?<varEnd>[\p{L}\p{Nl}_$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F\u{1D400}-\u{1D7FF}\d]+)/gu;

/**
 * Replaces the magic variable for sum in the processed string with either a specified replacement string or the first matching directive from the raw string.
 * 
 * This function searches for occurrences of the magic variable `__total` in the `processedString` and replaces them with either a specified `replacement` string or the first matching sum directive (e.g., `sum` or `total`) found in the `rawString`. If no replacement is specified and no matching directives are found, the magic variable is removed.
 * 
 * @param processedString - The string after initial processing, where the magic variable `__total` needs to be replaced.
 * @param rawString - The original raw string, which is searched for sum directives.
 * @param replacement - An optional string to replace the magic variable with. If not provided, the function uses the first matching directive from the raw string.
 * @returns The `processedString` with the magic variable `__total` replaced as described.
 * 
 * @example
 * ```typescript
 * const processed = "profit = __total";
 * const raw = "profit = @sum";
 * const output = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(processed, raw);
 * console.log(output); // "profit = @sum"
 */
export function replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(processedString:string, rawString: string, replacement:string|undefined = undefined): string {
    const directiveRegex = /@(sum|total)\b/g;
	const directiveMatches = rawString.match(directiveRegex);

	let restoredInput;
	if (replacement) {
		restoredInput = processedString.replace(/(__total|\\_\\_total)\b/g, replacement);
	} else {
		const defaultReplacementDirective = "@Sum";
		restoredInput = processedString.replace(/(__total|\\_\\_total)\b/g, (match) => directiveMatches?.shift() ?? defaultReplacementDirective);
	}

	return restoredInput;
}

/**
 * Transforms a given string by unescaping and reformatting subscript notation.
 *
 * This function takes a string that contains variables with subscript notation, 
 * where the subscript is written as `\_` followed by the subscript characters 
 * (e.g. `var\_subscript`), and reformat it to use underscore and curly braces 
 * (e.g. `var_{subscript}`).
 *
 * The function is useful for processing strings that represent mathematical 
 * notation or code, and need to be reformatted into a more standardized or 
 * readable subscript notation.
 *
 * @param input - A string potentially containing variables with subscript 
 * notation using `\_`.
 *
 * @returns The input string with the subscript notation reformatted, where each
 * `var\_subscript` is replaced with `var_{subscript}`.
 *
 * @example
 * ```typescript
 * const input = "a\_1 + b\_2 = c\_3";
 * const output = unescapeSubscripts(input);
 * console.log(output); // "a_{1} + b_{2} = c_{3}"
 * ```
 */
export function unescapeSubscripts(input: string): string {
    const output = input.replace(subscriptRegex, (match, varStart, varBody, _, varEnd) => {
        return `${varStart}${varBody}_{${varEnd}}`;
    });
  
    return output;
}


// TODO: Add a switch for only rendering input

export const defaultCurrencyMap: CurrencyType[] = [
	{	symbol: "$", unicode: "x024", 	name: "dollar", currency: "USD"},
	{	symbol: "€", unicode: "x20AC",	name: "euro", 	currency: "EUR"},
	{	symbol: "£", unicode: "x00A3",	name: "pound", 	currency: "GBP"},
	{	symbol: "¥", unicode: "x00A5",	name: "yen", 	currency: "JPY"},
	{	symbol: "₹", unicode: "x20B9",	name: "rupee", 	currency: "INR"}	
];

// TODO: see if would be faster to return a single set of RegEx to get executed, rather than re-computing regex each time
/**
 * Replaces currency symbols in a given TeX string with their corresponding TeX command.
 *
 * This function takes a TeX string as input, and replaces all occurrences of currency symbols
 * (e.g., "$", "€", "£", "¥", "₹") with their corresponding TeX command (e.g., "\dollar", "\euro",
 * "\pound", "\yen", "\rupee"). The mapping between symbols and commands is defined by the
 * `defaultCurrencyMap` array.
 *
 * @param input_tex - The input TeX string, potentially containing currency symbols.
 *
 * @returns The input string with all currency symbols replaced with their corresponding TeX command.
 */
export function texCurrencyReplacement(input_tex:string) {
	for (const symbolType of defaultCurrencyMap) {
		input_tex = input_tex.replace(RegExp("\\\\*\\"+symbolType.symbol,'g'),"\\" + symbolType.name  + " ");
	}
	return input_tex
}


/**
 * Converts a string of HTML into a DocumentFragment continaing a sanitized collection array of DOM elements.
 *
 * @param html The HTML string to convert.
 * @returns A DocumentFragment contaning DOM elements.
 */
export function htmlToElements(html: string): DocumentFragment {
	const sanitizedHTML = sanitizeHTMLToDom(html);
	return sanitizedHTML;
  }

export async function mathjaxLoop(container: HTMLElement, value: string) {
	const html = renderMath(value, true);
	await finishRenderMath()

	// container.empty();
	container.append(html);
}

/**
 * Return a function that formats a number according to the given locale
 * @param locale Locale to use
 * @param options Options to use (see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat)
 * @returns Function that calls toLocaleString with given locale
 */
export function getLocaleFormatter(
	locale: Intl.LocalesArgument | undefined = undefined,
	options: Intl.NumberFormatOptions | undefined = undefined
): (value: number) => string {
	if (locale === undefined) {
		return (value: number): string => value.toLocaleString();
	} else if (options === undefined) {
		return (value: number): string => value.toLocaleString(locale);
	} else {
		return (value: number): string => value.toLocaleString(locale, options);
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
	el.toggleClass(numeralsLayoutClasses[settings.layoutStyle], true);
	el.toggleClass(numeralsRenderStyleClasses[blockRenderStyle], true);			
	el.toggleClass("numerals-alt-row-color", settings.alternateRowColor)

	if (hasEmitters) {
		el.toggleClass("numerals-emitters-present", true);
		el.toggleClass("numerals-hide-non-emitters", settings.hideLinesWithoutMarkupWhenEmitting);
	}	
}

/**
 * Pre-processes a block of text to apply and remove Numerals directives and apply any pre-processors.
 * Source should be ready to be processed directly by mathjs after this function.
 * 
 * @param source - The source string to process.
 * @param preProcessors - An array of StringReplaceMap objects that specify text replacements to be
 * made in the source string before it is processed.
 * @returns An object containing the processed source string, the emitter lines, and the result
 * insertion lines.
 */
export function preProcessBlockForNumeralsDirectives(
	source: string,
	preProcessors: StringReplaceMap[] | undefined,
): {
	rawRows: string[],
	processedSource: string,
	blockInfo: numeralsBlockInfo
} {

	const rawRows: string[] = source.split("\n");
	let processedSource:string = source;

	const emitter_lines: number[] = [];
	const insertion_lines: number[] = [];
	const hidden_lines: number[] = [];
	let shouldHideNonEmitterLines = false;

	// Find emitter and result insertion lines before modifying source
	for (let i = 0; i < rawRows.length; i++) {

		// Find emitter lines (lines that end with `=>`)
		if (rawRows[i].match(/^[^#\r\n]*=>.*$/)) {				 								
			emitter_lines.push(i);
		}

		// Find result insertion lines (lines that match `@[variable::result]`)
		const insertionMatch = rawRows[i].match(/@\s*\[([^\]:]+)(::)?([^\]]*)\].*$/);
		if (insertionMatch) {
			insertion_lines.push(i)
		}

		// Find hideRows directives (starts with @hideRows, ignoring whitespace)
		if (rawRows[i].match(/^\s*@hideRows\s*$/)) {
			hidden_lines.push(i);
			shouldHideNonEmitterLines = true;
		}

		// Find @createUnit directives (starts with @createUnit, ignoring whitespace)
		if (rawRows[i].match(/^\s*@createUnit\s*$/)) {
			hidden_lines.push(i);
		}
	} 

	// remove `=>` at the end of lines, but preserve comments.
	processedSource = processedSource.replace(/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm,"$1") 

	// Replace Directives
	// Replace result insertion directive `@[variable::result]` with only the variable
	processedSource = processedSource.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3")	

	// Replace sum and prev directives
	processedSource = processedSource.replace(/@sum/gi, "__total");
	processedSource = processedSource.replace(/@total/gi, "__total");
	processedSource = processedSource.replace(/@prev/gi, "__prev");

	// Remove @hideRows directive
	processedSource = processedSource.replace(/^\s*@hideRows/gim, "");

	// Apply any pre-processors (e.g. currency replacement, thousands separator replacement, etc.)
	if (preProcessors && preProcessors.length > 0) {
		processedSource = replaceStringsInTextFromMap(processedSource, preProcessors);
	}

	return {
		rawRows,
		processedSource,
		blockInfo: {
			emitter_lines,
			insertion_lines,
			hidden_lines,
			shouldHideNonEmitterLines
		}
	}
}

/**
 * Evaluates a block of math expressions and returns the results. Each row is evaluated separately
 * and the results are returned in an array. If an error occurs, the error message and the input that
 * caused the error are returned.
 * 
 * @remarks
 * This function uses the mathjs library to evaluate the expressions. The scope parameter is used to
 * provide variables and functions that can be used in the expressions. The scope is a Map object
 * where the keys are the variable names and the values are the variable values.
 * 
 * All Numerals directive must be removed from the source before calling this function as it is processed
 * directly by mathjs.
 * 
 * @param processedSource The source string to evaluate
 * @param scope The scope object to use for the evaluation
 * @returns An object containing the results of the evaluation, the inputs that were evaluated, and
 * any error message and input that caused the error.
 */
export function evaluateMathFromSourceStrings(
	processedSource: string,
	scope: NumeralsScope
): {
	results: unknown[];
	inputs: string[];
	errorMsg: Error | null;
	errorInput: string;
} {
	let errorMsg = null;
	let errorInput = "";

	const rows: string[] = processedSource.split("\n");
	const results: unknown[] = [];
	const inputs: string[] = [];

	// Last row is empty in reader view, so ignore it if empty
	const isLastRowEmpty = rows.slice(-1)[0] === "";
	const rowsToProcess = isLastRowEmpty ? rows.slice(0, -1) : rows;

	for (const [index, row] of rowsToProcess.entries()) {
		const lastUndefinedRowIndex = results.slice(0, index).lastIndexOf(undefined);

		try {
			if (index > 0 && results.length > 0) {
				const prevResult = results[results.length - 1];
				scope.set("__prev", prevResult);
			} else {
				scope.set("__prev", undefined);
				if (/__prev/i.test(row)) {
					errorMsg = new NumeralsError("Previous Value Error", 'Error evaluating @prev directive. There is no previous result.');
					errorInput = row;
					break;
				}
			}
			
			const partialResults = results.slice(lastUndefinedRowIndex+1, index).filter(result => result !== undefined);
			if (partialResults.length > 1) {
				try {
					// eslint-disable-next-line prefer-spread
					const rollingSum = math.add.apply(math, partialResults as [math.MathType, math.MathType, ...math.MathType[]]);
					scope.set("__total", rollingSum);
				} catch (error) {
					scope.set("__total", undefined);
					// TODO consider doing this check before evaluating
					if (/__total/i.test(row)) {
						errorMsg = new NumeralsError("Summing Error", 'Error evaluating @sum or @total directive. Previous lines may not be summable.');
						errorInput = row;
						break;
					}						
				}

			} else if (partialResults.length === 1) {
				scope.set("__total", partialResults[0]);
			} else {
				scope.set("__total", undefined);
			}
			results.push(math.evaluate(row, scope));
			inputs.push(row); // Only pushes if evaluate is successful
		} catch (error: unknown) {
			errorMsg = error instanceof Error ? error : new Error(String(error));
			errorInput = row;
			break;
		}
	}

	return { results, inputs, errorMsg, errorInput };
}

