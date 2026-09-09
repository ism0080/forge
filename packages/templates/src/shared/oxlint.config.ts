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
  },
  env: {
    builtin: true,
  },
});
