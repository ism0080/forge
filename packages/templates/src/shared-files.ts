import { readFileSync } from "node:fs";
import type { TemplateFile } from "./types.js";

const read = (name: string) =>
  readFileSync(new URL(`./shared/${name}`, import.meta.url), "utf8");

export const sharedFiles: ReadonlyArray<TemplateFile> = [
  {
    path: ".gitignore",
    content: read(".gitignore"),
  },
  {
    path: ".oxlintrc.json",
    content: read(".oxlintrc.json"),
  },
];
