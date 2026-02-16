/**
 * Inline Numerals module.
 *
 * Provides parsing, evaluation, and rendering of inline math expressions
 * triggered by prefix strings in inline code spans.
 *
 * - `inlineParser.ts`         — Trigger detection and expression extraction
 * - `inlineEvaluator.ts`      — Single-expression evaluation with scope and formatting
 * - `inlinePostProcessor.ts`  — Reading mode rendering via MarkdownPostProcessor
 * - `inlineLivePreview.ts`    — Live Preview rendering via CM6 ViewPlugin
 */

export { parseInlineExpression } from './inlineParser';
export { evaluateInlineExpression } from './inlineEvaluator';
export { createInlineNumeralsPostProcessor } from './inlinePostProcessor';
export { createInlineLivePreviewExtension, InlineNumeralsWidget } from './inlineLivePreview';
