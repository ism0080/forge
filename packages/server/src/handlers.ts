import { Layer } from "effect";
import { DbHandler } from "./handlers/db";
import { HealthHandler } from "./handlers/health";
import { IdentityHandler } from "./handlers/identity";
import { PluginsHandler } from "./handlers/plugins";
import { SitesHandler } from "./handlers/sites";
import { UploadHandler } from "./handlers/upload";
import { WebhookGatewayHandler } from "./handlers/webhook";

export const handlers = Layer.mergeAll(
  HealthHandler,
  WebhookGatewayHandler,
  DbHandler,
  SitesHandler,
  UploadHandler,
  PluginsHandler,
  IdentityHandler,
);
