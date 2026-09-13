/** Private mathematical-input provenance, separate from the value or its display. */
export interface ValueProvenance {
	readonly unverified: readonly string[];
	readonly ambiguous: boolean;
}

export const VERIFIED_PROVENANCE: ValueProvenance = Object.freeze({
	unverified: Object.freeze([] as string[]), ambiguous: false,
});

/** Own the input arrays and use stable ordering when recording a row/checkpoint. */
export function mergeProvenance(...values: readonly ValueProvenance[]): ValueProvenance {
	const unverified = [...new Set(values.flatMap(value => value.unverified))].sort();
	const ambiguous = values.some(value => value.ambiguous);
	return unverified.length || ambiguous
		? Object.freeze({ unverified: Object.freeze(unverified), ambiguous })
		: VERIFIED_PROVENANCE;
}

export function isVerifiedProvenance(value: ValueProvenance): boolean {
	return !value.ambiguous && value.unverified.length === 0;
}
