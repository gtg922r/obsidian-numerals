---
$price: 100 USD
$quantity: 5
$taxRate: 0.08
$apples: 10
$discount: 0.15
$shippingCost: 25 USD
---

# Comprehensive Inline Math Expression Test Suite

This file tests ALL features of the inline math expression system in both Reading Mode and Live Preview Mode.

## Setup

We have a code block that defines some page-global variables:

```math
$length = 10
$width = 5
$height = 3
$area = $length * $width
$volume = $area * $height
```

**Expected Variables:**
- From frontmatter: `$price`, `$quantity`, `$taxRate`, `$apples`, `$discount`, `$shippingCost`
- From code block: `$length`, `$width`, `$height`, `$area`, `$volume`

---

## 1. Basic Arithmetic

Simple calculations without variables:

- Addition: `mathexpr: 5 + 3` → **8**
- Subtraction: `mathexpr: 10 - 4` → **6**
- Multiplication: `mathexpr: 7 * 6` → **42**
- Division: `mathexpr: 100 / 4` → **25**
- Exponentiation: `mathexpr: 2^10` → **1024**
- Modulo: `mathexpr: 17 % 5` → **2**
- Complex: `mathexpr: (5 + 3) * 2 - 4 / 2` → **14**

---

## 2. Math Functions

Standard mathematical functions:

- Square root: `mathexpr: sqrt(64)` → **8**
- Cube root: `mathexpr: cbrt(27)` → **3**
- Absolute value: `mathexpr: abs(-42)` → **42**
- Ceiling: `mathexpr: ceil(4.3)` → **5**
- Floor: `mathexpr: floor(4.7)` → **4**
- Rounding: `mathexpr: round(4.567, 2)` → **4.57**
- Power: `mathexpr: pow(2, 8)` → **256**
- Sign: `mathexpr: sign(-15)` → **-1**

---

## 3. Trigonometric Functions

Using pi constant:

- Sine: `mathexpr: sin(pi/2)` → **1**
- Cosine: `mathexpr: cos(pi)` → **-1**
- Tangent: `mathexpr: tan(pi/4)` → **1** (approximately)
- Arc sine: `mathexpr: asin(1)` → **1.5707963267948966** (π/2)
- Arc cosine: `mathexpr: acos(0)` → **1.5707963267948966** (π/2)
- Arc tangent: `mathexpr: atan(1)` → **0.7853981633974483** (π/4)

---

## 4. Logarithmic Functions

- Natural log: `mathexpr: log(e)` → **1**
- Log base 10: `mathexpr: log10(100)` → **2**
- Log base 2: `mathexpr: log2(256)` → **8**
- Custom base: `mathexpr: log(1000, 10)` → **3**
- Exponential: `mathexpr: exp(1)` → **2.718281828459045** (e)

---

## 5. Constants

Built-in mathematical and physical constants:

- Euler's number: `mathexpr: e` → **2.718281828459045**
- Pi: `mathexpr: pi` → **3.141592653589793**
- Tau (2π): `mathexpr: tau` → **6.283185307179586**
- Golden ratio: `mathexpr: phi` → **1.618033988749895**
- Infinity: `mathexpr: 1 / 0` → **Infinity**
- Speed of light: `mathexpr: speedOfLight` → **299792458 m / s**
- Avogadro: `mathexpr: avogadro` → **6.02214076e+23 / mol**
- Planck constant: `mathexpr: planckConstant` → **6.62607015e-34 J s**

---

## 6. Units - Length

Unit conversions and calculations:

- Simple addition: `mathexpr: 5 m + 3 m` → **8 m**
- Mixed units: `mathexpr: 1 ft + 12 in` → **2 ft**
- Conversion: `mathexpr: 1 km to m` → **1000 m**
- Conversion: `mathexpr: 100 mi to km` → **160.9344 km**
- Multiplication: `mathexpr: 5 m * 3` → **15 m**
- Area calculation: `mathexpr: 5 m * 3 m` → **15 m^2**
- Area with to: `mathexpr: 5 m * 3 m to ft^2` → **161.4586 ft^2** (approx)

---

## 7. Units - Speed and Velocity

- Speed conversion: `mathexpr: 100 km/hr to mi/hr` → **62.1371 mi / hr** (approx)
- Speed conversion: `mathexpr: 60 mi/hr to m/s` → **26.8224 m / s**
- Complex calculation: `mathexpr: 20 mi / 4 hr to m/s` → **2.2352 m / s**
- Distance formula: `mathexpr: 50 mi/hr * 2.5 hr` → **125 mi**

---

## 8. Units - Force and Energy

- Force: `mathexpr: 9.81 m/s^2 * 100 kg` → **981 N** (Newton)
- Energy: `mathexpr: 9.81 m/s^2 * 100 kg * 40 m` → **39240 J** (Joules)
- Power: `mathexpr: 1000 J / 2 s` → **500 W** (Watts)
- Pressure: `mathexpr: 100 N / 2 m^2` → **50 Pa** (Pascals)

