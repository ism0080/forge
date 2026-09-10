import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forgePlugin } from "../src/index.js";

const dirs: Array<string> = [];

const writeConfig = (config: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "forge-plugin-"));
  dirs.push(dir);
  const configPath = join(dir, "forge.json");
  writeFileSync(configPath, JSON.stringify(config));
  return configPath;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const baseConfig = {
  siteId: "demo",
  entry: "dist",
  apiBaseUrl: "http://localhost:8787",
  spa: true,
};

type ConfigHook = () => { readonly base?: string };
type LoadHook = (
  this: { readonly error: (message: string) => never },
  id: string,
) => string | null;

const pluginConfig = (plugin: ReturnType<typeof forgePlugin>): { readonly base?: string } =>
  (plugin.config as unknown as ConfigHook)();

const loadVirtual = (plugin: ReturnType<typeof forgePlugin>): string | null =>
  (plugin.load as unknown as LoadHook).call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    "\0virtual:forge",
  );

describe("forgePlugin", () => {
  it("sets the Vite base to the site subpath", () => {
    const configPath = writeConfig(baseConfig);
    const plugin = forgePlugin({ configPath });
    expect(pluginConfig(plugin).base).toBe("/s/demo/");
  });

  it("exports the resolved basePath through virtual:forge", () => {
    const configPath = writeConfig(baseConfig);
    const source = loadVirtual(forgePlugin({ configPath }));
    expect(source).toContain('export const basePath = "/s/demo/"');
  });

  it("honors an explicit base override", () => {
    const configPath = writeConfig(baseConfig);
    const plugin = forgePlugin({ configPath, base: "/custom/" });
    expect(pluginConfig(plugin).base).toBe("/custom/");
    expect(loadVirtual(plugin)).toContain('export const basePath = "/custom/"');
  });

  it("falls back to a relative base when forge.json is missing", () => {
    const plugin = forgePlugin({ configPath: "/tmp/definitely-missing-forge.json" });
    expect(pluginConfig(plugin).base).toBe("./");
  });
});
