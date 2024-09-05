# Numerals Obsidian Plugin
![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22numerals%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json) ![GitHub release (latest by date)](https://img.shields.io/github/v/release/gtg922r/obsidian-numerals?color=%23483699) ![GitHub release (latest by date including pre-releases)](https://img.shields.io/github/v/release/gtg922r/obsidian-numerals?include_prereleases&label=BRAT%20beta)

*Numerals* gives you the power of an advanced calculator inside a `math` code block, complete with currencies, units, variables, and math functions! Now you can perform calculations inline with your notes, and see both the input and the evaluated result. *Numerals* works with Live Preview as well as Reader view, and offers TeX-style rendering or Syntax Highlighting as well as auto-completion suggestions. Comments or explanations can be added with `#`, and important results can be indicated with `=>` after the calculation. 
![Numerals Lemonade Stand - Side by Side](https://user-images.githubusercontent.com/1195174/200186757-a71b5e7a-df96-4350-b6a4-366d758e696d.png)
![Numerals Tex Example](https://user-images.githubusercontent.com/1195174/201516487-75bb7a08-76ab-4ff3-bf6b-d654aa284ab7.png)

## Features
- Units
 	- `1ft + 12in` → `2ft`
	- `20 mi / 4 hr to m/s` → `2.235 m / s`
	- `100 km/hr in mi/hr` → `62.137 mi / hr`
	- `9.81 m/s^2 * 100 kg * 40 m` → `39.24 kJ`
- Currency
	- `$1,000 * 2` → `2,000 USD`
	- `£10 + £0.75` → `10.75 GBP`
	- `$100/hr * 3days` → `7,200 USD`
	- Set custom currencies, for example `₿`
- Math functions
	- `sqrt`, `sin`, `cos`, `abs`, `log`, etc (see [mathjs](https://mathjs.org/docs/reference/functions.html) for full list)
- Hex, Binary, Octal, and other bases
	- `0xff + 0b100` → `259`
	- `hex(0xff + 0b100)` → `"0x103"`
- Natural Constants
	- `e`, `i`, `pi`, `speedOfLight`, `gravitationConstant`, `vacuumImpedance`, `avogadro`
	- And many more (see [mathjs: Constants](https://mathjs.org/docs/reference/constants.html) and [mathjs: Units](https://mathjs.org/docs/datatypes/units.html) for more)
- Auto-complete suggestions
	- By default will offer auto-complete suggestions for any variables defined in a math codeblock being edited
	- Optional setting to include all available functions, constants, and physical constants
- Totals of previous lines using `@total` or `@sum` special operator
	- When Numerals encounters `@total` or `@sum` it inserts the sum of all previous lines up until the last blank line or comment
- Greek Letters
	- Variables can be named using greek letters, e.g. `μ = 3 m/s`
	- Greek letters can be auto-completed by typing `:`, e.g. `:mu` in a math block will offer `μ` as an auto-complete suggestion
- Note-Global Variables
	- Any variable name preceeded by an `$` symbol will be made available to all math blocks on a page
- Fractions:	
	- `fraction(1/3) + fraction(1/4)` → `7/12`
- Comments and Headings:
	- `#` at the end of a line will be ignored, but rendered in faint text as a comment
	- A line starting with `#` will be ignored by the math engine, but will be bolded when rendered
- Result Annotation:
	- `=>` at the end of a line (but before a comment) will tell *Numerals* that a result should be highlighted. Any line in that code block *without* a `=>` annotation will be rendered faintly (or hidden depending on settings).
- Result Insertion:
	- Using the `@[...]` syntax (for example: `@[profit]`), Numerals will insert the results of a calculation into the raw text of your note, following `::`
	- Uses dataview notation, which allows writing back to dataview values. For example, `@[profit]` will be modified to say `@[profit::10 USD]`
- Access Frontmatter Properties
	- Numerals will have access to any property name specified in the `numerals:` property. Setting `numerals` to `all`, will make all properties in a note available to *Numerals*
	- Multiple properties can be specified as a list, e.g. `numerals: [apples, pears]` will makes both the `apples` and `pears` property available to Numerals

*Numerals* utilizes the [mathjs](https://mathjs.org/) library for all calculations. *Numerals* implements a preprocessor to allow more human-friendly syntax, such as currency symbols and thousands separators. For all available functions and capabilities (which includes matrices, vectors, symbolic algebra and calculus, etc), see the [mathjs documentation](https://mathjs.org/docs/index.html)


## Styling Options
*Numerals* has been tested with the default theme and most other top themes. It uses default values such that it should play nice with any other theme. There are also several configurable settings to modify how *Numerals* renders math blocks

### Render Style
*Numerals* supports rendering inputs/ouputs as either:
1. Plain Text
2. TeX
3. Syntax Highlighting

One of these options can either be chosen as a default from *Numerals* settings, or then can be applied on a per-block basis by using `math-plain`, `math-tex`, or `math-highlight` rather than a `math` code block. 

![Numerals Render Style Side by Side](https://user-images.githubusercontent.com/1195174/201587645-5a79aafa-5008-49d0-b584-5c6a99c7edc5.png)


### Layout
#### 2-panes
- Answer is shown to the right of the input with a background color and a separator.
- Distinctive style that separates input from evaluated answers

![Numerals 2 Panes](https://user-images.githubusercontent.com/1195174/200186692-0b6a0a7b-3f77-47f8-887f-d7d333b53967.png)

#### Answer to the Right
- Answer to the right: answer is shown in the same line as the input, but right-aligned
- More subtle than 2-panes that works well with just a few calculations

![Numerals answer right](https://user-images.githubusercontent.com/1195174/200186885-dedf1ccb-0464-4732-976e-0eaf54f5d098.png)

#### Answer Below
- Answer is shown below the input, on the next line. 
- Less compact vertically, but more compact horizontally

![Numerals answer below](https://user-images.githubusercontent.com/1195174/200186929-8e5bf0de-ab1e-47d0-a3f3-cf5164136c62.png)

### Alternating Row Colors
Choose between a consistent code block background color (left), or alternating rows to help track from input to result (right).

![Numerals Alternating Row Style Comparison](https://user-images.githubusercontent.com/1195174/200187338-24912a83-eb1e-4188-a843-e189f33e7133.png)

### Auto-completion Suggestions
By default, _Numerals_ will provide auto-completion suggestions for variables that have been defined in a particular `math` codeblock. Turning on _Include Functions and Constants in Suggestions_ will also provide suggestions for all functions, math constants, and physical constants supported in _Numerals_.

![Auto-completion of Functions](https://user-images.githubusercontent.com/1195174/215416147-68110298-0e10-44e5-9351-83efc3a17bba.png)

### Format of Numbers in Rendered Results
*Numerals* allows the user to specify the format of rendered results. 
- **System Formatted** (Default): Use your local system settings for number formatting (including thousands and decimal separator)
- **Fixed**: No thousands separator and full precision. Period as decimal separator (e.g. `100000.1`)
- **Exponential**: Always use exponential notation. (e.g. `1.000001e5`)
- **Engineering**: Exponential notation with exponent a multiple of 3. (e.g. `100.0001e3`)
- **Formatted**: Forces a specific type of formatted notation.
  - Style 1: `100,000.1`
  - Style 2: `100.000,1`
  - Style 3: `100 000,1`
  - Style 4: `1,00,000.1`

## Installation
*Numerals* can be found in the Obsidian community plugin list.

### Using BRAT
To try the latest features of *Numerals* before they are released, and provide helpful feedback and testing, try *Numerals* by using the [Obsidian BRAT plugin](https://github.com/TfTHacker/obsidian42-brat). **All new *Numerals* features will be pushed to beta testers first.**

1. Ensure BRAT is installed
2. Trigger the command `Obsidian42 - BRAT: Add a beta plugin for testing` 
3. Enter this repository, `gtg922r/obsidian-numerals`
4. Activate *Numerals* plugin in community plugin list

## Features in progress and roadmap
- [x] Support for mapping currency symbols to different currencies ([#17](https://github.com/gtg922r/obsidian-numerals/issues/17))
	both `$` and `¥` can be mapped to different currencies in settings 
- [x] Style Settings support for all colors and other style options ([#13](https://github.com/gtg922r/obsidian-numerals/issues/13))
	- Partial support added in 1.0.5
- [x] Result annotation, similar to Calca feature ([#4](https://github.com/gtg922r/obsidian-numerals/issues/4))
	- Support added in 1.0.5
- [x] Autocompletion of functions and variable inside math code block ([#15](https://github.com/gtg922r/obsidian-numerals/issues/15))
	- Support added in 1.0.8
- [ ] Inline calculation for inline code blocks ([#5](https://github.com/gtg922r/obsidian-numerals/issues/5))

Feel free to suggest additional features by creating an [issue](https://github.com/gtg922r/obsidian-numerals/issues)!

## Related
There are a number of other plugins that address math and calculation use cases in Obsidian. 
- If you are primarily interested in evaluating math expressions and inserting the result into your notes, look into [meld-cp/obsidian-calc](https://github.com/meld-cp/obsidian-calc)
- If you are looking for a full-featured Computer Algebra System including plots and with similar code block rendering, consider [Canna71/obsidian-mathpad: Computer Algebra System (CAS) for Obsidian.md](https://github.com/Canna71/obsidian-mathpad)

There are also a number of "calculator as notes" apps that acted as the inspiration for *Numerals*. If you are looking for a purpose-built app outside of Obsidian, consider:
- [Numi. Beautiful calculator app for Mac.](https://numi.app/)
- [Numbr](https://numbr.dev/)
- [Soulver 3 - Notepad Calculator App for Mac](https://soulver.app/)

