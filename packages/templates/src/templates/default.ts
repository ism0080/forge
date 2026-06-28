import { readFileSync } from "node:fs";
import { sharedFiles } from "../shared-files.js";
import type { Template } from "../types.js";

const read = (name: string) =>
  readFileSync(new URL(`../template-files/default/${name}`, import.meta.url), "utf8");

export const defaultTemplate: Template = {
  id: "default",
  name: "Default",
  description: "A minimal Forge site with Vite, TypeScript, oxlint, and oxfmt.",
  files: [
    ...sharedFiles,
    {
      path: "index.html",
      content: read("index.html"),
    },
    {
      path: "package.json",
      content: read("package.json"),
    },
    {
      path: "tsconfig.json",
      content: read("tsconfig.json"),
    },
    {
      path: "vite.config.ts",
      content: read("vite.config.ts"),
    },
    {
      path: "src/main.ts",
      content: read("src/main.ts"),
    },
  ],
};
