export function hasOwnProperty<T extends object>(
	obj: T,
	key: PropertyKey,
): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}
