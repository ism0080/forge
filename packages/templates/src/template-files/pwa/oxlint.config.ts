import { defineConfig } from "oxlint";
import { profiles } from "@ism0080/oxlint-plugin-forge/profiles";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  jsPlugins: [
    {
      name: "forge",
      specifier: "@ism0080/oxlint-plugin-forge",
    },
  ],
  categories: {
    correctness: "error",
  },
  rules: {
    complexity: "error",
    "no-unused-vars": "error",
    ...profiles.core,
    ...profiles.react,
    "forge/no-fixed-height-on-content": [
      "error",
      {
        allowedHeightUtilities: [
          "h-6",
          "h-8",
          "h-9",
          "h-10",
          "size-3",
          "size-4",
          "size-6",
          "size-8",
          "size-9",
          "size-10",
        ],
      },
    ],
  },
  env: {
    builtin: true,
  },
});
