import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const CapabilityDescriptorSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
});

const PluginDescriptorSchema = Schema.Struct({
  id: Schema.String,
  capabilities: Schema.Array(CapabilityDescriptorSchema),
});

const PluginsResponseSchema = Schema.Struct({
  plugins: Schema.Array(PluginDescriptorSchema),
});

export const PluginsGroup = HttpApiGroup.make("server.plugins")
  .prefix("/api")
  .add(
    HttpApiEndpoint.get("plugins.list", "/plugins", {
      success: PluginsResponseSchema,
    }),
  );
