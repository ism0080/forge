import { Layer } from "effect";
import { DbHandler } from "./handlers/db.js";
import { HealthHandler } from "./handlers/health.js";
import { PluginsHandler } from "./handlers/plugins.js";
import { SitesHandler } from "./handlers/sites.js";
import { UploadHandler } from "./handlers/upload.js";
import { WebhookGatewayHandler } from "./handlers/webhook.js";

export const handlers = Layer.mergeAll(
  HealthHandler,
  WebhookGatewayHandler,
  DbHandler,
  SitesHandler,
  UploadHandler,
  PluginsHandler,
);
