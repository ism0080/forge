/// <reference types="@ism0080/forge-vite-plugin/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { apiBaseUrl, siteId } from "virtual:forge";
import { createClient } from "@ism0080/forge-sdk";
import { routeTree } from "./routeTree.gen";
import "./globals.css";

const queryClient = new QueryClient();
const client = await createClient({ baseUrl: apiBaseUrl, siteId });
console.log("Forge site:", siteId, apiBaseUrl, client);

const router = createRouter({
  routeTree,
  context: { queryClient, client },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
