/**
 * ESLint flat config for the Uma Club Bot.
 *
 * Baseline: ESLint recommended + typescript-eslint recommended
 * (non-type-checked — runs fast, no project service needed).
 * Curated rules target the complexity and anti-pattern gaps the
 * tsc-only lint:check could not catch.
 *
 * Severity policy: rules the codebase currently satisfies stay at
 * "error". Rules that fire on the existing tree sit at "warn" so
 * lint:check stays green; each warn is a documented debt item for a
 * follow-up session (complexity refactors, unused-symbol cleanup,
 * Baileys `any` typing).
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "coverage/", "node_modules/", "data/", "scripts/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      complexity: ["warn", 15],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-nested-ternary": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
