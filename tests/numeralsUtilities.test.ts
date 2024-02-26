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
	getScopeFromFrontmatter,
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
	preProcessBlockForNumeralsDirectives,
} from "../src/numeralsUtilities";
import {
	NumeralsSettings,
	NumeralsRenderStyle,
	NumeralsLayout,
	NumeralsScope,	
} from "../src/numerals.types";
import { DEFAULT_SETTINGS } from "../src/numerals.types";

// jest.mock('obsidian-dataview');

describe("numeralsUtilities: applyBlockStyles()", () => {
	let el: HTMLElement;
	let settings: NumeralsSettings;
	let blockRenderStyle: NumeralsRenderStyle;

	beforeEach(() => {
		el = document.createElement("div");
		el.toggleClass = (className: string, value: boolean) => {
			if (value) el.classList.add(className);
			else el.classList.remove(className);
		};
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
import * as math from 'mathjs';
import { defaultCurrencyMap } from "../src/numeralsUtilities";
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
