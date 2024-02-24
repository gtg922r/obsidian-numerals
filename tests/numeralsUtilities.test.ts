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
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
	preProcessBlockForNumeralsDirectives,
} from "../src/numeralsUtilities";
import {
	NumeralsSettings,
	NumeralsRenderStyle,
	NumeralsLayout,
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

		console.log("el", el);
		console.log("toggle class fn:", el.toggleClass);
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
		console.log("el.classList", el.classList);

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
	it('Correctly processes block with emitters and insertion directives', () => {
		const sampleBlock =`# comment 1
apples = 2
2 + 3 =>
@[$result::5]`;

		const preProcessors = [{ regex: /apples/g, replaceStr: "3" }];
		const result = preProcessBlockForNumeralsDirectives(sampleBlock, preProcessors);

		expect(result.rawRows).toEqual([
			"# comment 1",
			"apples = 2",
			"2 + 3 =>",
			"@[$result::5]"
		]);
		expect(result.processedSource).toEqual("# comment 1\n3 = 2\n2 + 3\n$result.");
		expect(result.emitter_lines).toEqual([2]);
		expect(result.insertion_lines).toEqual([3]);
	});

	it('Processes block without emitters or insertion directives', () => {
		const sampleBlock =`# Simple math
1 + 1
2 * 2`;

		const preProcessors = undefined;
		const result = preProcessBlockForNumeralsDirectives(sampleBlock, preProcessors);

		expect(result.rawRows).toEqual([
			"# Simple math",
			"1 + 1",
			"2 * 2"
		]);
		expect(result.processedSource).toEqual("# Simple math\n1 + 1\n2 * 2");
		expect(result.emitter_lines).toEqual([]);
		expect(result.insertion_lines).toEqual([]);
	});

	it('Handles multiple emitters and insertion directives', () => {
		const sampleBlock =`# Multiple directives
5 + 5 =>
10 - 2 =>
@[$firstResult::10]
@[$secondResult::8]`;

		const preProcessors = undefined;
		const result = preProcessBlockForNumeralsDirectives(sampleBlock, preProcessors);

		expect(result.rawRows).toEqual([
			"# Multiple directives",
			"5 + 5 =>",
			"10 - 2 =>",
			"@[$firstResult::10]",
			"@[$secondResult::8]"
		]);
		expect(result.processedSource).toEqual("# Multiple directives\n5 + 5\n10 - 2\n$firstResult\n$secondResult");
		expect(result.emitter_lines).toEqual([1, 2]);
		expect(result.insertion_lines).toEqual([3, 4]);
	});

	it('Correctly applies preProcessors to the source', () => {
		const sampleBlock =`# Preprocessor test
apples + oranges
@[$totalFruits::apples + oranges]`;

		const preProcessors = [
			{ regex: /apples/g, replaceStr: "3" },
			{ regex: /oranges/g, replaceStr: "5" }
		];
		const result = preProcessBlockForNumeralsDirectives(sampleBlock, preProcessors);

		expect(result.rawRows).toEqual([
			"# Preprocessor test",
			"apples + oranges",
			"@[$totalFruits::apples + oranges]"
		]);
		expect(result.processedSource).toEqual("# Preprocessor test\n3 + 5\n$totalFruits");
		expect(result.emitter_lines).toEqual([]);
		expect(result.insertion_lines).toEqual([2]);
	});
});
