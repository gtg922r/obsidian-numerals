/** Pure processing utilities and snapshot presentation helpers.
 * Host source ownership, navigation and insertion live in src/host/.
 */

// Processing
export { getScopeFromFrontmatter, addGlobalsFromScopeToPageCache, getMetadataForFileAtPath, removeCanonicalizedDuplicates } from './processing/scope';
export type { ScopeResult } from './processing/scope';
export { preProcessBlockForNumeralsDirectives, replaceStringsInTextFromMap } from './processing/preprocessor';
export { evaluateMathFromSourceStrings } from './processing/evaluator';

// Rendering
export {
	renderNumeralsBlock,
	renderDiagnostic,
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
	getLocaleFormatter,
	defaultCurrencyMap,
} from './rendering/displayUtils';
