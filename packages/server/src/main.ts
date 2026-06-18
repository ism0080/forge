import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { layerFetch } from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { routes } from "./routes.js";
import { AppConfigLayer, serverConfig } from "./config/server.js";
import { WebhookConfigLayer } from "./config/webhook.js";
import { DbEventsConsoleTapLayer, DbEventsInMemoryLayer } from "./services/db/events.js";
import { LocalFileDatabaseLayer } from "./services/db/local-file.js";
import { LocalFileStorageLayer } from "./services/storage/local-file.js";
import { CorsMiddleware } from "./middleware/cors.js";

const ServerLive = NodeHttpServer.layerConfig(() => createServer(), serverConfig);

const main = HttpRouter.serve(routes).pipe(
  Layer.provideMerge(CorsMiddleware),
  Layer.provide(ServerLive),
  Layer.provide(AppConfigLayer),
  Layer.provide(HttpRouter.layer),
  Layer.provide(LocalFileStorageLayer),
  Layer.provide(LocalFileDatabaseLayer),
  Layer.provide(DbEventsConsoleTapLayer),
  Layer.provide(DbEventsInMemoryLayer),
  Layer.provide(WebhookConfigLayer),
  Layer.provide(layerFetch),
  Layer.provide(NodeServices.layer),
);

Layer.launch(main).pipe(NodeRuntime.runMain);
