import { PluginsListResponseSchema } from "@ism0080/forge-core";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export const PluginsGroup = HttpApiGroup.make("server.plugins").add(
  HttpApiEndpoint.get("plugins.list", "/api/plugins", {
    success: PluginsListResponseSchema,
  }),
);
