import { NumeralsScope } from "../numerals.types";

/**
 * Add globals from a scope to the Numerals page cache.
 *
 * Globals are keys in the scope Map that start with `$`.
 */
export function addGlobalsFromScopeToPageCache(
	sourcePath: string,
	scope: NumeralsScope,
	scopeCache: Map<string, NumeralsScope>
): void {
	for (const [key, value] of scope.entries()) {
		if (!key.startsWith("$")) {
			continue;
		}

		if (scopeCache.has(sourcePath)) {
			scopeCache.get(sourcePath)?.set(key, value);
		} else {
			const newScope = new NumeralsScope();
			newScope.set(key, value);
			scopeCache.set(sourcePath, newScope);
		}
	}
}

/**
 * Backward-compatible alias kept for existing imports.
 * TODO: remove in next major version.
 */
export const addGobalsFromScopeToPageCache = addGlobalsFromScopeToPageCache;
