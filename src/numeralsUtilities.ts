export {
	defaultCurrencyMap,
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
} from "./constants";
export {
	evaluateMathFromSourceStrings,
} from "./processing/evaluator";
export {
	preProcessBlockForNumeralsDirectives,
	replaceStringsInTextFromMap,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
} from "./processing/preprocessor";
export {
	getMetadataForFileAtPath,
	getScopeFromFrontmatter,
	getScopeFromFrontmatterWithWarnings,
	type FrontmatterScopeResult,
} from "./scope/frontmatter";
export type { FrontmatterProcessingWarning } from "./numerals.types";
export {
	addGlobalsFromScopeToPageCache,
	addGobalsFromScopeToPageCache,
} from "./scope/scopeCache";
export {
	applyBlockStyles,
} from "./rendering/blockStyles";
export {
	extractComment,
	renderComment,
	cleanRawInput,
	prepareLineData,
} from "./rendering/linePreparation";
export {
	getLocaleFormatter,
	htmlToElements,
	mathjaxLoop,
	normalizeHighlightedNumberNotation,
	texCurrencyReplacement,
	unescapeSubscripts,
} from "./rendering/displayUtils";
export {
	handleResultInsertions,
	processAndRenderNumeralsBlockFromSource,
	renderError,
	renderFrontmatterWarnings,
	renderNumeralsBlock,
} from "./rendering/orchestrator";
