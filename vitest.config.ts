import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ism0080/forge-core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@ism0080/forge-sdk": fileURLToPath(
        new URL("./packages/sdk/src/index.ts", import.meta.url),
      ),
      "@ism0080/forge-server/api": fileURLToPath(
        new URL("./packages/server/src/api.ts", import.meta.url),
      ),
      "@ism0080/forge-templates": fileURLToPath(
        new URL("./packages/templates/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
