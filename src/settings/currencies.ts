import type { CurrencyType, StringReplaceMap } from '../numerals.types';

export const defaultCurrencyMap: CurrencyType[] = [
	{ symbol: '$', unicode: 'x0024', name: 'dollar', currency: 'USD' },
	{ symbol: '€', unicode: 'x20AC', name: 'euro', currency: 'EUR' },
	{ symbol: '£', unicode: 'x00A3', name: 'pound', currency: 'GBP' },
	{ symbol: '¥', unicode: 'x00A5', name: 'yen', currency: 'JPY' },
	{ symbol: '₹', unicode: 'x20B9', name: 'rupee', currency: 'INR' },
];

export const currencyCodesForDollarSign: {[key:string]: string} = {
	ARS: "Argentine peso",
	AUD: "Australian dollar",
    BBD: "Barbadian dollar",
    BMD: "Bermudian dollar",
    BND: "Brunei dollar",
    BSD: "Bahamian dollar",
	BZD: "Belize dollar",
    CAD: "Canadian dollar",
	CLP: "Chilean peso",
	COP: "Colombian peso",
    FJD: "Fijian dollar",
    GYD: "Guyanese dollar",
    HKD: "Hong Kong dollar",
    JMD: "Jamaican dollar",
    KYD: "Cayman Islands dollar",
    LRD: "Liberian dollar",
    MXN: "Mexican peso",
    NAD: "Namibian dollar",
    NZD: "New Zealand dollar",
    SBD: "Solomon Islands dollar",
    SGD: "Singapore dollar",
    SRD: "Surinamese dollar",
    TTD: "Trinidad and Tobago dollar",
    TWD: "New Taiwan dollar",
    USD: "United States dollar",
	UYU: "Uruguayan peso",
    XCD: "East Caribbean dollar",
};

export const currencyCodesForYenSign: {[key:string]: string} = {
    JPY: "Japanese yen",
    CNY: "Chinese yuan",
    KRW: "Korean won",
};


/** Shared with the plugin and scanner integration fixtures; metadata owns currency edits. */
export function createCurrencyPreProcessors(mappings: readonly CurrencyType[]): StringReplaceMap[] {
	return mappings.map(mapping => ({
		currencySymbol: mapping.symbol,
		currencyCode: mapping.currency,
		regex: new RegExp(mapping.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\d\\.]+)', 'g'),
		replaceStr: '$1 ' + mapping.currency,
	}));
}
