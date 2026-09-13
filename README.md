# Numerals

![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22numerals%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)
![GitHub release](https://img.shields.io/github/v/release/gtg922r/obsidian-numerals?color=%23483699)

**Numerals turns Obsidian notes into living calculations.** Use math blocks or inline expressions to calculate with units, currencies, variables, functions, frontmatter, Dataview metadata, and values from other notes.

| Channel | Availability |
| --- | --- |
| **Stable 1.10.2** | Available through Obsidian's Community Plugins browser. The guide below describes this [published release](https://github.com/gtg922r/obsidian-numerals/releases/tag/1.10.2). |
| **Recovery preview 1.11.0** | Under development for Obsidian **1.13+**. **Not yet published**, including through BRAT. See the [recovery usage guide](docs/usage.md). |

![Numerals Lemonade Stand - Side by Side](docs/images/Numerals-LemonadeStand-SideBySide.png)

## At a Glance

Examples use the default `$` → USD mapping and US English number formatting. Separators follow your selected number format.

| Feature | Example |
| --- | --- |
| Inline calculations | `` `#: 3ft * 4ft` `` -> `12 ft^2` |
| Show-your-work equations | `` `#=: 2 * (3ft + 4ft)` `` -> `2 * (3 ft + 4 ft) = 14 ft` |
| Full math blocks | <code>```math<br>20 mi / 4 hr to m/s<br>```</code> -> `2.235 m / s` |
| Units and conversions | `100 km/hr in mi/hr` -> `62.137 mi / hr` |
| Currency math | `$100/hr * 3 days` -> `7,200 USD` |
| Note-wide variables | `$rate = $150/hr`, then `` `#: $rate * 40hr` `` |
| Cross-note references | `[[Client Settings]].rates.hourly * 8hr` |
| Result insertion | `@[profit] = $2,400 - $850` becomes `@[profit::1,550 USD] = $2,400 - $850` |

## Quick Start

Add a `math` code block anywhere in a note:

````markdown
```math
revenue = $2,400
expenses = $850
profit = revenue - expenses =>
```
````

Or calculate directly in a sentence:

```markdown
The project total is `#: $150/hr * 8hr`.
```

Use equation mode when the calculation itself is important:

```markdown
The room perimeter is `#=: 2 * (12ft + 10ft)`.
```

## Stable Features

### Inline Calculations

Inline Numerals expressions are ordinary inline code with a trigger prefix:

| Syntax | Renders as | Best for |
| --- | --- | --- |
| `` `#: 3ft * 4ft` `` | `12 ft^2` | Showing just the answer |
| `` `#=: 3ft * 4ft` `` | `3 ft * 4 ft = 12 ft^2` | Showing the expression and answer |

Inline calculations work in Live Preview and Reading mode. They support the same math engine, number formatting, units, currency symbols, variables, frontmatter, and Dataview values as math blocks.

Both trigger prefixes and the equation separator are configurable in Numerals settings. Inline TeX triggers belong to the [unpublished recovery preview](#recovery-preview--not-yet-published); stable supports TeX rendering in math blocks.

### Math Blocks

Numerals math blocks are ideal for longer calculations:

````markdown
```math
# Lemonade stand
cups = 120
price = $1.50
revenue = cups * price
lemons = $18
sugar = $7
profit = revenue - lemons - sugar =>
```
````

Use `=>` to highlight important results. Lines without a highlighted result can be dimmed or hidden depending on your settings.

### Units, Currency, and Functions

Numerals uses [mathjs](https://mathjs.org/) for calculations and adds Obsidian-friendly preprocessing for currency symbols and readable number input.

| Type | Examples |
| --- | --- |
| Units | `1ft + 12in` -> `2 ft` |
| Conversions | `72 degF to degC` -> `22.222 degC` |
| Currency | `$1,000 * 2` -> `2,000 USD` |
| Rates | `$100/hr * 3 days` -> `7,200 USD` |
| Functions | `sqrt(144)`, `sin(pi/2)`, `log(1000, 10)` |
| Bases | `0xff + 0b100` -> `259` |
| Fractions | `fraction(1/3) + fraction(1/4)` -> `7/12` |

Currency symbols can be customized in settings. Numerals treats currencies as units: it does not fetch exchange rates or automatically convert between currencies.

### Note-Wide Variables

Prefix a variable or function with `$` to make it available across the whole note:

````markdown
```math
$rate = $150/hr
$discount(x) = x * 0.9
```

Estimate: `#: $rate * 40hr`
Discounted: `#: $discount($rate * 40hr)`
````

Note-wide variables work across math blocks and inline expressions.

### Previous Results

Use `@prev` to refer to the previous result:

````markdown
```math
base = 100
base * 1.2
@prev * 1.08
```
````

Inline expressions can use `@prev` too:

```markdown
First year: `#: 100 * 1.2`
Second year: `#: @prev * 1.08`
```

### Totals

Use `@total` or `@sum` to add previous results up to the last blank line or heading/comment:

````markdown
```math
$12
$18
$25
@total =>
```
````

### Frontmatter and Dataview Metadata

Frontmatter is opt-in by default. Select the note properties Numerals should read with the `numerals` property:

```markdown
---
numerals: [price, quantity]
price: 29.99
quantity: 150
---

`#=: price * quantity`
```

Use `numerals: all` to expose all frontmatter properties to Numerals. `$`-prefixed frontmatter values are automatically available as note-wide variables.

Dataview inline fields and metadata can also be used in calculations when Dataview is installed. Expose the desired fields with the same `numerals` property selection, or enable **Always process all frontmatter** in settings.

### Cross-Note References

Reference frontmatter and Dataview metadata from other notes with `[[note]].property`. In the referenced note, expose the needed properties with `numerals` too; for this example, `numerals: [rates, taxRate]`:

````markdown
```math
hours = 12 hr
subtotal = [[Client Settings]].rates.hourly * hours
tax = subtotal * [[Client Settings]].taxRate
total = subtotal + tax =>
```
````

Nested properties use dot notation:

```text
[[config]].rates.hourly
[[project/invoice]].lineItems.total
```

Cross-note references work in math blocks and inline expressions. When referenced metadata changes, Numerals rerenders dependent inline values.

### Result Insertion

Use `@[label]` to write a result back into the raw note as Dataview-style inline metadata:

````markdown
```math
@[profit] = $2,400 - $850
```
````

With US English number formatting, Numerals updates the value inside the label and keeps the assignment and expression:

````markdown
```math
@[profit::1,550 USD] = $2,400 - $850
```
````

### Auto-Complete

Auto-complete suggestions work in math blocks and inline Numerals expressions. Suggestions can include:

- Variables from the current block
- Note-wide `$` variables
- Frontmatter and Dataview metadata
- Cross-note properties after `[[note]].`
- mathjs functions and constants
- Greek letters by typing `:`, such as `:mu` -> `μ`

### Click to Edit in Live Preview

Rendered math blocks remain easy to edit. Click or tap a rendered Numerals line in Live Preview to focus the matching source line.

## Stable Display Options

Numerals is designed to fit naturally with Obsidian themes and supports multiple render styles.

### Render Style

Choose a default render style in settings, or set it per block:

| Block language | Style |
| --- | --- |
| `math` | Uses your configured default |
| `math-plain` | Plain text |
| `math-tex` | TeX-style rendering |
| `math-highlight` | Syntax-highlighted input |

![Numerals Render Style Side by Side](https://user-images.githubusercontent.com/1195174/201587645-5a79aafa-5008-49d0-b584-5c6a99c7edc5.png)

### Layouts

Choose how results appear next to calculations:

- **Two panes**: input and result in separate columns.
- **Answer to the right**: compact inline result display.
- **Answer below**: result appears on the next line.

![Numerals 2 Panes](https://user-images.githubusercontent.com/1195174/200186692-0b6a0a7b-3f77-47f8-887f-d7d333b53967.png)
![Numerals answer right](https://user-images.githubusercontent.com/1195174/200186885-dedf1ccb-0464-4732-976e-0eaf54f5d098.png)
![Numerals answer below](https://user-images.githubusercontent.com/1195174/200186929-8e5bf0de-ab1e-47d0-a3f3-cf5164136c62.png)

### Number Formatting

Configure how rendered numbers are displayed:

- **System formatted**: follows your local system separators.
- **Fixed**: full precision with no thousands separator.
- **Exponential**: scientific notation.
- **Engineering**: exponent is a multiple of 3.
- **Formatted**: choose a specific thousands/decimal style.

### Rounding Values

To round a calculated value in stable 1.10.2, use mathjs [`round`](https://mathjs.org/docs/reference/functions/round.html). For units and currencies, supply the unit as the third argument:

| Expression | Result |
| --- | --- |
| `round(123.456, 2)` | `123.46` |
| `round(3.241 cm, 1, cm)` | `3.2 cm` |
| `round(12.345 GBP, 2, GBP)` | `12.35 GBP` |

Rounding changes the value used by later calculations. Number formatting changes how a value is displayed.

### Currency Display in Stable

Stable 1.10.2 uses the general **Rendered number format** setting for currency results. It has no separate currency-precision or symbol-display control. For example, `$1,000 * 2` renders as `2,000 USD` with US English number formatting; stable does not automatically add two currency decimal places.

The **$ symbol currency mapping**, **¥ symbol currency mapping**, and **Custom currency mapping** settings select the units used for currency input. They do not fetch exchange rates.

## Installation

Install **Numerals** from Obsidian's Community Plugins browser for **stable 1.10.2**.

The 1.11.0 recovery candidate is **not yet published**. A future prerelease will be available for testing through [BRAT](https://github.com/TfTHacker/obsidian42-brat), with installation details in its [release notes](https://github.com/gtg922r/obsidian-numerals/releases). Installing BRAT today does not make these preview features available.

## Recovery Preview — Not Yet Published

The following features are being prepared for **1.11.0**, targeting **Obsidian 1.13+**. They are absent from Community Plugins stable 1.10.2. If you cannot find these settings in stable, you have not missed a setup step.

The [recovery usage guide](docs/usage.md) explains the intended rules for note-wide variables, grouping, metadata freshness and result insertion. Editor, rendering and suggestion integration is still in progress; this guide is not a claim that a published or fully validated candidate is available.

| Preview setting | Purpose |
| --- | --- |
| **Currency precision** | Use standard currency decimal places, or follow the general number format. |
| **Currency display** | Show a configured currency symbol or a currency code. |
| **Custom currency decimal places** | Choose precision for a custom currency mapping. |
| **TeX result trigger** | `#$:` renders an inline result with MathJax. |
| **TeX equation trigger** | `#$=:` renders an inline expression and result with MathJax. |

The recovery candidate defaults to **configured symbols**, including for upgrades without a saved display choice. A valid saved code/symbol preference is preserved. Currency-standard precision uses the currency's conventional decimal places; compound rates such as `GBP / hour` keep the general number format and code. Result insertion always writes currency codes, even when the displayed result uses a symbol.

The preview adds block-level `@format` and `@decimalPlaces` directives, inline TeX, and reliable top-to-bottom evaluation of successful note-wide variables. These changes remain under development. See the [usage guide](docs/usage.md) for examples and current limits.

## Development

Use **Node 24** (see `.nvmrc`) and **npm 11** for this recovery checkout:

```bash
npm ci
npm run check
```

`npm run check` runs lint, production/test/script typechecks, Jest, toolchain checks, a production build, symbol checks, reproducibility and candidate metadata validation. Use `npm run dev` for a local watch build. See the [toolchain contract](docs/recovery/toolchain.md) for details.

### Versioning

Candidate version commands such as `npm run version:patch` synchronize `package.json`, both lockfile version fields and the candidate manifest. They preserve `versions.json`. Use the next unused version for each published candidate; follow the [owner-only prerelease procedure](docs/recovery/toolchain.md#owner-only-prerelease-procedure).

This branch targets Obsidian 1.13+ for recovery. Master's stable 1.10.2 manifest, compatibility mappings and published assets remain unchanged.

### Mathjs Symbol Suggestions

Auto-complete suggestions for mathjs functions and constants are kept as a static list in `src/mathjsUtilities.ts`.

When upgrading `mathjs`, run:

```bash
npm run symbols:check
```

If the check finds intentional changes, run:

```bash
npm run symbols:update
```

Review the generated diff and adjust explicit exclusions in `scripts/mathjs-symbols.ts` for documented symbols that should not appear in suggestions.

### Releases

Only the owner publishes BRAT prereleases from the reviewed `chore/recovery-1.11` integration tip, using its [guarded release procedure](docs/recovery/toolchain.md#owner-only-prerelease-procedure). `npm run release:beta` performs the candidate checks before creating a new tag; do not use it from a feature checkout.

`npm run release` and `npm run release:production` are disabled. Production promotion, moving existing tags and replacing published assets are outside this recovery work. No 1.11.0 candidate has been published yet.

## Related

Other Obsidian calculation plugins may fit different workflows:

- [obsidian-calc](https://github.com/meld-cp/obsidian-calc) for calculator-style expression evaluation and result insertion.
- [obsidian-mathpad](https://github.com/Canna71/obsidian-mathpad) for a fuller computer algebra system inside Obsidian.

Numerals is also inspired by calculator-as-notes apps such as [Numi](https://numi.app/), [Numbr](https://numbr.dev/), and [Soulver](https://soulver.app/).
