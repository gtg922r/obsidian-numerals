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