---

## 9. Currency

Currency calculations (all show as USD in output):

- Simple: `mathexpr: 1000 USD * 2` → **2000 USD**
- Addition: `mathexpr: 100 USD + 50 USD` → **150 USD**
- Subtraction: `mathexpr: 1000 USD - 250 USD` → **750 USD**
- Rate calculation: `mathexpr: 100 USD/hr * 8 hr` → **800 USD**
- Time calculation: `mathexpr: 100 USD/hr * 3 days` → **7200 USD** (24hr/day)
- With decimals: `mathexpr: 10 GBP + 0.75 GBP` → **10.75 GBP**

---

## 10. Hex, Binary, and Octal

Different number bases:

- Hex addition: `mathexpr: 0xff + 0x10` → **271** (255 + 16)
- Binary addition: `mathexpr: 0b1111 + 0b1` → **16** (15 + 1)
- Mixed: `mathexpr: 0xff + 0b100` → **259** (255 + 4)
- To hex: `mathexpr: hex(255)` → **0xff**
- To hex (calc): `mathexpr: hex(0xff + 0b100)` → **0x103**
- To binary: `mathexpr: bin(15)` → **0b1111**
- To octal: `mathexpr: oct(64)` → **0o100**

---

## 11. Greek Letters

Greek letters initialized to 0, can be overridden:

**Default values (0):**
- Mu times 2: `mathexpr: μ * 2` → **0** (μ defaults to 0)
- Alpha plus beta: `mathexpr: α + β` → **0** (both default to 0)
- Greek combo: `mathexpr: γ + δ + ε` → **0** (all default to 0)

**After assignment in a code block:**

```math
μ = 5
α = 10
β = 20
```

Now the same expressions will use the assigned values:
- Mu times 2: `mathexpr: μ * 2` → **10** (μ is now 5)
- Alpha plus beta: `mathexpr: α + β` → **30** (α=10, β=20)
- Complex: `mathexpr: (α + β) / μ` → **6** ((10+20)/5)

**Capital Greek letters:**
- Delta: `mathexpr: Δ + 1` → **1** (Δ defaults to 0)
- Sigma sum concept: `mathexpr: Σ * 3` → **0** (Σ defaults to 0)

---

## 12. Fractions

Working with fractions:

- Create fraction: `mathexpr: fraction(1/3)` → **0.3333...** or **1/3**
- Add fractions: `mathexpr: fraction(1/3) + fraction(1/4)` → **7/12**
- Multiply: `mathexpr: fraction(2/3) * fraction(3/4)` → **1/2**
- Complex: `mathexpr: fraction(1/2) + fraction(1/3) + fraction(1/6)` → **1**

---

## 13. Frontmatter Variables (Starting with $)

These are defined in the frontmatter at the top of this file:

- Price: `mathexpr: $price` → **100**
- Quantity: `mathexpr: $quantity` → **5**
- Tax rate: `mathexpr: $taxRate` → **0.08**
- Apples: `mathexpr: $apples` → **10**
- Discount: `mathexpr: $discount` → **0.15**

**Calculations with frontmatter:**
- Subtotal: `mathexpr: $price * $quantity` → **500**
- With tax: `mathexpr: $price * $quantity * (1 + $taxRate)` → **540**
- With discount: `mathexpr: $price * (1 - $discount)` → **85**
- Total with everything: `mathexpr: $price * $quantity * (1 - $discount) * (1 + $taxRate)` → **459**
- Shipping cost: `mathexpr: $shippingCost` → **25 USD**
- Final total: `mathexpr: $price * $quantity * (1 - $discount) * (1 + $taxRate) + $shippingCost` → **484 USD**

---

## 14. Code Block Variables (Starting with $)

These are defined in the code block at the top:

- Length: `mathexpr: $length` → **10**
- Width: `mathexpr: $width` → **5**
- Height: `mathexpr: $height` → **3**
- Area (pre-calculated): `mathexpr: $area` → **50**
- Volume (pre-calculated): `mathexpr: $volume` → **150**

**Calculations with code block variables:**
- Perimeter: `mathexpr: 2 * ($length + $width)` → **30**
- Surface area: `mathexpr: 2 * ($length * $width + $length * $height + $width * $height)` → **190**
- Diagonal: `mathexpr: sqrt($length^2 + $width^2)` → **11.18** (approx)

---

## 15. Mixed Variables (Frontmatter + Code Block)

Combining variables from different sources:

- Price per square meter: `mathexpr: $price / $area` → **2**
- Apples per cubic meter: `mathexpr: $apples / $volume` → **0.0666...** (approx)
- Total price for volume-based pricing: `mathexpr: $price * $volume / 100` → **150**
- Complex combo: `mathexpr: ($price * $quantity) / $area` → **10**

---

## 16. Complex Real-World Scenarios

**Scenario 1: Box Dimensions and Cost**

You have a box with dimensions from code block, and price per cubic meter from frontmatter.

