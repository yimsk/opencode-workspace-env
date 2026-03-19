import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [nkzw],
  ignorePatterns: ["node_modules", "dist", ".sisyphus", "build", "**/*.d.ts"],
  overrides: [
    // Test files: allow patterns reasonable for testing
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**/*.ts", "**/test/**/*.tsx"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-function-type": "off",
        "no-empty": "off",
        "no-unsafe-optional-chaining": "off",
        "require-yield": "off",
        "unicorn/consistent-function-scoping": "off",
      },
    },
  ],
});
