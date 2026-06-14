import type { PluginDescriptor } from "@ism0080/forge-core";

export const plugins: ReadonlyArray<PluginDescriptor> = [
  {
    id: "identity",
    capabilities: [
      {
        id: "whoami",
        description: "Returns authenticated user profile",
      },
    ],
  },
  {
    id: "files",
    capabilities: [
      {
        id: "upload",
        description: "Uploads static assets to object storage",
      },
      {
        id: "serve",
        description: "Serves site assets from object storage",
      },
    ],
  },
];
