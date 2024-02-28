jest.mock(
	"obsidian-dataview",
	() => {
		return {
			getAPI: () => () => {},
		};
	},
	{ virtual: true }
);

import {
	StringReplaceMap,
	applyBlockStyles,
	evaluateMathFromSourceStrings,
	getLocaleFormatter,
	getScopeFromFrontmatter,
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
	preProcessBlockForNumeralsDirectives,
	processAndRenderNumeralsBlockFromSource,
} from "../src/numeralsUtilities";
import {
	NumeralsSettings,
	NumeralsRenderStyle,
	NumeralsLayout,
	NumeralsScope,
	mathjsFormat,	
} from "../src/numerals.types";
import { DEFAULT_SETTINGS } from "../src/numerals.types";

// jest.mock('obsidian-dataview');

import * as math from 'mathjs';
import { defaultCurrencyMap } from "../src/numeralsUtilities";
import { MarkdownPostProcessorContext } from "obsidian";
const currencyPreProcessors = defaultCurrencyMap.map(m => {
	return {regex: RegExp('\\' + m.symbol + '([\\d\\.]+)','g'), replaceStr: '$1 ' + m.currency}
})
const preProcessors = [
	// {regex: /\$((\d|\.|(,\d{3}))+)/g, replace: '$1 USD'}, // Use this if commas haven't been removed already
	{regex: /,(\d{3})/g, replaceStr: '$1'}, // remove thousands seperators. Will be wrong for add(100,100)
	...currencyPreProcessors
];		

for (const moneyType of defaultCurrencyMap) {
	if (moneyType.currency != '') {
		math.createUnit(moneyType.currency, {aliases:[moneyType.currency.toLowerCase(), moneyType.symbol]});
	}
}

describe("numeralsUtilities: applyBlockStyles()", () => {
	let el: HTMLElement;
	let settings: NumeralsSettings;
	let blockRenderStyle: NumeralsRenderStyle;

	beforeEach(() => {
		el = document.createElement("div");
		Object.defineProperty(HTMLElement.prototype, 'toggleClass', {
			value: function(className: string, value: boolean) {
				if (value) this.classList.add(className);
				else this.classList.remove(className);
			},
			writable: true,
			configurable: true
		});
		settings = {
			...DEFAULT_SETTINGS,
		};
		blockRenderStyle = NumeralsRenderStyle.Plain;
	});

	it("apply block styles with some settings and without emitters", () => {
		settings = {
			...settings,
			layoutStyle: NumeralsLayout.TwoPanes,
			alternateRowColor: false,
			hideLinesWithoutMarkupWhenEmitting: false,
		};

		applyBlockStyles({ el, settings, blockRenderStyle });

		expect(el.classList.contains("numerals-block")).toBe(true);
		expect(
			el.classList.contains(
				numeralsLayoutClasses[NumeralsLayout.TwoPanes]
			)
		).toBe(true);
		expect(
			el.classList.contains(
				numeralsRenderStyleClasses[NumeralsRenderStyle.Plain]
			)
		).toBe(true);
		expect(el.classList.contains("numerals-alt-row-color")).toBe(false);

		for (const layoutClass of Object.values(numeralsLayoutClasses)) {
			if (
				layoutClass !== numeralsLayoutClasses[NumeralsLayout.TwoPanes]
			) {
				expect(el.classList.contains(layoutClass)).toBe(false);
			}
		}

		for (const renderStyleClass of Object.values(
			numeralsRenderStyleClasses
		)) {
			if (
				renderStyleClass !==
				numeralsRenderStyleClasses[NumeralsRenderStyle.Plain]
			) {
				expect(el.classList.contains(renderStyleClass)).toBe(false);
			}
		}

		expect(el.classList.contains("numerals-emitters-present")).toBe(false);
		expect(el.classList.contains("numerals-hide-non-emitters")).toBe(false);
	});

	it("should apply block styles with default styles and with emitters", () => {
		applyBlockStyles({ el, settings, blockRenderStyle, hasEmitters: true });

		expect(el.classList.contains("numerals-emitters-present")).toBe(true);
		expect(el.classList.contains("numerals-hide-non-emitters")).toBe(true);
	});

	it("should apply block styles with default settings and showing now-emitters with emitters", () => {
		const settingsTest = {
			...settings,
			hideLinesWithoutMarkupWhenEmitting: false,
		};
		applyBlockStyles({
			el,
			settings: settingsTest,
			blockRenderStyle,
			hasEmitters: true,
		});

		expect(el.classList.contains("numerals-emitters-present")).toBe(true);
		expect(el.classList.contains("numerals-hide-non-emitters")).toBe(false);
	});
});

