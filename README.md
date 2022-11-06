# Numerals Obsidian Plugin

Numerals gives you the power of an advanced calculator inside a `math` code block, complete with currencies, units, variables, and math functions! Now you can perform calculations inline with your notes, and see both the input and the evaluated result. Numerals works with Live Preview as well as Reader view. Math expressions can be commented with `#`, or descriptive sentences can be added between calculations.

![Numerals Side by Side Lemonade Stand](https://user-images.githubusercontent.com/1195174/200161667-2a3d5a59-b660-45bd-b940-e54b2c417e3d.png)

## Features
- Units
 	- `1ft + 12in` → `2ft`
	- `20 mi / 4 hr to m/s` → `2.235 m / s`
	- `9.81 m/s^2 * 100 kg * 40 m` → `39.24 kJ`
- Currency
	- `$1,000 * 2` → `2,000 USD`
	- `$10 + $0.75` → `10.75 USD`
- Math functions
	- `sin`, `cos`, `abs`, `log`, etc (see [mathjs](https://mathjs.org/docs/reference/functions.html) for full list)
- Hex, Binary, Octal, and other bases
	- `0xff + 0b100` → `259`
	- `hex(0xff + 0b100)` → `"0x103"`
- Natural Constants
	- `e`, `i`, `pi`, `speedOfLight`, `gravitationConstant`, `vacuumImpedance`, `avogadro`
	- And many more (see [mathjs: Constants](https://mathjs.org/docs/reference/constants.html) and [mathjs: Units](https://mathjs.org/docs/datatypes/units.html) for more)
	
*Numerals* utilizes the [mathjs](https://mathjs.org/) library for all calculations. *Numerals* implements a preprocessor to allow more human-friendly syntax, such as currency symbols and thousands separators. For all available functions and capabilities (which includes matrices, vectors, symbolic algebra and calculus, etc), see the [mathjs documentation](https://mathjs.org/docs/index.html)


## Style Options
Numerals has been tested with the default theme and most other top themes. It uses default values such that it should play nice with any other theme. There are 3 options to choose from:

### Layout
#### 2-panes
- answer is shown to the right of the input with a background color and a seperator.
- Distinctive style that seperates input from evaluated answers

![Numerals 2 pane](https://user-images.githubusercontent.com/1195174/200162583-6d50954b-2654-4aa2-a011-b9cb757c006f.png)

#### Answer to the Right
- Answer to the right: answer is shown in the same line as the input, but right-aligned
- More subtle than 2-panes that works well with just a few calculations

![Numerals answer to the right](https://user-images.githubusercontent.com/1195174/200162587-be5e9036-fdd8-4453-9cbd-230c73a67936.png)

#### Answer Below
- Answer is shown below the input, on the next line. 
- Less compact vertically, but much more compact width

![Numerals answer below](https://user-images.githubusercontent.com/1195174/200162593-49c1c2e3-89b6-4199-ad34-5b7c24659f4f.png)

### Alternating Row Colors
Choose between a consistent code block background color, or alternating rows to help track from input to result.

![Numerals - No Alternating](https://user-images.githubusercontent.com/1195174/200162735-13c8bdd5-44d8-49ff-843e-3afb3ea8da97.png) ![Numerals Alternating](https://user-images.githubusercontent.com/1195174/200162737-1276a79b-2cda-429f-8e2b-1987a6b59826.png)

## Remaining features in progress
- Support for additional currency symbols (currently only supports `$`)
- Support for mapping currency symbols to different currencies (currently `$` maps to `USD`)
- Better Error handling (currently no indication of error line)
- Style Settings support for all colors and other style options
- Syntax highlighting of input