- Volume in cubic meters: `mathexpr: $volume / 1000` → **0.15** (assuming units in cm³)
- Cost per volume: `mathexpr: $price * ($volume / 1000)` → **15**

**Scenario 2: Discount and Tax Calculation**

Calculate final price with discount applied before tax:

1. Original price: `mathexpr: $price * $quantity` → **500**
2. After discount: `mathexpr: $price * $quantity * (1 - $discount)` → **425**
3. Tax amount: `mathexpr: $price * $quantity * (1 - $discount) * $taxRate` → **34**
4. Final total: `mathexpr: $price * $quantity * (1 - $discount) * (1 + $taxRate)` → **459**

**Scenario 3: Unit Conversion with Variables**

Convert the room volume to different units:

- Volume in m³: `mathexpr: ($length * $width * $height) / 1000000` → **0.00015** (if in mm)
- Or if already in m: `mathexpr: $length m * $width m * $height m to ft^3` → **1590.9 ft^3** (approx)

---

## 17. Error Handling

These should display error messages:

- Division by zero: `mathexpr: 1/0` → **Infinity** (not an error in mathjs)
- Invalid function: `mathexpr: invalidFunc(5)` → **[Error: ...]**
- Undefined variable: `mathexpr: $undefinedVar` → **[Error: ...]**
- Syntax error: `mathexpr: 5 + * 3` → **[Error: ...]**
- Unit mismatch: `mathexpr: 5 m + 3 s` → **[Error: ...]**

---

## 18. Edge Cases

**Very large numbers:**
- `mathexpr: 10^100` → **1e+100**
- `mathexpr: factorial(50)` → **Very large number**

**Very small numbers:**
- `mathexpr: 1 / 10^100` → **1e-100**

**Negative numbers:**
- `mathexpr: -5 * -3` → **15**
- `mathexpr: sqrt(-1)` → **i** (complex number)

**Zero:**
- `mathexpr: 0 * 1000000` → **0**
- `mathexpr: 0^0` → **1** (by convention in mathjs)

---

## 19. String and Array Functions (if applicable)

These might not all work in inline expressions, but worth testing:

- Max: `mathexpr: max(1, 5, 3, 9, 2)` → **9**
- Min: `mathexpr: min(1, 5, 3, 9, 2)` → **1**
- Mean: `mathexpr: mean(1, 2, 3, 4, 5)` → **3**
- Median: `mathexpr: median(1, 2, 3, 4, 5)` → **3**

---

## 20. Nested Expressions

Complex nested calculations:

- Nested functions: `mathexpr: sqrt(pow(3, 2) + pow(4, 2))` → **5** (Pythagorean)
- Nested with units: `mathexpr: sqrt((5 m)^2 + (12 m)^2)` → **13 m**
- Multiple nesting: `mathexpr: log(exp(sqrt(64)))` → **8**
- With variables: `mathexpr: sqrt(($length)^2 + ($width)^2 + ($height)^2)` → **11.57** (approx)

---

## Test Instructions

1. **Copy this file to your Obsidian vault**
2. **Toggle between Reading Mode and Live Preview Mode**
3. **Verify all expressions evaluate correctly in BOTH modes**
4. **Check that Greek letters show 0 initially, then update after the code block**
5. **Edit inline expressions while typing to see live updates** (Live Preview)
6. **Reload the plugin to test frontmatter processing from scratch**

---

## Expected Behavior

✅ **All inline expressions should evaluate automatically**
✅ **Results should be consistent between Reading and Live Preview modes**
✅ **Frontmatter variables should be accessible immediately**
✅ **Code block variables should be accessible after the block is evaluated**
✅ **Greek letters should work (initialized to 0)**
✅ **Error messages should display inline for invalid expressions**
✅ **Cursor positioning in Live Preview should allow editing without interference**
✅ **Units and currency should format correctly**

---

## Known Limitations

⚠️ **Greek letters default to 0** - You must assign them values in code blocks or frontmatter to use them meaningfully
⚠️ **Scope is file-wide** - Variables defined in code blocks are available to all inline expressions in the same file
⚠️ **Cache persistence** - After removing code blocks, variables may persist until plugin reload

---

## Summary

This test file covers:
- ✅ Basic arithmetic (7 tests)
- ✅ Math functions (8 tests)
- ✅ Trigonometric functions (6 tests)
- ✅ Logarithmic functions (5 tests)
- ✅ Constants (8 tests)
- ✅ Units - length, speed, force, energy (15+ tests)
- ✅ Currency (6 tests)
- ✅ Hex/Binary/Octal (6 tests)
- ✅ Greek letters (8+ tests)
- ✅ Fractions (4 tests)
- ✅ Frontmatter variables (10+ tests)
- ✅ Code block variables (7+ tests)
- ✅ Mixed variables (4 tests)
- ✅ Real-world scenarios (9 tests)
- ✅ Error handling (5 tests)
- ✅ Edge cases (6 tests)
- ✅ Nested expressions (4 tests)

**Total: 118+ individual test cases!**
