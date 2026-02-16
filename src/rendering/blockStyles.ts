import {
	NumeralsRenderStyle,
	NumeralsSettings,
} from "../numerals.types";
import {
	numeralsLayoutClasses,
	numeralsRenderStyleClasses,
} from "../constants";

/**
 * Applies container classes for a rendered Numerals block.
 */
export function applyBlockStyles({
	el,
	settings,
	blockRenderStyle,
	hasEmitters = false,
}: {
	el: HTMLElement;
	settings: NumeralsSettings;
	blockRenderStyle: NumeralsRenderStyle;
	hasEmitters?: boolean;
}): void {
	el.toggleClass("numerals-block", true);
	el.toggleClass(numeralsLayoutClasses[settings.layoutStyle], true);
	el.toggleClass(numeralsRenderStyleClasses[blockRenderStyle], true);
	el.toggleClass("numerals-alt-row-color", settings.alternateRowColor);

	if (hasEmitters) {
		el.toggleClass("numerals-emitters-present", true);
		el.toggleClass(
			"numerals-hide-non-emitters",
			settings.hideLinesWithoutMarkupWhenEmitting
		);
	}
}
