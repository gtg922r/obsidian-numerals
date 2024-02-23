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
	it('Correctly processes example block 1', () => {
		const sampleBlock =`# comment 1
# comment 2
apples = 2
2 + 3 =>
`;		
		const result = preProcessBlockForNumeralsDirectives(sampleBlock, )
