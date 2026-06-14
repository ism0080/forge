import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layerFetch } from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpServer, HttpRouter } from "effect/unstable/http";
import { ServerConfigLayer, ServerConfigService } from "./config/server.js";
import { WebhookConfigLayer } from "./config/webhook.js";
import { LocalFileDatabaseLayer } from "./db/local-file.js";
import { DbEventsConsoleTapLayer, DbEventsInMemoryLayer } from "./db/events.js";
import { HttpRouterLayer, RoutesLayer } from "./routes/index.js";
import { LocalFileStorageLayer } from "./storage/local-file.js";

const CorsMiddleware = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: [],
    allowedMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Forge-User-Id",
      "X-Forge-User-Email",
      "X-Forge-User-Name",
      "X-Forge-User-Team",
    ],
    credentials: true,
    maxAge: 86400,
  }),
  { global: true },
);

const AppLayer = HttpRouter.serve(RoutesLayer).pipe(
  Layer.provideMerge(CorsMiddleware),
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
  Layer.provide(layerFetch),
  Layer.provide(WebhookConfigLayer),
);

Layer.launch(AppLayer).pipe(NodeRuntime.runMain);
