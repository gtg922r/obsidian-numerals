import { all, create, MathJsInstance } from 'mathjs';
export type * from 'mathjs';

// A private bootstrap supports standalone library consumers. Plugin load replaces
// it with the validated currency engine; no default mathjs registry is executed.
let current = create(all);

// All production runtime imports come through these live bindings. Arbitrary
// functions inside expressions remain available through create(all), unchanged.
export let add = current.add.bind(current);
export let bignumber = current.bignumber.bind(current);
export let clone = current.clone.bind(current);
export let evaluate = current.evaluate.bind(current);
export let format = current.format.bind(current);
export let isBigNumber = current.isBigNumber.bind(current);
export let isComplex = current.isComplex.bind(current);
export let isFraction = current.isFraction.bind(current);
export let isMatrix = current.isMatrix.bind(current);
export let isAccessorNode = current.isAccessorNode.bind(current);
export let isAssignmentNode = current.isAssignmentNode.bind(current);
export let isFunctionAssignmentNode = current.isFunctionAssignmentNode.bind(current);
export let isSymbolNode = current.isSymbolNode.bind(current);
export let isUnit = current.isUnit.bind(current);
export let number = current.number.bind(current);
export let parse = current.parse.bind(current);
export let unit = current.unit.bind(current);

export function getMathRuntime(): MathJsInstance { return current; }

/** Swap only fully prepared engines. This operation performs no I/O or parsing. */
export function activateMathRuntime(runtime: MathJsInstance): void {
	current = runtime;
	add = current.add.bind(current);
	bignumber = current.bignumber.bind(current);
	clone = current.clone.bind(current);
	evaluate = current.evaluate.bind(current);
	format = current.format.bind(current);
	isBigNumber = current.isBigNumber.bind(current);
	isComplex = current.isComplex.bind(current);
	isFraction = current.isFraction.bind(current);
	isMatrix = current.isMatrix.bind(current);
	isAccessorNode = current.isAccessorNode.bind(current);
	isAssignmentNode = current.isAssignmentNode.bind(current);
	isFunctionAssignmentNode = current.isFunctionAssignmentNode.bind(current);
	isSymbolNode = current.isSymbolNode.bind(current);
	isUnit = current.isUnit.bind(current);
	number = current.number.bind(current);
	parse = current.parse.bind(current);
	unit = current.unit.bind(current);
}

export function resetMathRuntime(): void { activateMathRuntime(create(all)); }

/** Keep settings usable while rejecting calculations from an invalid configuration. */
export function createUnavailableMathRuntime(message: string): MathJsInstance {
	const runtime = create(all);
	const unavailable = (): never => {
		const error = new Error(message);
		error.name = 'Currency configuration';
		throw error;
	};
	runtime.evaluate = unavailable;
	runtime.parse = Object.assign(unavailable, runtime.parse);
	return runtime;
}
