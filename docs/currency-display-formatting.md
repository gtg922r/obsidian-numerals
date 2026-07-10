# Currency Display Formatting

## Goal

Pure currency results should read like money: shown with the currency symbol and
the currency's conventional number of decimal places, without changing how
Numerals evaluates expressions. Examples (default settings):

- `$120` displays as `$120.00`
- `$120.1` displays as `$120.10`
- `$120.3499` displays as `$120.35`
- `100 GBP / 3` displays as `£33.33` (negative: `-£33.33`)
- `1234 JPY` displays as `¥1,234` (JPY has no minor units)

This is result-formatting behavior only. Numerals still uses mathjs for
evaluation and still creates mathjs units for configured currency codes. No
mathjs internals are monkey-patched for display.

## Display Context

All result formatting flows through a single `NumeralsDisplayContext`, built once
per render in `NumeralsPlugin.getDisplayContext()` and threaded through every
rendering surface:

```ts
interface NumeralsDisplayContext {
    numberFormat: mathjsFormat;        // resolved global number format
    hasExplicitFormat?: boolean;       // set by a future @format directive
    currencies: ReadonlyArray<CurrencyType>;  // active symbol ↔ code map
    currencyDisplay: CurrencyResultDisplay;   // Symbol (default) or CurrencyCode
}
```

`formatNumeralsResult(value, ctx)` is the single result → string chokepoint.

## Detection

Currency display formatting applies only when the evaluated value is a mathjs
`Unit` that is a pure configured currency (`getPureCurrencyInfo`):

- The result is a mathjs Unit.
- The Unit has exactly one unit component.
- The component power is `1`.
- The Unit's numeric value is a finite number (a valueless unit such as bare
  `USD` is skipped).
- The component unit name is one of the active currency codes Numerals created
  from the currency map.

Currency codes come from the active Numerals currency configuration, including
`$` and `¥` remappings and custom currency mappings — nothing is hard-coded to
USD.

## Minor Units

The conventional number of decimal places (minor units) for a currency is
resolved from the platform via `Intl.NumberFormat` and cached per code:

```ts
new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    .resolvedOptions().maximumFractionDigits
```

USD/GBP/EUR/INR resolve to 2, JPY resolves to 0. Codes that `Intl` cannot
resolve (e.g. custom non-ISO codes) fall back to 2.

## Display Modes

The **Currency result display** setting selects between two modes:

- **Currency symbol** (default): `$12.50`, `€120,00`, `¥1,234`. The symbol is
  prefixed and any negative sign stays outside it (`-£12.50`).
- **Currency code**: `12.50 USD` — the pre-existing ISO-code form.

The numeric part respects the selected number format's locale, so grouping and
decimal separators follow the locale (e.g. de-DE renders `€120,00`). Values are
rounded and padded to exactly the currency's minor-unit count.

## Compound Units

Compound currency units keep their existing number-format behavior — no symbol
restoration and no forced decimals. Examples:

- `$100/hr`
- `$0.042/floz`
- `USD / m^2`

These often represent rates where money-display precision would destroy
information, so they are left on the selected Numerals number format.

## Rendering Surfaces

The same context and helper are used everywhere Numerals displays or writes
results:

- **Block Plain / Syntax-highlight** rendering via the shared base renderer.
- **Inline Numerals** in Reading mode and Live Preview via inline evaluation.
- **TeX** result rendering. Pure currency bypasses the `math.parse(...).toTex()`
  reconstruction and is built directly: symbol mode → `\pound 12.50`
  (negative `-\pound 12.50`), code mode → `12.50~\mathrm{GBP}`. The numeric part
  uses an en-US, no-grouping formatter (a constraint of the TeX path) with the
  currency's conventional decimals.
- **Result insertion** via `@[name::value]`. Inserted text is a storage/data
  surface (round-tripped by Numerals and read by tools like Dataview), so it
  **always uses the ISO-code form** (`@[total::120.10 USD]`) regardless of the
  display setting. This keeps stored values unambiguous and avoids `$`
  replacement-pattern hazards in the write-back. Conventional decimals still
  apply.

## Explicit Format Override

`hasExplicitFormat` (reserved for a future block `@format` directive) suppresses
the currency-convention decimals while keeping symbol/code display. For example,
an explicit `fixed 4` format renders `100 USD / 3` as `$33.3333` — the directive
wins on precision, but the currency is still shown with its symbol.
