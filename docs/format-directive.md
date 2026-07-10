# Format Directive

## Goal

Add a block-level Numerals directive that formats every displayed result in a math block with a chosen notation and precision, without changing math evaluation.

## Syntax

```
@format fixed [N]
@format exponential [N] | @format exp [N] | @format sci [N] | @format scientific [N]
@format engineering [N] | @format eng [N]
@decimalPlaces N | @decimalPlace N
```

Directive names and notation names are case-insensitive, and leading/trailing whitespace is allowed. `N` is an optional non-negative integer that sets the precision (significant digits for `exponential`/`engineering`, decimal places for `fixed`); when omitted, the mathjs default precision is used.

`@decimalPlaces N` / `@decimalPlace N` is a shorthand for `@format fixed N`. For that shorthand `N` is **required**.

The directive applies to the entire math block and is hidden from the rendered output. If a block contains multiple valid directives, the **last valid directive wins**.

## Notation mapping

| Directive name(s) | mathjs notation |
| --- | --- |
| `fixed` | `fixed` |
| `exponential`, `exp`, `sci`, `scientific` | `exponential` |
| `engineering`, `eng` | `engineering` |

## Behavior

- A valid directive line is removed from the source before mathjs evaluation, so it does not affect computation.
- Displayed results use `{ notation, precision }` derived from the directive (precision omitted when the directive omits `N`).
- The directive precedence for display precision is: **block `@format` > currency convention > global number-format setting**.
- Numeric units, including currency units, keep their meaning; pure currency results still render with their symbol or ISO code according to the **Currency result display** setting, but the directive's precision overrides the currency's conventional minor units. For example, `@format fixed 4` with `$100 / 3` renders `$33.3333` in symbol mode, and `@format fixed 2` with `¥1000 / 3` renders `¥333.33` (overriding JPY's zero-decimal convention).
- Result insertion (`@[name::value]`) uses the same block-level format when writing values back to the note. Inserted currency values keep the ISO-code form (e.g. `@format fixed 4` → `@[x::33.3333 USD]`) so stored values round-trip cleanly.
- Blocks without this directive keep the existing user-selected number-format behavior.
- Like other directive lines (e.g. `@createUnit`) and blank lines, a hidden `@format` row evaluates to nothing and therefore acts as a group boundary for `@sum` / `@total`. Placing the directive between summed lines resets the running group, so put `@format` at the top of the block (recommended) or outside any `@sum` group.

## Validation

Invalid directives are left as ordinary input so failures stay visible and explicit as a mathjs error. Examples that are **not** treated as directives:

- `@format bogus 2` (unknown notation)
- `@format fixed -1` (negative `N`)
- `@format fixed 1.5` (non-integer `N`)
- `@format fixed two` (non-numeric `N`)
- `@decimalPlaces` (missing required `N`)

If an earlier directive is invalid, a later valid directive in the same block is still recorded and applied.

## Inline Numerals

This directive is block-scoped only. Inline Numerals continue to use the configured global number format and do not read nearby block directives.

## Value-level rounding

`@format` only changes how results are displayed; it does not round the underlying values. To round a value in the computation itself, use mathjs `round`, e.g. `round($x / 8, 2, GBP)`.
