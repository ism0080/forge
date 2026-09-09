import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sharedFiles, templates } from "../src/index.js";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const sharedPaths = new Set(sharedFiles.map((file) => file.path));

describe("templates", () => {
  it.each(templates.map((template) => [template.id, template] as const))(
    "%s: has a name and description",
    (_id, template) => {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
    },
  );

  it.each(templates.map((template) => [template.id, template] as const))(
    "%s: every listed file exists in the template sources",
    (_id, template) => {
      const occurrences = new Map<string, number>();

      for (const file of template.files) {
        const occurrence = occurrences.get(file.path) ?? 0;
        occurrences.set(file.path, occurrence + 1);

        const sourceDir = sharedPaths.has(file.path)
          ? occurrence === 0
            ? `${srcDir}/shared`
            : `${srcDir}/template-files/${template.id}`
          : `${srcDir}/template-files/${template.id}`;

        expect(
          existsSync(`${sourceDir}/${file.path}`),
          `missing source for ${template.id}: ${file.path} (expected ${sourceDir}/${file.path})`,
        ).toBe(true);
      }
    },
  );

  it.each(templates.map((template) => [template.id, template] as const))(
    "%s: package.json is valid JSON with a name",
    (_id, template) => {
      const pkg = template.files.find((file) => file.path === "package.json");
      expect(pkg, "template must declare a package.json").toBeDefined();

      const parsed = JSON.parse(pkg!.content) as { name?: unknown };
      expect(parsed.name).toBeTypeOf("string");
    },
  );

  it("writes the site id placeholder without surrounding whitespace", () => {
    for (const template of templates) {
      for (const file of template.files) {
        expect(
          file.content,
          `${template.id}: ${file.path} contains {{ siteId }} with whitespace, which the CLI cannot replace`,
        ).not.toMatch(/\{\{\s+siteId\s+\}\}/);
      }
    }
  });

  it("only shared files may be overridden, and only once", () => {
    for (const template of templates) {
      const counts = new Map<string, number>();

      for (const file of template.files) {
        counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
      }

      for (const [path, count] of counts) {
        if (count === 1) {
          continue;
        }

        expect(
          sharedPaths.has(path),
          `${template.id}: ${path} is listed ${count} times but is not a shared file`,
        ).toBe(true);
        expect(count, `${template.id}: ${path} is listed ${count} times`).toBe(2);
      }
    }
  });
});
