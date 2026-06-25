import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { DbGroup } from "./groups/db.js";
import { HealthGroup } from "./groups/health.js";
import { IdentityGroup } from "./groups/identity.js";
import { PluginsGroup } from "./groups/plugins.js";
import { SitesGroup } from "./groups/sites.js";
import { UploadGroup } from "./groups/upload.js";
import { WebhookGatewayGroup } from "./groups/webhook.js";

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(WebhookGatewayGroup)
  .add(DbGroup)
  .add(SitesGroup)
  .add(UploadGroup)
  .add(PluginsGroup)
  .add(IdentityGroup)
  .annotateMerge(OpenApi.annotations({ title: "Forge HttpApi", version: "0.0.1" }));
