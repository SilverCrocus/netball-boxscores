import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "graphify-out/**",
  ]),
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "scripts/**/*.ts"],
    rules: {
      // Test doubles and one-off data repair scripts intentionally mirror
      // loosely typed external payloads; production application code stays strict.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
