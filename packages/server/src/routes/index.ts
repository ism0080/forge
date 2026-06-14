import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { ServerConfigService } from "../config/server.js";
import { DbCreateRoute, DbDeleteRoute, DbListRoute, DbUpdateRoute } from "./db.js";
import { DbEventsRoute } from "./db-events.js";
import { HealthRoute } from "./health.js";
import { WhoamiRoute } from "./identity.js";
import { NotFoundRoute } from "./not-found.js";
import { PluginsRoute } from "./plugins.js";
import { DirectoryRoute, SiteRoute } from "./sites.js";
import { UploadRoute } from "./upload.js";
import { WebhookRoute } from "./webhook.js";
import { Effect } from "effect";

export const RoutesLayer = Layer.mergeAll(
  HealthRoute,
  WhoamiRoute,
  PluginsRoute,
  DirectoryRoute,
  UploadRoute,
  DbEventsRoute,
  DbListRoute,
  DbCreateRoute,
  DbUpdateRoute,
  DbDeleteRoute,
  SiteRoute,
  WebhookRoute,
  NotFoundRoute,
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { port } = yield* ServerConfigService;
      yield* Effect.log(`@forge/server listening on http://localhost:${port}`);
    }),
  ),
);

export const HttpRouterLayer = HttpRouter.layer;
