import { unescapeSubscripts, getScopeFromFrontmatter } from "./numeralsUtilities";

describe("unescapeSubscripts function", () => {
	test("Basic Case", () => {
		expect(unescapeSubscripts("x\\_1")).toBe("x_{1}");
	});

	test("Basic Case - Multiple subscript characters ", () => {
		expect(unescapeSubscripts("x\\_red")).toBe("x_{red}");
	});

	test("Basic Case - Longer Words", () => {
		expect(unescapeSubscripts("blue\\_red")).toBe("blue_{red}");
	});

	test("Basic Case - Numbers", () => {
		expect(unescapeSubscripts("Dog\\_1")).toBe("Dog_{1}");
	});

	test("No Subscript", () => {
		expect(unescapeSubscripts("no_subscript_here")).toBe(
			"no_subscript_here"
		);
	});

	test("Multiple Escaped Subscripts", () => {
		expect(unescapeSubscripts("a\\_b\\_c")).toBe("a_{b}\\_c");
	});

	test("Non-English Characters", () => {
		expect(unescapeSubscripts("α\\_1")).toBe("α_{1}");
	});

	test("Special Characters", () => {
		expect(unescapeSubscripts("$_\\_$")).toBe("$__{$}");
	});

	test("Nested Escaped Subscripts", () => {
		expect(unescapeSubscripts("x\\_y\\_z")).toBe("x_{y}\\_z");
	});

	test("Escaped Subscripts At The Start", () => {
		expect(unescapeSubscripts("\\_x")).toBe("\\_x");
	});

	test("Empty String", () => {
		expect(unescapeSubscripts("")).toBe("");
	});

	test("Input With Only Escaped Underscore", () => {
		expect(unescapeSubscripts("\\_")).toBe("\\_");
	});

	test("Long Input", () => {
		const longInput = "x".repeat(10000) + "\\_1";
		const expectedOutput = "x".repeat(10000) + "_{1}";
		expect(unescapeSubscripts(longInput)).toBe(expectedOutput);
	});

	test("Multiple Instances in Single Input", () => {
		expect(unescapeSubscripts("x\\_1 + y\\_2 = z\\_3")).toBe(
			"x_{1} + y_{2} = z_{3}"
		);
	});

	test("Input with Spaces", () => {
		expect(unescapeSubscripts("x \\_ 1")).toBe("x \\_ 1");
	});

	test("Input with Additional Escape Characters", () => {
		expect(unescapeSubscripts("x\\\\_1")).toBe("x\\\\_1");
	});

	test("Combination of Escaped and Non-escaped Subscripts", () => {
		expect(unescapeSubscripts("a_b + x\\_1")).toBe("a_b + x_{1}");
	});

	test("Unicode Characters as Subscripts", () => {
		expect(unescapeSubscripts("x\\_αβγ")).toBe("x_{αβγ}");
	});

	test("Non-alphanumeric Characters Following Escaped Subscript", () => {
		expect(unescapeSubscripts("x\\_1+2")).toBe("x_{1}+2");
	});

	test("Mix of Capitals and Lowercase", () => {
		expect(unescapeSubscripts("XyZ\\_aBc")).toBe("XyZ_{aBc}");
	});

	test("Escaped Subscripts Inside Parentheses", () => {
		expect(unescapeSubscripts("(a\\_1)(b\\_2)")).toBe("(a_{1})(b_{2})");
	});

	test("Input with Multiple Lines", () => {
		expect(unescapeSubscripts("x\\_1\ny\\_2\nz\\_3")).toBe(
			"x_{1}\ny_{2}\nz_{3}"
		);
	});

	test("Input with Non-English Words", () => {
		expect(unescapeSubscripts("über\\_alles")).toBe("über_{alles}");
	});
});

describe("processFrontmatter", () => {

	test('should process all keys when numerals is set to "all"', () => {
		const frontmatter = { numerals: "all", x: "5+2", y: 7 };
		const scope = new Map();
		const expectedScope = new Map([
			["x", 7],
			["y", 7],
		]);
		expect(getScopeFromFrontmatter(frontmatter, scope)).toEqual(expectedScope);
	});

	test('should not process any keys when numerals is set to "none"', () => {
		const frontmatter = { numerals: "none", x: "5+2", y: 7 };
		const scope = new Map();
		expect(getScopeFromFrontmatter(frontmatter, scope)).toEqual(new Map());
	});

	test("should process only specific key when numerals is a string", () => {
		const frontmatter = { numerals: "x", x: "5+2", y: 7 };
		const scope = new Map();
		const expectedScope = new Map([["x", 7]]);
		expect(getScopeFromFrontmatter(frontmatter, scope)).toEqual(expectedScope);
	});

	test("should process specific keys when numerals is an array", () => {
		const frontmatter = { numerals: ["x"], x: "5+2", y: 7 };
		const scope = new Map();
		const expectedScope = new Map([["x", 7]]);
		expect(getScopeFromFrontmatter(frontmatter, scope)).toEqual(expectedScope);
	});

	test("should process all keys when forceAll is set to true", () => {
		const frontmatter = { x: "5+2", y: 7 };
		const scope = new Map();
		const expectedScope = new Map([
			["x", 7],
			["y", (7)],
		]);
		expect(getScopeFromFrontmatter(frontmatter, scope, true)).toEqual(
			expectedScope
		);
	});

	test("should add processed keys to existing scope", () => {
		const frontmatter = { numerals: "all", x: "5+2", y: 7 };
		const scope = new Map([["z", 2]]);
		const expectedScope = new Map([
			["z", 2],
			["x", 7],
			["y", 7],
		]);
		expect(getScopeFromFrontmatter(frontmatter, scope)).toEqual(expectedScope);
	});

	test("should handle invalid expressions", () => {
		const frontmatter = { numerals: "all", x: "invalid_expression", y: 7 };
		const scope = new Map();
		expect(() => getScopeFromFrontmatter(frontmatter, scope)).toThrow();
	});
});
