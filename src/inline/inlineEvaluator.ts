import { App } from 'obsidian';
import type { MathJsInstance } from 'mathjs';
import { getMathRuntime } from '../mathRuntime';
import { NumeralsScope, NumeralsSettings, StringReplaceMap, InlineEvaluationResult } from '../numerals.types';
import { normalizeExpression, replaceExpressionDirectives } from '../processing/preprocessor';
import { originalSource, scanExpression } from '../processing/expressionScanner';
import { createReferenceScope, evaluateWithReferences, restoreReferenceNames } from '../processing/referenceBindings';
import { resolveCrossNoteReferences, ReferenceEvaluationError, CrossNoteResolutionResult } from '../processing/crossNoteResolver';

export interface InlineEvaluationOptions {
	readonly runtime?: MathJsInstance;
	readonly resolution?: CrossNoteResolutionResult;
	/** The note session already owns an expression-local, stable scope. */
	readonly stableScope?: boolean;
	readonly onReferenceRead?: (name: string, value: unknown) => void;
	readonly beginRow?: (processed: string) => void;
	readonly borrowPrevious?: (value: unknown) => void;
	readonly commitRow?: (result: unknown) => void;
	readonly discardRow?: () => void;
}

/**
 * Evaluate a single inline expression against a scope.
 *
 * Applies preprocessors (currency symbols, thousands separators),
 * handles the `@prev` directive (substituted to `__prev`),
 * evaluates via mathjs, and returns the raw result. The scope is cloned
 * to prevent inline expressions from polluting the shared scope.
 *
 * @param expression - The math expression to evaluate (trigger prefix already stripped)
 * @param scope - Variable scope (note-globals + frontmatter)
 * @param preProcessors - String replacement rules (currency, thousands, etc.)
 * @param prevResult - The raw result of the previous inline expression (for @prev support).
 *                     Pass `undefined` when there is no previous result.
 * @param app - The Obsidian App instance (optional; required for cross-note references)
 * @param sourcePath - Path of the current file (optional; required for cross-note references)
 * @param settings - Numerals settings (optional; required for cross-note references)
 * @returns The raw mathjs value and evaluation metadata. Display formatting is
 * handled by the rendering layer.
 * @throws If mathjs cannot evaluate the expression, or @prev is used without a previous result
 */
export function evaluateInlineExpression(
	expression: string,
	scope: NumeralsScope,
	preProcessors: StringReplaceMap[],
	prevResult?: unknown,
	app?: App,
	sourcePath?: string,
	settings?: NumeralsSettings,
	options: InlineEvaluationOptions = {},
): InlineEvaluationResult {
	const runtime = options.runtime ?? getMathRuntime();
	const resolution: CrossNoteResolutionResult = options.resolution ?? (app && sourcePath && settings
		? resolveCrossNoteReferences(expression, app, sourcePath, settings, preProcessors, scope, runtime)
		: { resolvedSource: expression, sourceMap: originalSource(expression), bindings: new Map(), bindingNames: new Map(), referencedPaths: [], dependencies: [], warnings: [], error: null });
	const sourceMap = normalizeExpression(replaceExpressionDirectives(resolution.sourceMap, false), preProcessors);
	const processed = sourceMap.source;
	const localScope = options.stableScope ? scope : new NumeralsScope(scope);
	let result: unknown;
	let started = false;
	try {
		options.beginRow?.(processed);
		started = true;
		if (resolution.error) throw new Error(resolution.error);
		if (scanExpression(processed).some(t => t.kind === 'identifier' && t.text === '__prev')) {
			if (prevResult === undefined) throw new Error('Error evaluating @prev directive. There is no previous inline result.');
			if (options.borrowPrevious) options.borrowPrevious(prevResult);
			else localScope.set('__prev', prevResult);
		}
		result = evaluateWithReferences(processed, createReferenceScope(localScope, resolution.bindings, {
			runtime, onRead: options.onReferenceRead,
		}), resolution.bindings, runtime);
		if (result === undefined) throw new Error('Expression produced no result');
		options.commitRow?.(result);
	} catch (error: unknown) {
		if (started) options.discardRow?.();
		throw new ReferenceEvaluationError(error instanceof Error ? error.message : String(error), resolution, expression, sourceMap);
	}

	// Extract note-global ($-prefixed) variable assignments.
	// Compare the local scope against the original to find new or changed $-keys.
	const globals = new Map<string, unknown>();
	for (const [key, value] of options.stableScope ? [] : localScope.entries()) {
		if (key.startsWith('$') && value !== scope.get(key)) {
			globals.set(key, value);
		}
	}

	return { raw: result, processedExpression: restoreReferenceNames(processed, resolution.bindingNames), sourceMap, globals, referencedPaths: resolution.referencedPaths, dependencies: resolution.dependencies };
}
