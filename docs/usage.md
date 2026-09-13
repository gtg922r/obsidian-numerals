# Recovery usage guide

**Target: Numerals 1.11.0, Obsidian 1.13+. Not yet published, including through BRAT.** This guide describes the accepted recovery behavior being developed. The candidate still awaits installed validation and publication; a source checkout is not a verified installed candidate. Community Plugins currently installs **1.10.2**; use the [stable guide](../README.md#stable-features) for that release.

## Start with a calculation

Use a `math` block for several calculations, or inline code beginning with `#:` for one answer:

````markdown
```math
hours = 8 hr
rate = $150/hr
hours * rate =>
```

Floor area: `#: 3ft * 4ft`
````

With the default `$` → USD mapping and US English formatting, the highlighted result is `$1,200.00`; the inline answer is `12 ft^2`. `#=:` shows the expression and answer. The preview also supports `#$:` for a MathJax answer and `#$=:` for a MathJax equation. Empty trigger settings disable their mode; overlapping prefixes use the longest match, and exact duplicate nonempty triggers are rejected.

Mathjs supplies arithmetic, functions and units. `1ft + 12in` is `2 ft`; `72 degF to degC` converts temperature. Numerals does not fetch exchange rates or automatically convert one currency into another.

## Calculate from top to bottom

Calculations follow their positions in the complete note, including definitions outside the viewport and expressions whose source is selected for editing:

````markdown
```math
$rate = 10
```

First estimate: `#: $rate * 2`

```math
$rate = 15
```

Revised estimate: `#: $rate * 2`
````

The answers are **20**, then **30**. A successful `$` assignment becomes available to later calculations; the latest preceding assignment wins. A reference before its definition is an error—there is no second pass to fill it in. Editing or deleting a definition starts a fresh calculation from the current source and metadata; old globals and functions do not linger.

Ordinary variables are local to their math block. An ordinary assignment inside inline code is local to that one expression. A `$` function keeps the ordinary locals of the block where it was defined, while its `$` references see the latest preceding successful globals.

An error stops the rest of its block. Earlier successful rows and their globals remain available to subsequent calculations. New or replaced bindings from the failed row are discarded. Advanced native object mutations and engine effects are not fully rolled back; see the [evaluation contract](recovery/plan.md#source-and-evaluation-contracts).

Scrolling, selecting source, or changing display formatting should only change presentation, without running the math again. Source, metadata, dependencies, or calculation settings changes require a new calculation. These are recovery integration requirements, not guarantees of stable 1.10.2.

## Previous results and totals

Inline `@prev` follows the previous successful inline expression across the full note, even with a math block between the two:

```markdown
First year: `#: 100 * 1.2`
Second year: `#: @prev * 1.08`
```

These produce **120**, then **129.6**. An inline error clears this chain: another `@prev` is an error until a later inline expression succeeds. Math blocks have their own `@prev`; block results do not replace the inline previous result.

Within a math block, `@total` and `@sum` add previous row results since the last blank line or standalone `#` heading/comment:

````markdown
```math
$12
$18
$25
@total =>
```
````

This gives **$55.00** with default currency settings. Sum only compatible values—metres and dollars cannot be added. Each successful result joins the total, so a subtotal followed by another `@total` also contributes to that later total; use a blank line to begin a new section. A blank or comment-only row has no result for the block's `@prev`. Formatting directives do not reset the previous-result or total chains. An end-of-line comment preserves the calculation on that line.

## Commas, strings and units

Use ungrouped numbers inside function arguments, arrays and indexes. Commas there remain mathjs separators, including inside grouping parentheses nested in those contexts:

| Input | Meaning |
| --- | --- |
| `max(1,234)` | Two arguments; returns `234`. |
| `[1,234]` | Two elements, `1` and `234`. |
| `max(1234, 5)` | One thousand two hundred thirty-four compared with five. |
| `1,234.50 + 2` | A grouped number at top level; returns `1,236.5` in US English formatting. |
| `max($1,234.50, $2)` | Two explicit currency amounts; displays `$1,234.50`. |

Complete grouped numbers also work inside ordinary grouping parentheses outside a call or list. An explicit configured currency prefix identifies one amount even within a call/list. A suffix does not change comma meaning: `[1,234$]` still has two elements. Malformed grouping such as top-level `1,0001` is left for mathjs to reject rather than silently becoming `10001`. In `max(1,0001)`, the comma is an argument separator, and mathjs reads `0001` as one.

Strings and `#` comments keep their literal commas and directive text. Native quoted unit expressions such as `unit("1$")` still use the configured currency aliases. See the [expression contract](recovery/expression-contracts.md) for detailed input rules. There is no new custom-unit declaration feature in this recovery; repeated native `createUnit` declarations can still report collisions.

## Format a result or round a value

For presentation within one block:

````markdown
```math
@format comma-period
@decimalPlaces 2
third = 1 / 3
third * 3
```
````

The results display as **0.33** and **1.00**. Formatting does not round `third` in calculation scope. It also controls the text saved by result insertion, so a stored result is not a full-precision backup of the raw value.

`@format` accepts `system`, `fixed`, `exponential` (or `scientific`), `engineering`, `comma-period`, `period-comma`, `space-comma`, and `indian`. `@decimalPlaces` accepts 0–20; `@decimalPlace` is an alias. Neither directive is available in stable 1.10.2.

To change the calculated value, use native mathjs [`round`](https://mathjs.org/docs/reference/functions/round.html). Units and currencies need the unit as the third argument:

| Expression | Value |
| --- | --- |
| `round(123.456, 2)` | `123.46` |
| `round(3.241 cm, 1, cm)` | `3.2 cm` |
| `round(12.345 GBP, 2, GBP)` | `12.35 GBP`, displayed as `£12.35` with default recovery settings. |

Recovery defaults to **configured currency symbols** when no valid display preference is saved, including on upgrade. A valid saved code/symbol choice is preserved. **Currency standard** precision uses conventional decimal places; **Custom currency decimal places** controls a custom mapping. Choose **Use rendered number format** to follow general formatting instead. Block `@decimalPlaces` takes precedence. Compound rates such as `GBP / hour` keep their code and general number format.

Currency mapping edits use **Save**, **Cancel**, or **Remove mapping**. A failed Save leaves the active mapping unchanged. Invalid saved mappings remain visible with repair guidance and block calculation until corrected or removed. See the [settings and currency contract](recovery/settings-currency.md).

## Read note metadata

Frontmatter is opt-in, except for `$`-prefixed properties, which seed note-wide variables. Select properties with `numerals: price`, `numerals: [price, quantity]`, or `numerals: all`. `numerals: none` excludes ordinary properties. **Always process all frontmatter** is the fallback for notes without a `numerals` selection.

```markdown
---
numerals: [price, quantity]
price: 29.99
quantity: 150
---

Total: `#: price * quantity`
```

The current note's source properties take precedence over cached metadata. Deleted properties cannot return from an older Dataview page. When Dataview is installed, eligible inline fields can supplement those properties under the same selection policy. Repeated-field arrays use their last entry; a quoted mathjs expression such as `"[1,234]"` produces a two-element matrix instead.

Dataview may lag behind an editor buffer. Native inputs remain available while it catches up. A result using an unverified Dataview value may be displayed with a freshness diagnostic but cannot automatically write into the note. Unrelated constant or native-only results remain eligible. Ambiguous cached fields are withheld with guidance instead of restoring old values. A timestamp or metadata event alone does not prove the displayed value matches the current buffer.

For another note, expose the property in that note, then use `[[note]].property`:

````markdown
```math
subtotal = [[Client Settings]].rates.hourly * 8 hr
```
````

Here `Client Settings` needs `numerals: rates` (or a broader selection). Nested properties use dot notation. References preserve supported mathjs values rather than inserting formatted text into the expression: if `[[numbers]].value` is `-2`, `[[numbers]].value ^ 2` is **4**. References cannot be assigned to and do not import another note's computed `$` globals or functions. An embedded note likewise keeps its own calculations and globals; it does not export them into the surrounding note.

## Write a result into the source

`@[label]` stores a formatted result inside its wrapper while retaining the calculation:

````markdown
```math
@[profit] = $2,400 - $850
```
````

With default recovery currency settings, the displayed answer is **$1,550.00**, and the resulting source is:

````markdown
```math
@[profit::1550.00 USD] = $2,400 - $850
```
````

Currency insertion uses codes even when display uses symbols. Stored text follows the formatter's canonical output, including its selected precision; it does not change the raw value used by later calculations. Existing wrapper contents are replaced without dropping the assignment, expression, comments or surrounding Markdown.

Recovery insertion must verify the originating editor, current note text, result and required metadata before one edit. If the source has changed, the result is stale, metadata is unverified, or the source position is ambiguous, the note stays unchanged. A rendered embed or another pane is not permission to write through an unrelated editor. No background vault writes are used. This guarded editor integration remains in development; see the [source safety contract](recovery/plan.md#host-lifecycle-and-source-safety).

## Markdown limits

Use matched backticks for inline calculations and close fenced blocks. Standard list, quote, callout and footnote containers are indexed in physical note order; a relocated footnote does not move its calculation in that order. An embed displays calculations from its target note's complete source, not a fragment evaluated in the surrounding note's scope.

Incomplete inline code never evaluates or exports variables. Unclosed frontmatter and Obsidian comments remain excluded. Ambiguous quoted fences or tab-indented containers can withhold all calculations in the note with a diagnostic; close the fence and use spaces for indentation. Content in code opened before a comment marker stays literal code. Raw HTML code elements are not Numerals Markdown expressions. These conservative boundaries avoid calculations appearing out of malformed or hidden source.

Compatibility still requires installed-candidate validation across supported surfaces and platforms. This guide does not claim that Node tests or a source checkout establish that coverage. The [recovery plan](recovery/plan.md) records the acceptance boundaries and remaining work.


## Complete an expression

Block and inline suggestions have separate settings. Turning off **Suggest in math blocks** leaves inline suggestions available when inline calculations and their suggestions are enabled. **Include functions and constants** adds built-ins such as `sqrt()`; **Suggest Greek characters** completes names such as `:alpha` to `α`.

Completions work before an existing closing backtick and while an inline span is unfinished. For example, accepting `sqrt()` in `` `#: sq` `` replaces only `sq`, preserves the closing backtick, and places the cursor inside the parentheses. An unfinished span stays unfinished until you type its closer. Inline `@prev` follows the preceding inline calculation; block-only directives are not offered inline.

Variable suggestions use successful preceding definitions and the current calculation's local names. Referenced-note properties respect metadata opt-in. A source, settings or metadata change can close an outdated list; type again to get current suggestions. Selecting an old item after moving the cursor or changing notes leaves the source unchanged. Completion edits do not renew automatic stored-result insertion.

Inline errors keep the expression and a visible reason together. Repairing the expression or its reference refreshes the result. These behaviors are covered by automated source and DOM tests; installed keyboard and accessibility validation remains separate.
