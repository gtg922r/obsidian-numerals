import {
	CurrencyType,
	NumeralsLayout,
	NumeralsRenderStyle,
} from "./numerals.types";

export const PREVIOUS_VALUE_MAGIC_VARIABLE = "__prev";
export const ROLLING_TOTAL_MAGIC_VARIABLE = "__total";

export const RESULT_EMITTER_DIRECTIVE = "=>";
export const HIDE_ROWS_DIRECTIVE = "@hideRows";
export const CREATE_UNIT_DIRECTIVE = "@createUnit";

export const defaultCurrencyMap: CurrencyType[] = [
	{ symbol: "$", unicode: "x024", name: "dollar", currency: "USD" },
	{ symbol: "€", unicode: "x20AC", name: "euro", currency: "EUR" },
	{ symbol: "£", unicode: "x00A3", name: "pound", currency: "GBP" },
	{ symbol: "¥", unicode: "x00A5", name: "yen", currency: "JPY" },
	{ symbol: "₹", unicode: "x20B9", name: "rupee", currency: "INR" },
];

export const numeralsLayoutClasses = {
	[NumeralsLayout.TwoPanes]: "numerals-panes",
	[NumeralsLayout.AnswerRight]: "numerals-answer-right",
	[NumeralsLayout.AnswerBelow]: "numerals-answer-below",
	[NumeralsLayout.AnswerInline]: "numerals-answer-inline",
};

export const numeralsRenderStyleClasses = {
	[NumeralsRenderStyle.Plain]: "numerals-plain",
	[NumeralsRenderStyle.TeX]: "numerals-tex",
	[NumeralsRenderStyle.SyntaxHighlight]: "numerals-syntax",
};
