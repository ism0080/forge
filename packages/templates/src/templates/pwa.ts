import { readFileSync } from "node:fs";
import { sharedFiles } from "../shared-files.js";
import type { Template } from "../types.js";

const read = (name: string) =>
  readFileSync(new URL(`../template-files/pwa/${name}`, import.meta.url), "utf8");

export const pwaTemplate: Template = {
  id: "pwa",
  name: "PWA",
  description: "A React PWA starter with Vite, Tailwind CSS v4, vite-plugin-pwa, and shadcn/ui.",
  files: [
    ...sharedFiles,
    {
      path: "oxlint.config.ts",
      content: read("oxlint.config.ts"),
    },
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
      path: "drizzle.config.ts",
      content: read("drizzle.config.ts"),
    },
    {
      path: "src/db/schema.ts",
      content: read("src/db/schema.ts"),
    },
    {
      path: "drizzle/0000_create_notes.sql",
      content: read("drizzle/0000_create_notes.sql"),
    },
    {
      path: "drizzle/meta/_journal.json",
      content: read("drizzle/meta/_journal.json"),
    },
    {
      path: "drizzle/meta/0000_snapshot.json",
      content: read("drizzle/meta/0000_snapshot.json"),
    },
    {
      path: "README.md",
      content: read("README.md"),
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
      path: "src/lib/use-theme.ts",
      content: read("src/lib/use-theme.ts"),
    },
    {
      path: "src/components/ui/spinner.tsx",
      content: read("src/components/ui/spinner.tsx"),
    },
    {
      path: "src/components/ui/button.tsx",
      content: read("src/components/ui/button.tsx"),
    },
    {
      path: "src/components/ui/badge.tsx",
      content: read("src/components/ui/badge.tsx"),
    },
    {
      path: "src/components/ui/card.tsx",
      content: read("src/components/ui/card.tsx"),
    },
    {
      path: "src/components/ui/input.tsx",
      content: read("src/components/ui/input.tsx"),
    },
  ],
};
