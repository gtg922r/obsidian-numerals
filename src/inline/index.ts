/**
 * Inline Numerals module.
 *
 * Provides parsing, evaluation, and rendering of inline math expressions
 * triggered by prefix strings in inline code spans.
 */
export { parseInlineExpression } from './inlineParser';
export { evaluateInlineExpression } from './inlineEvaluator';
export { createInlineNumeralsPostProcessor } from './inlinePostProcessor';
