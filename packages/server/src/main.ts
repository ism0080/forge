import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { HttpServer, HttpRouter } from "effect/unstable/http";
import { ServerConfigLayer, ServerConfigService } from "./config/server.js";
import { LocalFileDatabaseLayer } from "./db/local-file.js";
import { DbEventsConsoleTapLayer, DbEventsInMemoryLayer } from "./db/events.js";
import { HttpRouterLayer, RoutesLayer } from "./routes/index.js";
import { LocalFileStorageLayer } from "./storage/local-file.js";

const AppLayer = HttpRouter.serve(RoutesLayer).pipe(
  Layer.provide(HttpRouterLayer),
  Layer.provide(DbEventsConsoleTapLayer),
  Layer.provide(LocalFileDatabaseLayer),
  Layer.provide(DbEventsInMemoryLayer),
  Layer.provide(LocalFileStorageLayer),
  Layer.provide(NodeServices.layer),
  Layer.provide(
    Layer.effect(
      HttpServer.HttpServer,
      Effect.flatMap(ServerConfigService, ({ port }) =>
        NodeHttpServer.make(createServer, { port }),
      ),
    ),
  ),
  Layer.provide(ServerConfigLayer),
);

Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
