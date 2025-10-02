/****************************************************
 * Settings Related Types and Interfaces
 ****************************************************/

export enum NumeralsLayout { 
	TwoPanes = "TwoPanes",
	AnswerRight = "AnswerRight",
	AnswerBelow = "AnswerBelow",
	AnswerInline = "AnswerInline",
}

export enum NumeralsRenderStyle {
	Plain = "Plain",
	TeX ="TeX",
	SyntaxHighlight = "SyntaxHighlight",
}

export enum NumeralsNumberFormat {
	System = "System",
	Fixed = "Fixed",	
	Exponential = "Exponential",
	Engineering = "Engineering",
	Format_CommaThousands_PeriodDecimal = "Format_CommaThousands_PeriodDecimal",
	Format_PeriodThousands_CommaDecimal = "Format_PeriodThousands_CommaDecimal",
	Format_SpaceThousands_CommaDecimal = "Format_SpaceThousands_CommaDecimal",
	Format_Indian = "Format_Indian"
}

interface CurrencySymbolMapping {
	symbol: string;
	currency: string; // ISO 4217 Currency Code
}

export interface NumeralsSettings {
	resultSeparator: string;
	layoutStyle: NumeralsLayout;
	alternateRowColor: boolean;
	defaultRenderStyle: NumeralsRenderStyle;
	hideLinesWithoutMarkupWhenEmitting: boolean; // "Emitting" is "result annotation"
	hideEmitterMarkupInInput: boolean;
	dollarSymbolCurrency: CurrencySymbolMapping;
	yenSymbolCurrency: CurrencySymbolMapping;
	provideSuggestions: boolean;
	suggestionsIncludeMathjsSymbols: boolean;
	numberFormat: NumeralsNumberFormat;
	forceProcessAllFrontmatter: boolean;
	customCurrencySymbol: CurrencyType | null;
	enableGreekAutoComplete: boolean; 
}


export const DEFAULT_SETTINGS: NumeralsSettings = {
	resultSeparator: 					" → ",
	layoutStyle:						NumeralsLayout.TwoPanes,
	alternateRowColor: 					true,
	defaultRenderStyle: 				NumeralsRenderStyle.Plain,
	hideLinesWithoutMarkupWhenEmitting:	true,
	hideEmitterMarkupInInput: 			true,
	dollarSymbolCurrency: 				{symbol: "$", currency: "USD"},
	yenSymbolCurrency: 					{symbol: "¥", currency: "JPY"},
	provideSuggestions: 				true,
	suggestionsIncludeMathjsSymbols: 	false,
	numberFormat: 						NumeralsNumberFormat.System,
	forceProcessAllFrontmatter: 		false,
	customCurrencySymbol: 				null,
	enableGreekAutoComplete: 			true, 
}


export interface CurrencyType {
	symbol: string;
	unicode: string;
	name: string;
	currency: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type mathjsFormat = number | math.FormatOptions | ((item: any) => string) | undefined;

export class NumeralsScope extends Map<string, unknown>{}

export type numeralsBlockInfo = {
	emitter_lines: number[];
	insertion_lines: number[];
	hidden_lines: number[];
	shouldHideNonEmitterLines: boolean;
}

/****************************************************
 * Rendering Pipeline Types
 ****************************************************/

/**
 * Result of preprocessing a Numerals block source string.
 * Contains both the raw input lines and the processed source ready for evaluation.
 */
export interface ProcessedBlock {
	/** Original source lines split by newline, unmodified */
	rawRows: string[];
	/** Processed source string with directives replaced, ready for mathjs evaluation */
	processedSource: string;
	/** Metadata about special lines (emitters, insertions, etc.) */
	blockInfo: numeralsBlockInfo;
}

/**
 * Result of evaluating a processed Numerals block.
 * Contains the evaluated results, inputs, and any error information.
 */
export interface EvaluationResult {
	/** Array of evaluated results for each line (may include undefined for empty/comment lines) */
	results: unknown[];
	/** Array of processed input strings that were successfully evaluated */
	inputs: string[];
	/** Error object if evaluation failed, null otherwise */
	errorMsg: Error | null;
	/** The input line that caused the error, empty string if no error */
	errorInput: string;
}

/**
 * Prepared data for rendering a single line in a Numerals block.
 * This is an intermediate data structure between evaluation and rendering.
 */
export interface LineRenderData {
	/** Zero-based index of the line in the block */
	index: number;
	/** Raw input text from the original source (may include directives) */
	rawInput: string;
	/** Processed input text (directives replaced, ready for display) */
	processedInput: string;
	/** Evaluated result for this line (undefined for empty/comment lines) */
	result: unknown;
	/** True if this line has no result (empty or comment only) */
	isEmpty: boolean;
	/** True if this line has the result annotation marker (=>) */
	isEmitter: boolean;
	/** True if this line should be hidden from display */
	isHidden: boolean;
	/** Extracted inline comment (without #), null if no comment */
	comment: string | null;
}

/**
 * Context information needed for rendering a Numerals block.
 * Contains settings and configuration that affect how content is rendered.
 */
export interface RenderContext {
	/** The rendering style to use (Plain, TeX, or SyntaxHighlight) */
	renderStyle: NumeralsRenderStyle;
	/** User settings affecting display and formatting */
	settings: NumeralsSettings;
	/** Number formatting configuration for displaying results */
	numberFormat: mathjsFormat;
	/** String replacements to apply (e.g., currency symbols) */
	preProcessors: StringReplaceMap[];
}

/**
 * Interface for string replacement operations.
 * Used in preprocessing to replace patterns like currency symbols.
 */
export interface StringReplaceMap {
	/** Regular expression to match */
	regex: RegExp;
	/** String to replace matches with */
	replaceStr: string;
}
