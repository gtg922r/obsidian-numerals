# Currency Fixed Formatting Spec

## Goal

Pure currency results should display with exactly two decimal places by default, without changing how Numerals evaluates expressions. Examples:

- `$120` displays as `120.00 USD`
- `$120.1` displays as `120.10 USD`
- `$120.3499` displays as `120.35 USD`

This is result-formatting behavior only. Numerals still uses mathjs for evaluation and still creates mathjs units for configured currency codes.

## Detection

Currency fixed formatting applies only when the evaluated value is a mathjs `Unit` that is a pure configured currency:

- The result is a mathjs Unit.
- The Unit has exactly one unit component.
- The component power is `1`.
- The component unit name is one of the active currency codes Numerals created from the currency map.

Currency codes must come from the active Numerals currency configuration, including `$` and `¥` remappings and custom currency mappings. The formatter must not hard-code USD-only behavior.

## Compound Units

Compound currency units keep existing number-format behavior. Examples:

- `$100/hr`
- `$0.042/floz`
- `USD / m^2`

These values often represent rates where useful precision is not the same as money display precision. Formatting them to two fixed decimals by default could destroy information, so the helper should leave them to the selected Numerals number format.

## Shared Formatting Helper

Introduce a shared helper around `math.format`, for example:

```ts
formatNumeralsResult(value, numberFormat, currencyUnitNames)
```

The helper is responsible for:

- Detecting pure configured currency Units.
- Applying two fixed decimals only to pure currency Units.
- Delegating every other value to existing `math.format(value, numberFormat)` behavior.
- Preserving selected locale/grouping behavior when the active formatter provides it.

No mathjs internals should be monkey-patched for this formatting behavior.

## Rendering Surfaces

The shared helper should be used anywhere Numerals displays or writes evaluated results:

- Plain and syntax-highlight block rendering through the shared base renderer.
- Result insertion via `@[name::result]`.
- Inline Numerals in Reading mode and Live Preview via inline evaluation.
- TeX result rendering should use the same pure-currency numeric rounding before converting the result to TeX, while continuing to avoid locale grouping because the TeX path reparses the formatted result.

## Future Decimal-Place Directive

This feature is independent of any future `@decimalPlaces` directive. If that directive is added later, it should become an explicit display override. Until then, pure configured currency results default to two decimals, and non-currency or compound-unit results keep the current selected number-format behavior.