describe("numeralsUtilities: preProcessBlockForNumeralsDirectives", () => {
	it("Correctly processes block with emitters and insertion directives", () => {
		const sampleBlock = `# comment 1
apples = 2
2 + 3 =>
@[$result::5]`;

		const preProcessors = [{ regex: /apples/g, replaceStr: "3" }];
		const result = preProcessBlockForNumeralsDirectives(
			sampleBlock,
			preProcessors
		);

		expect(result.rawRows).toEqual([
			"# comment 1",
			"apples = 2",
			"2 + 3 =>",
			"@[$result::5]",
		]);
		expect(result.processedSource).toEqual(
			"# comment 1\n3 = 2\n2 + 3\n$result"
		);
		expect(result.emitter_lines).toEqual([2]);
		expect(result.insertion_lines).toEqual([3]);
	});

	it("Processes block without emitters or insertion directives", () => {
		const sampleBlock = `# Simple math
1 + 1
2 * 2`;

		const preProcessors = undefined;
		const result = preProcessBlockForNumeralsDirectives(
			sampleBlock,
			preProcessors
		);

		expect(result.rawRows).toEqual(["# Simple math", "1 + 1", "2 * 2"]);
		expect(result.processedSource).toEqual("# Simple math\n1 + 1\n2 * 2");
		expect(result.emitter_lines).toEqual([]);
		expect(result.insertion_lines).toEqual([]);
	});

	it("Handles multiple emitters and insertion directives", () => {
		const sampleBlock = `# Multiple directives
5 + 5 =>
10 - 2 =>
@[$firstResult::10]
@[$secondResult::8]`;

		const preProcessors = undefined;
		const result = preProcessBlockForNumeralsDirectives(
			sampleBlock,
			preProcessors
		);

		expect(result.rawRows).toEqual([
			"# Multiple directives",
			"5 + 5 =>",
			"10 - 2 =>",
			"@[$firstResult::10]",
			"@[$secondResult::8]",
		]);
		expect(result.processedSource).toEqual(
			"# Multiple directives\n5 + 5\n10 - 2\n$firstResult\n$secondResult"
		);
		expect(result.emitter_lines).toEqual([1, 2]);
		expect(result.insertion_lines).toEqual([3, 4]);
	});

	it("Correctly applies preProcessors to the source", () => {
		const sampleBlock = `# Preprocessor test
apples + oranges
@[$totalFruits::apples + oranges]`;

		const preProcessors = [
			{ regex: /apples/g, replaceStr: "3" },
			{ regex: /oranges/g, replaceStr: "5" },
		];
		const result = preProcessBlockForNumeralsDirectives(
			sampleBlock,
			preProcessors
		);

		expect(result.rawRows).toEqual([
			"# Preprocessor test",
			"apples + oranges",
			"@[$totalFruits::apples + oranges]",
		]);
		expect(result.processedSource).toEqual(
			"# Preprocessor test\n3 + 5\n$totalFruits"
		);
		expect(result.emitter_lines).toEqual([]);
		expect(result.insertion_lines).toEqual([2]);
	});
});

/**
 * Unit tests for numeralsUtilities: getScopeFromFrontmatter
 * 
 * These tests verify the functionality of getScopeFromFrontmatter, ensuring it correctly processes
 * frontmatter data under various conditions. The tests cover scenarios including undefined frontmatter,
 * processing all keys, ignoring objects unless keysOnly is true, and processing specific keys when
 * 'numerals' is an array. Each test sets up the necessary environment and asserts the expected outcomes
 * for the scope object after processing the frontmatter.
 */
