import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Predicate, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { HookHandler, Plugin } from "vite";
import { forgePlugin } from "../src/index.js";

const dirs: Array<string> = [];

const writeConfig = (config: Schema.Json): string => {
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

type ForgePlugin = ReturnType<typeof forgePlugin>;
type ConfigHook = HookHandler<NonNullable<Plugin["config"]>>;
type LoadHook = HookHandler<NonNullable<Plugin["load"]>>;

const ForgeBaseConfigSchema = Schema.Struct({ base: Schema.optional(Schema.String) });

const hookContext = {
  error: (message: string): never => {
    throw new Error(message);
  },
};

const pluginConfig = (plugin: ForgePlugin): { readonly base?: string | undefined } => {
  const hook = plugin.config;
  if (hook === undefined) {
    throw new Error("forge plugin does not define a config hook");
  }
  const handler = "handler" in hook ? hook.handler : hook;
  // SAFETY: the forge config hook only reads `this.error`, which hookContext supplies.
  const result = handler.call(
    hookContext as ThisParameterType<ConfigHook>,
    {},
    {
      command: "build",
      mode: "production",
    },
  );
  return Schema.decodeUnknownSync(ForgeBaseConfigSchema)(result);
};

const loadVirtual = (plugin: ForgePlugin): string | null => {
  const hook = plugin.load;
  if (hook === undefined) {
    throw new Error("forge plugin does not define a load hook");
  }
  const handler = "handler" in hook ? hook.handler : hook;
  // SAFETY: the forge load hook only reads `this.error`, which hookContext supplies.
  const result = handler.call(hookContext as ThisParameterType<LoadHook>, "\0virtual:forge");
  if (!Predicate.isString(result)) {
    throw new Error("forge load hook did not return a module source");
  }
  return result;
};

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
