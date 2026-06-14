import type { ForgeConfig } from "@ism0080/forge-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export interface ForgeVitePluginOptions {
  readonly configPath?: string;
  readonly base?: string;
}

const VIRTUAL_MODULE_ID = "virtual:forge";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;

export const forgePlugin = (options: ForgeVitePluginOptions = {}): Plugin => {
  const configPath = resolve(process.cwd(), options.configPath ?? "forge.json");
  const base = options.base ?? "./";

  return {
    name: "forge-config",
    config: () => ({
      base,
    }),
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null;
      }

      let raw: string;
      try {
        raw = readFileSync(configPath, "utf8");
      } catch (error) {
        this.error(
          `Unable to read forge config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }

      let config: ForgeConfig;
      try {
        config = JSON.parse(raw) as ForgeConfig;
      } catch (error) {
        this.error(
          `Invalid JSON in forge config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }

      if (!config.apiBaseUrl || typeof config.apiBaseUrl !== "string") {
        this.error(`Missing or invalid "apiBaseUrl" in forge config at ${configPath}`);
        return null;
      }

      if (!config.siteId || typeof config.siteId !== "string") {
        this.error(`Missing or invalid "siteId" in forge config at ${configPath}`);
        return null;
      }

      return `
export const apiBaseUrl = ${JSON.stringify(config.apiBaseUrl)};
export const baseUrl = apiBaseUrl;
export const siteId = ${JSON.stringify(config.siteId)};
export const spa = ${JSON.stringify(config.spa ?? true)};
export const entry = ${JSON.stringify(config.entry ?? ".")};
`;
    },
  };
};

export default forgePlugin;
