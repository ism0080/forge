import { readFileSync } from "node:fs";
import { sharedFiles } from "../shared-files.js";
import type { Template } from "../types.js";

const read = (name: string) =>
  readFileSync(new URL(`../template-files/pwa/${name}`, import.meta.url), "utf8");

export const pwaTemplate: Template = {
  id: "pwa",
  name: "PWA",
  description: "A React PWA starter with Vite, Tailwind CSS v4, vite-plugin-pwa, and coss ui.",
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
      path: "src/globals.css",
      content: read("src/globals.css"),
    },
    {
      path: "src/main.tsx",
      content: read("src/main.tsx"),
    },
    {
      path: "src/routes/__root.tsx",
      content: read("src/routes/__root.tsx"),
    },
    {
      path: "src/routes/index.tsx",
      content: read("src/routes/index.tsx"),
    },
    {
      path: "src/lib/utils.ts",
      content: read("src/lib/utils.ts"),
    },
    {
      path: "src/components/ui/spinner.tsx",
      content: read("src/components/ui/spinner.tsx"),
    },
    {
      path: "src/components/ui/button.tsx",
      content: read("src/components/ui/button.tsx"),
    },
  ],
};
