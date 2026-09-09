import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [forgePlugin()],
});
