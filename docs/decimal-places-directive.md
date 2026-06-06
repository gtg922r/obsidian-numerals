# Decimal Places Directive

## Goal

Add a block-level Numerals directive that formats displayed block results with a fixed number of decimal places without changing math evaluation.

## Syntax

- `@decimalPlaces N`
- `@decimalPlace N`

`N` must be a non-negative integer. Leading and trailing whitespace are allowed. The directive applies to the entire math block and is hidden from rendered output.
If a block contains multiple valid decimal-place directives, the last valid directive wins.

## Behavior

- A valid directive removes its source line before mathjs evaluation.
- Displayed results use the active block number format with an override of `notation: "fixed"` and `precision: N`.
- Numeric units, including currency units such as `USD`, keep their unit suffix and use the requested decimal count for the numeric value.
- Result insertion (`@[name::value]`) uses the same block-level decimal formatting when writing values back to the note.
- Blocks without this directive keep the existing user-selected number format behavior.

## Validation

Invalid directives are ignored as ordinary input so failures stay visible and explicit. Examples include `@decimalPlaces`, `@decimalPlaces -1`, `@decimalPlaces 1.5`, and `@decimalPlaces two`.

## Inline Numerals

This directive is block-scoped only. Inline Numerals continue to use the configured global number format and do not read nearby block directives.

## Future Currency Formatting

This directive only sets fixed decimal places for the block. It does not add currency-specific default decimal behavior, currency rounding rules, or automatic two-decimal currency formatting.
