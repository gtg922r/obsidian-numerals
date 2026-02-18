// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Ignore non-source files
  { ignores: ["__mocks__/**", "tests/**", "scripts/**", "src/**/*.test.ts"] },

  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      // TypeScript compiler handles undefined variable checking; the obsidianmd
      // recommended config re-enables this but it doesn't understand TS globals.
      "no-undef": "off",

      // @codemirror/* are provided by obsidian at runtime, obsidian-dataview
      // is an optional peer dep. This rule doesn't understand bundled plugins.
      "import/no-extraneous-dependencies": "off",

      // Project-specific overrides
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
]);
