import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default defineConfig({
  plugins: [
    forgePlugin(),
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "{{siteId}}",
        short_name: "{{siteId}}",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' fill='%230f172a' rx='24'/%3E%3Ctext x='96' y='120' font-size='96' text-anchor='middle' fill='white'%3E%E2%9A%92%3C/text%3E%3C/svg%3E",
            sizes: "192x192",
            type: "image/svg+xml",
          },
        ],
      },
    }),
  ],
});
