import { EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import { NumeralsSuggestor } from "../src/NumeralsSuggestor";
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from "../src/numeralsUtilities";
import { getMathJsSymbols } from "../src/mathjsUtilities";

jest.mock("../src/numeralsUtilities", () => ({
	getMetadataForFileAtPath: jest.fn(),
	getScopeFromFrontmatter: jest.fn(),
}));

jest.mock("../src/mathjsUtilities", () => ({
	getMathJsSymbols: jest.fn(() => ["f|abs()", "c|pi"]),
}));

jest.mock("obsidian", () => {
	class EditorSuggest<T> {
		app: unknown;
		context: unknown;
		constructor(app: unknown) {
			this.app = app;
		}
		close(): void {}
	}

	return {
		EditorSuggest,
		setIcon: jest.fn(),
	};
});

type MockEditor = {
	getLine: jest.Mock<string, [number]>;
};

function createMockEditor(lines: string[]): MockEditor {
	return {
		getLine: jest.fn((line: number) => lines[line] ?? ""),
	};
}

describe("NumeralsSuggestor", () => {
	const basePlugin = {
		app: {},
		scopeCache: new Map(),
		settings: {
			provideSuggestions: true,
			suggestionsIncludeMathjsSymbols: true,
			enableGreekAutoComplete: false,
			forceProcessAllFrontmatter: false,
		},
	} as any;

	beforeEach(() => {
		jest.clearAllMocks();
		(getMetadataForFileAtPath as jest.Mock).mockReturnValue({ numerals: "all", x: 1 });
		(getScopeFromFrontmatter as jest.Mock).mockReturnValue(new Map([["x", 1], ["$total", 2]]));
		(getMathJsSymbols as jest.Mock).mockReturnValue(["f|abs()", "c|pi"]);
	});

	it("returns null in onTrigger when suggestions are disabled", () => {
		const plugin = {
			...basePlugin,
			settings: {
				...basePlugin.settings,
				provideSuggestions: false,
			},
		};
		const suggestor = new NumeralsSuggestor(plugin);
		const editor = createMockEditor(["```math", "a = 1"]);

		const result = suggestor.onTrigger(
			{ line: 1, ch: 5 },
			editor as any,
			{} as any
		);

		expect(result).toBeNull();
	});

	it("returns trigger info when cursor is inside a math block", () => {
		const suggestor = new NumeralsSuggestor(basePlugin);
		const editor = createMockEditor(["```math", "answer = val"]);

		const result = suggestor.onTrigger(
			{ line: 1, ch: 12 },
			editor as any,
			{} as any
		) as EditorSuggestTriggerInfo;

		expect(result).not.toBeNull();
		expect(result.query).toBe("val");
	});

	it("returns null when cursor is outside a math block", () => {
		const suggestor = new NumeralsSuggestor(basePlugin);
		const editor = createMockEditor(["Paragraph text", "answer = val"]);

		const result = suggestor.onTrigger(
			{ line: 1, ch: 12 },
			editor as any,
			{} as any
		);

		expect(result).toBeNull();
	});

	it("combines local, metadata, and mathjs suggestions", () => {
		const suggestor = new NumeralsSuggestor(basePlugin);
		const editor = createMockEditor([
			"```math",
			"alpha = 1",
			"beta = alpha + 2",
			"alpha",
		]);

		const context = {
			editor,
			start: { line: 3, ch: 5 },
			query: "a",
			file: { path: "note.md" },
		} as unknown as EditorSuggestContext;

		const suggestions = suggestor.getSuggestions(context) as string[];

		expect(suggestions).toContain("v|alpha");
		expect(suggestions).toContain("f|abs()");
		expect(getMetadataForFileAtPath).toHaveBeenCalled();
		expect(getScopeFromFrontmatter).toHaveBeenCalled();
	});
});
