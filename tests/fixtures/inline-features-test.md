---
numerals: all
price: 29.99
quantity: 150
$tax: 0.085
$discount(x): x * 0.9
$radius: 6371
---

# Inline Numerals Feature Test

Each line shows the inline expression followed by **→ expected render**.

## Basic Arithmetic

### Result-only mode (`#:`)

- `#: 2 + 3` → **5**
- `#: 100 - 37` → **63**
- `#: 12 * 8` → **96**
- `#: 144 / 12` → **12**
- `#: 2^10` → **1024**
- `#: (3 + 4) * 2` → **14**
- `#: 17 mod 5` → **2**

### Equation mode (`#=:`)

- `#=: 2 + 3` → **2 + 3 = 5**
- `#=: 144 / 12` → **144 / 12 = 12**
- `#=: 2^10` → **2 ^ 10 = 1024**

## Units

- `#: 1 ft + 12 in` → **2 ft**
- `#: 5 kg to lb` → **11.023 lb**
- `#: 100 km/hr in mi/hr` → **62.137 mi / hr**
- `#: 20 mi / 4 hr to m/s` → **2.235 m / s**
- `#: 9.81 m/s^2 * 100 kg * 40 m` → **39.24 kJ**
- `#=: 3 ft in inches` → **3 ft in inches = 36 in**
- `#: 1 acre to m^2` → **4046.86 m^2**
- `#: 72 degF to degC` → **22.222 degC**

## Currency

- `#: $100 + $50` → **150 USD**
- `#: $25 * 4` → **100 USD**
- `#: £10 + £0.75` → **10.75 GBP**
- `#: $100/hr * 3 days` → **7,200 USD**
- `#=: $1,000 * 2` → **1000 USD * 2 = 2,000 USD**

## Math Functions

- `#: sqrt(144)` → **12**
- `#: abs(-42)` → **42**
- `#: round(3.7)` → **4**
- `#: ceil(3.2)` → **4**
- `#: floor(3.9)` → **3**
- `#: log(1000, 10)` → **3**
- `#: log2(256)` → **8**
- `#=: sin(pi/2)` → **sin(pi / 2) = 1**
- `#=: cos(0)` → **cos(0) = 1**
- `#: max(3, 7, 1, 9, 2)` → **9**
- `#: min(3, 7, 1, 9, 2)` → **1**
- `#: factorial(6)` → **720**

## Hex, Binary, Octal

- `#: 0xff` → **255**
- `#: 0b11001` → **25**
- `#: 0o77` → **63**
- `#: 0xff + 0b100` → **259**
- `#=: hex(255)` → **hex(255) = "0xff"**
- `#: bin(25)` → **"0b11001"**

## Natural Constants

- `#: pi` → **3.1416**
- `#: e` → **2.7183**
- `#=: e^(i*pi) + 1` → **e ^ (i * pi) + 1 = 0**
- `#: speedOfLight` → **2.998e+8 m / s**

## Fractions

- `#: fraction(1/3) + fraction(1/4)` → **7/12**
- `#=: fraction(3/7) * 2` → **fraction(3 / 7) * 2 = 6/7**

## Frontmatter Properties

- `#: price` → **29.99**
- `#: quantity` → **150**
- `#=: price * quantity` → **price * quantity = 4498.5**

## Note-Global Variables & Functions (from frontmatter)

- `#: $tax` → **0.085**
- `#=: price * $tax` → **price * $tax = 2.549**
- `#: $discount(100)` → **90**
- `#=: $discount(price)` → **$discount(price) = 26.991**

## Note-Global Variables (from math blocks)

```math
$tip = 0.20
$subtotal = $50
```

- `#: $subtotal` → **50 USD**
- `#=: $subtotal * $tip` → **$subtotal * $tip = 10 USD**
- `#=: $subtotal * (1 + $tax + $tip)` → **$subtotal * (1 + $tax + $tip) = 64.25 USD**

## Percentage & Large Numbers

- `#: 250 * 1.15` → **287.5**
- `#: 1e6 + 1` → **1000001**
- `#=: 2^32` → **2 ^ 32 = 4294967296**

## Greek Letters

```math
$μ = 3.5
$θ = pi / 4
```

- `#: $μ * 2` → **7**
- `#=: sin($θ)` → **sin($θ) = 0.7071**

## Formatting Context (Live Preview)

These test that formatting is preserved when inline code is nested:

- **`#: 42 * 2`** → bold **84**
- *`#: 42 * 2`* → italic *84*
- ==`#: 42 * 2`== → highlighted ==84==
- ~~`#: 42 * 2`~~ → strikethrough ~~84~~
- ***`#=: 1 + 1`*** → bold italic ***1 + 1 = 2***

## Error Handling

- `#: undefined_variable` → **red-tinted raw text: "undefined_variable"**
- `#: 1 / 0` → **Infinity**
- `#: sqrt(-1)` → **i** (complex number, not an error)

## Edge Cases

- `#: 0` → **0**
- `#: -5` → **-5**
- `#:3+2` → **5** (no space after trigger)
- `#=:3+2` → **3 + 2 = 5** (no space after trigger)
- Regular inline code stays unchanged: `const x = 5`
- Dataview inline stays unchanged: `= date(today)`