describe("numeralsUtilities: getScopeFromFrontmatter", () => {
    let scope: NumeralsScope;
    let frontmatter: { [key: string]: unknown };
    let forceAll: boolean;
    let stringReplaceMap: StringReplaceMap[];
    let keysOnly: boolean;

    beforeEach(() => {
        scope = new NumeralsScope();
        frontmatter = {};
        forceAll = false;
        stringReplaceMap = [];
        keysOnly = false;
    });

    it("should return an empty scope for undefined frontmatter", () => {
        const result = getScopeFromFrontmatter(undefined, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.size).toBe(0);
    });

    it("should process 'numerals: all' correctly", () => {
        frontmatter = {
            numerals: "all",
            count: 5,
			speed: "5 m/s"
        };
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.get("count")).toBe(5);
        expect(result.get("title")).toBe(undefined); // title = "test", but no "title" key in scope
		expect(result.get("speed")).toEqual(math.evaluate("5 m/s"));
    });

    it("should ignore objects unless keysOnly is true", () => {
        frontmatter = {
            objectKey: { nested: "value" }
        };
        let result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.has("objectKey")).toBe(false);

        keysOnly = true;
        result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.get("objectKey")).toBeUndefined();
    });

    it("should process specific keys when 'numerals' is an array", () => {
        frontmatter = {
            numerals: ["selectedKey"],
            selectedKey: 10,
            ignoredKey: "ignored"
        };
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.get("selectedKey")).toBe(10);
        expect(result.has("ignoredKey")).toBe(false);
    });

    it("should process string values as mathjs expressions", () => {
        frontmatter = {
			numerals: "expression",
            expression: "2 + 2"
        };
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.get("expression")).toEqual(math.evaluate("2 + 2"));
    });

	it("should handle missing scope values gracefully", () => {
		frontmatter = {
			numerals: "missingValue",
			missingValue: "missing"
		};
		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
		expect(result.get("missingValue")).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});


    it("should handle errors in mathjs expression evaluation gracefully", () => {
        frontmatter = {
			numerals: "badExpression",
            badExpression: "2 +"
        };
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(consoleSpy).toHaveBeenCalled();
        expect(result.has("badExpression")).toBe(false);
        consoleSpy.mockRestore();
    });

    it("should respect the forceAll parameter", () => {
        frontmatter = {
            key1: "2",
            key2: "2+2"
        };
        forceAll = true;
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);
        expect(result.get("key1")).toBe(2);
        expect(result.get("key2")).toEqual(math.evaluate("2+2"));
    });

    it("should apply string replacements from stringReplaceMap including currency support", () => {

        frontmatter = {
			numerals: "all",
            cost: "100 USD",
			dollarCost: "$100",
			currencyCost: "$100,000"
        };
        const result = getScopeFromFrontmatter(frontmatter, scope, forceAll, preProcessors, keysOnly);
        expect(result.get("cost")).toEqual(math.evaluate("100 USD"));
		expect(result.get("dollarCost")).toEqual(math.evaluate("100 USD"));
		expect(result.get("currencyCost")).toEqual(math.evaluate("100000 USD"));
    });
});
describe("numeralsUtilities: evaluateMathFromSourceStrings", () => {
    let scope: NumeralsScope;
    let processedSource: string;

    beforeEach(() => {
        scope = new NumeralsScope();
        processedSource = "";
    });

    it("should evaluate simple math expressions correctly", () => {
        processedSource = "2 + 2\n5 * 5";
        const { results, inputs, errorMsg, errorInput } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([4, 25]);
        expect(inputs).toEqual(["2 + 2", "5 * 5"]);
        expect(errorMsg).toBeNull();
        expect(errorInput).toBe("");
    });

    it("should handle variables in scope correctly", () => {
        scope.set("x", 10);
        processedSource = "x * 2\nx + 5";
        const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([20, 15]);
        expect(inputs).toEqual(["x * 2", "x + 5"]);
    });

    it("should return an error for invalid expressions", () => {
        processedSource = "2 +\n5 * 5";
        const { errorMsg, errorInput } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(errorMsg).not.toBeNull();
        expect(errorInput).toBe("2 +");
    });

    it("should ignore empty last row in processed source", () => {
        processedSource = "2 + 2\n5 * 5\n";
        const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([4, 25]);
        expect(inputs).toEqual(["2 + 2", "5 * 5"]);
    });

    it("should process expressions with mathjs functions", () => {
        processedSource = "sqrt(16)\nlog(100, 10)";
        const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([4, 2]);
        expect(inputs).toEqual(["sqrt(16)", "log(100, 10)"]);
    });

    it("should handle scope updates within the source", () => {
        processedSource = "x = 5\nx * 2";
        const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([5, 10]);
        expect(inputs).toEqual(["x = 5", "x * 2"]);
        expect(scope.get("x")).toBe(5);
    });

    it("should correctly handle expressions with units", () => {
        processedSource = "5 m + 10 m\n100 kg - 50 kg";
        const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(results).toEqual([math.unit(15, 'm'), math.unit(50, 'kg')]);
        expect(inputs).toEqual(["5 m + 10 m", "100 kg - 50 kg"]);
    });

    it("should return an error for incompatible unit operations", () => {
        processedSource = "10 m + 5 kg";
        const { errorMsg, errorInput } = evaluateMathFromSourceStrings(processedSource, scope);

        expect(errorMsg).not.toBeNull();
        expect(errorInput).toBe("10 m + 5 kg");
    });

	it("should handle rolling totals and sums", () => {
		processedSource = "a = 1\nb = 2\n__Σ";
		const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);
		expect(results).toEqual([1, 2, 3]);
		expect(inputs).toEqual(["a = 1", "b = 2", "__Σ"]);
	});

	it("should handle rolling totals and sums", () => {
		processedSource = `# Fruit
apples = 3
pears = 4
grapes = 10
fruit = __Σ

monday = 10 USD
tuesday = 20 USD
wednesday = 30 USD
profit = __Σ`;
		const { results, inputs } = evaluateMathFromSourceStrings(processedSource, scope);
		expect(results).toEqual([undefined,3, 4, 10, 17, undefined, math.unit(10, 'USD'), math.unit(20, 'USD'), math.unit(30, 'USD'), math.unit(60, 'USD')]);
		expect(inputs).toEqual(["# Fruit","apples = 3", "pears = 4", "grapes = 10", "fruit = __Σ", "", "monday = 10 USD", "tuesday = 20 USD", "wednesday = 30 USD", "profit = __Σ"]);
	});	
});
describe("numeralsUtilities: processAndRenderNumeralsBlockFromSource end-to-end tests", () => {
    let el: HTMLElement;
    let source: string;
    let ctx: MarkdownPostProcessorContext;
    let metadata: { [key: string]: unknown };
    let type: NumeralsRenderStyle;
    let settings: NumeralsSettings;
    let numberFormat: mathjsFormat;

    beforeEach(() => {
        el = document.createElement("div");
		Object.defineProperty(HTMLElement.prototype, 'toggleClass', {
			value: function(className: string, value: boolean) {
				if (value) this.classList.add(className);
				else this.classList.remove(className);
			},
			writable: true,
			configurable: true
		});
		Object.defineProperty(HTMLElement.prototype, 'createEl', {
			value: jest.fn(function(this: HTMLElement, tag, options, callback) {
				const element = document.createElement(tag);
				if (typeof options === 'string') {
					element.className = options;
				} else if (options) {
					if (options.cls) {
						const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
						classes.forEach((cls: string) => element.classList.add(cls));
					}
					if (options.text) element.textContent = String(options.text);
					if (options.attr) {
						Object.entries(options.attr).forEach(([key, value]) => {
							element.setAttribute(key, String(value));
						});
					}
					if (options.title) element.title = options.title;
				}
				if (callback) callback(element);
	
				// Append the created element to the parent element ('this'), with type assertion
				this.appendChild(element);
	
				return element;
			}),
			writable: true,
			configurable: true
		});
        Object.defineProperty(HTMLElement.prototype, 'setText', {
            value: function(text: string) {
                this.textContent = text;
            },
            writable: true,
            configurable: true
        });
        source = "";
        ctx = { getSectionInfo: jest.fn() } as unknown as MarkdownPostProcessorContext;
        metadata = {};
        type = NumeralsRenderStyle.Plain;
        settings = { ...DEFAULT_SETTINGS };
        numberFormat = getLocaleFormatter();
    });

	const resultSeparator = DEFAULT_SETTINGS.resultSeparator;

    it("renders a simple math block correctly", () => {
        source = "1 + 1\n2 * 2";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const lines = el.querySelectorAll(".numerals-line");
        expect(lines.length).toBe(2);
        expect(lines[0].textContent).toContain(`1 + 1${resultSeparator}2`);
        expect(lines[1].textContent).toContain(`2 * 2${resultSeparator}4`);
    });

    it("renders a block with emitter lines correctly", () => {
        source = "1 + 1 =>\n2 * 2 =>";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const emitterLines = el.querySelectorAll(".numerals-emitter");
        expect(emitterLines.length).toBe(2);
        expect(emitterLines[0].textContent).toContain(`1 + 1${resultSeparator}2`);
        expect(emitterLines[1].textContent).toContain(`2 * 2${resultSeparator}4`);
    });

    it("renders a block with insertion directives correctly", () => {
		metadata = { numerals: "all", result1: 1, result2: 2, result3: 3 };
        source = "@[result1]\n@[result2::2]\n@[result3::4]";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const insertionLines = el.querySelectorAll(".numerals-line");
        // const children = Array.from(el.children);
        expect(insertionLines.length).toBe(3);
        expect(insertionLines[0].textContent).toContain(`result1${resultSeparator}1`);
        expect(insertionLines[1].textContent).toContain(`result2${resultSeparator}2`);
		expect(insertionLines[2].textContent).toContain(`result3${resultSeparator}3`);
    });

    it("applies preProcessors correctly", () => {
        source = "$100 + $1,000";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const lines = el.querySelectorAll(".numerals-line");
        expect(lines.length).toBe(1);
        expect(lines[0].textContent).toContain(`$100 + $1,000${resultSeparator}1,100 USD`);
    });

    it("handles errors in math expressions gracefully", () => {
        source = "1 +\n2 * 2";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const errorLine = el.querySelector(".numerals-error-line");
        expect(errorLine).not.toBeNull();
        expect(errorLine?.textContent).toContain("SyntaxError:");
    });

    it("calculates with variables correctly", () => {
        source = "lemons = 20\napples = 10\nfruit = lemons + apples";
        processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);

        const lines = el.querySelectorAll(".numerals-line");
        expect(lines.length).toBe(3);
        expect(lines[0].textContent).toContain(`lemons = 20${resultSeparator}20`);
        expect(lines[1].textContent).toContain(`apples = 10${resultSeparator}10`);
        expect(lines[2].textContent).toContain(`fruit = lemons + apples${resultSeparator}30`);
    });

	it('simple math block with currency and emitter with snapshot', () => {
		source = "amount = 100 USD + $1,000\ntax = 10% * amount =>";
		processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);
		const lines = el.querySelectorAll(".numerals-line");
		expect(lines.length).toBe(2);
		expect(lines[0].textContent).toContain(`amount = 100 USD + $1,000${resultSeparator}1,100 USD`);
		expect(lines[1].textContent).toContain(`tax = 10% * amount${resultSeparator}110 USD`);

		expect(el).toMatchSnapshot();
	});

	it('Snapshot 1: simple math block with units, emitters, result insertion', () => {
		source = `# Physics Calculation
		speed = 5 m/s
		distance = 100 m
		time = distance / speed =>
		@[time]`;
		processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);
		expect(el).toMatchSnapshot();
	});	
	
	it('Snapshot 2: simple math block with test of locale formatting', () => {
		source = `# Locale Test
		1000
		3.14
		lambda=780.246021 nanometer
		nu=speedOfLight/lambda
		pi+1`;
		processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);
		expect(el).toMatchSnapshot();
	});		
	
	it('Simple math with rolling sum', () => {
		source = `# Fruit
		apples = 3
		pears = 4
		grapes = 10
		fruit = @sum
		# Money
		monday = $10
		tuesday = $20
		wednesday = $30
		profit = @total`;
		processAndRenderNumeralsBlockFromSource(el, source, ctx, metadata, type, settings, numberFormat, preProcessors);
		const lines = el.querySelectorAll(".numerals-line");
		expect(lines.length).toBe(10);	
		expect(lines[0].textContent).toContain(`# Fruit`);
		expect(lines[1].textContent).toContain(`apples = 3${resultSeparator}3`);
		expect(lines[2].textContent).toContain(`pears = 4${resultSeparator}4`);
		expect(lines[3].textContent).toContain(`grapes = 10${resultSeparator}10`);
		expect(lines[4].textContent).toContain(`fruit = @sum${resultSeparator}17`);
		expect(lines[5].textContent).toContain(`# Money`);
		expect(lines[6].textContent).toContain(`monday = $10${resultSeparator}10 USD`);
		expect(lines[7].textContent).toContain(`tuesday = $20${resultSeparator}20 USD`);
		expect(lines[8].textContent).toContain(`wednesday = $30${resultSeparator}30 USD`);
		expect(lines[9].textContent).toContain(`profit = @total${resultSeparator}60 USD`);
	});

});
