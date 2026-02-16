/**
 * Barrel re-export module for backwards compatibility.
 *
 * The original numeralsUtilities.ts (976 lines) has been split into
 * focused modules under src/processing/ and src/rendering/.
 * This file re-exports all public symbols so existing imports continue to work.
 *
 * New code should import directly from the specific modules:
 *   - processing/scope: getScopeFromFrontmatter, addGlobalsFromScopeToPageCache, getMetadataForFileAtPath
 *   - processing/preprocessor: preProcessBlockForNumeralsDirectives, replaceStringsInTextFromMap
 *   - processing/evaluator: evaluateMathFromSourceStrings
 *   - rendering/orchestrator: processAndRenderNumeralsBlockFromSource, renderNumeralsBlock, renderError, handleResultInsertions, applyBlockStyles
 *   - rendering/linePreparation: prepareLineData, extractComment, cleanRawInput, renderComment
 *   - rendering/displayUtils: texCurrencyReplacement, unescapeSubscripts, mathjaxLoop, htmlToElements, getLocaleFormatter, defaultCurrencyMap
 */

// Processing
export { getScopeFromFrontmatter, addGlobalsFromScopeToPageCache, getMetadataForFileAtPath } from './processing/scope';
export type { ScopeResult } from './processing/scope';
export { preProcessBlockForNumeralsDirectives, replaceStringsInTextFromMap } from './processing/preprocessor';
export { evaluateMathFromSourceStrings } from './processing/evaluator';

// Rendering
export {
	processAndRenderNumeralsBlockFromSource,
	renderNumeralsBlock,
	renderError,
	handleResultInsertions,
	applyBlockStyles,
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
} from './rendering/orchestrator';
export { prepareLineData, extractComment, cleanRawInput, renderComment } from './rendering/linePreparation';
export {
	texCurrencyReplacement,
	unescapeSubscripts,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
	htmlToElements,
	mathjaxLoop,
	getLocaleFormatter,
	defaultCurrencyMap,
} from './rendering/displayUtils';
