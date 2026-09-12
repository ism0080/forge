import "varlock/auto-load";
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, Layer } from "effect";
import * as ByteSize from "effect/ByteSize";
import { FetchHttpClient, HttpIncomingMessage, HttpRouter } from "effect/unstable/http";
import { routes } from "./routes.js";
import { AppConfigLayer, DEFAULT_UPLOAD_MAX_BYTES, serverConfig } from "./config/server.js";
import { WebhookConfigLayer } from "./config/webhook.js";
import { DbEventsConsoleTapLayer, DbEventsInMemoryLayer } from "./services/db/events.js";
import { DbClockLayer } from "./services/db/shared.js";
import { SqliteDatabaseLayer } from "./services/db/sqlite.js";
import { SiteConnectionsLayer } from "./services/db/sqlite-connection.js";
import { SchemaServiceLayer } from "./services/db/schema-service.js";
import { JobForwarderWebhookLayer } from "./services/jobs/forwarder.js";
import { JobsServiceLayer } from "./services/jobs/service.js";
import { JobRunnerLayer } from "./services/jobs/runner.js";
import { LocalFileStorageLayer } from "./services/storage/local-file.js";
import { CorsMiddleware } from "./middleware/cors.js";

const ServerLive = NodeHttpServer.layerConfig(() => createServer(), serverConfig);

const RequestBodyLimitLive = Layer.effect(
  HttpIncomingMessage.MaxBodySize,
  Config.Number("UPLOAD_MAX_BYTES").pipe(
    Config.withDefault(DEFAULT_UPLOAD_MAX_BYTES),
    Effect.map((bytes) => ByteSize.bytes(bytes)),
  ),
);

const InfrastructureLive = Layer.mergeAll(
  SiteConnectionsLayer,
  DbEventsInMemoryLayer,
  NodeServices.layer,
);

const WebhookForwardingLive = JobForwarderWebhookLayer.pipe(
  Layer.provide(Layer.mergeAll(WebhookConfigLayer, FetchHttpClient.layer, InfrastructureLive)),
);

const JobsLive = JobsServiceLayer.pipe(Layer.provide(WebhookForwardingLive));

const JobRunnerLive = JobRunnerLayer.pipe(Layer.provide(Layer.merge(JobsLive, DbClockLayer)));

const ApplicationServicesLive = Layer.merge(
  InfrastructureLive,
  Layer.mergeAll(
    AppConfigLayer,
    RequestBodyLimitLive,
    LocalFileStorageLayer,
    SqliteDatabaseLayer,
    SchemaServiceLayer,
    DbEventsConsoleTapLayer,
    WebhookConfigLayer,
    FetchHttpClient.layer,
    WebhookForwardingLive,
    JobsLive,
    JobRunnerLive,
  ).pipe(Layer.provide(InfrastructureLive)),
);

const HttpLive = Layer.merge(
  HttpRouter.layer,
  CorsMiddleware.pipe(Layer.provide(HttpRouter.layer)),
);

const main = HttpRouter.serve(routes).pipe(
  Layer.provide(Layer.mergeAll(ServerLive, HttpLive, ApplicationServicesLive)),
);

Layer.launch(main).pipe(NodeRuntime.runMain);
