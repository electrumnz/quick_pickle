import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".lighthouseci/**",
    "next-env.d.ts",
    // Private build directories (see next.config.ts).
    ".scratch/**",
    // Private copies of the repository that helpers work in.
    ".claude/**",
    // Generated from the official vector art by scripts/build-vectors.py.
    "lib/brand/art/lucky-run.ts",
    "lib/brand/art/lucky-up.ts",
    "lib/brand/art/lockup-letters.ts",
    // Deliberately-bad copy the scanner's self-test must catch.
    "legal/test-fixtures/**",
  ]),
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
