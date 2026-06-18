import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { DbGroup } from "./groups/db";
import { HealthGroup } from "./groups/health";
import { IdentityGroup } from "./groups/identity";
import { PluginsGroup } from "./groups/plugins";
import { SitesGroup } from "./groups/sites";
import { UploadGroup } from "./groups/upload";
import { WebhookGatewayGroup } from "./groups/webhook";

export const Api = HttpApi.make("server")
  .add(HealthGroup)
  .add(WebhookGatewayGroup)
  .add(DbGroup)
  .add(SitesGroup)
  .add(UploadGroup)
  .add(PluginsGroup)
  .add(IdentityGroup)
  .annotateMerge(OpenApi.annotations({ title: "Forge HttpApi", version: "0.0.1" }));
