import { defineConfig } from "oxlint";

import { profiles } from "./packages/tools/oxlint/profiles.ts";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  ignorePatterns: ["node_modules", "dist", "tools"],
  jsPlugins: [
    {
      name: "forge",
      specifier: "./packages/tools/oxlint/index.ts",
    },
  ],
  categories: {
    correctness: "error",
  },
  rules: {
    complexity: "error",
    // ...profiles.core,
  },
  overrides: [
    {
      files: ["packages/tools/oxlint/{rules,shared}/**/*.ts"],
      rules: {
        complexity: "off",
      },
    },
    {
      files: ["packages/core/**/*.ts", "packages/server/**/*.ts"],
      rules: profiles.effect,
    },
  ],
  env: {
    builtin: true,
  },
});
