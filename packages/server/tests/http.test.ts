import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import {
  DbCreateResponseSchema,
  JobListResponseSchema,
  JobResponseSchema,
} from "@ism0080/forge-core";
import { FetchHttpClient, HttpPlatform } from "effect/unstable/http";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppConfigLayer } from "../src/config/server.js";
import { WebhookConfigLayer } from "../src/config/webhook.js";
import { routes } from "../src/routes.js";
import { DbEventsInMemoryLayer } from "../src/services/db/events.js";
import { SchemaServiceLayer } from "../src/services/db/schema-service.js";
import { SiteConnectionsLayer } from "../src/services/db/sqlite-connection.js";
import { SqliteDatabaseLayer } from "../src/services/db/sqlite.js";
import { JobForwarderService } from "../src/services/jobs/forwarder.js";
import { JobsServiceLayer } from "../src/services/jobs/service.js";
import { LocalFileStorageLayer } from "../src/services/storage/local-file.js";

const jobForwarderTestLayer = Layer.succeed(JobForwarderService, {
  forward: () => Effect.succeed({ ok: true }),
});

const makeAppLayer = (root: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      STORAGE_ROOT: join(root, "store"),
      DATABASE_ROOT: join(root, "db"),
    }),
  );
  const base = Layer.mergeAll(
    SiteConnectionsLayer,
    DbEventsInMemoryLayer,
    NodeServices.layer,
    config,
  );
  const platform = Layer.mergeAll(HttpPlatform.layer, Etag.layerWeak).pipe(Layer.provide(base));
  const infra = Layer.mergeAll(base, platform);
  const services = Layer.mergeAll(
    AppConfigLayer,
    LocalFileStorageLayer,
    SqliteDatabaseLayer,
    SchemaServiceLayer,
    WebhookConfigLayer,
    FetchHttpClient.layer,
    JobsServiceLayer.pipe(Layer.provide(jobForwarderTestLayer)),
  ).pipe(Layer.provide(infra));
  return routes.pipe(Layer.provideMerge(Layer.mergeAll(services, infra)));
};

type Handler = (request: Request) => Promise<Response>;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const withServer = <A>(f: (handler: Handler) => Promise<A>): Promise<A> => {
  const root = mkdtempSync(join(tmpdir(), "forge-http-"));
  const { handler, dispose } = HttpRouter.toWebHandler(makeAppLayer(root), {
    disableLogger: true,
  });
  return f(handler).finally(() =>
    dispose().then(() => rmSync(root, { recursive: true, force: true })),
  );
};

const jsonRequest = (url: string, method: string, body: Schema.Json): Request =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: encodeJson(body),
  });

const siteId = "http-demo";

describe("HTTP contract", () => {
  it("returns the documented document CRUD status codes", () =>
    withServer(async (handler) => {
      const create = await handler(
        jsonRequest("http://forge/api/db/posts", "POST", { siteId, data: { title: "hi" } }),
      );
      expect(create.status).toBe(201);
      const { document } = Schema.decodeUnknownSync(DbCreateResponseSchema)(await create.json());

      const list = await handler(new Request(`http://forge/api/db/posts?siteId=${siteId}`));
      expect(list.status).toBe(200);

      const found = await handler(
        new Request(`http://forge/api/db/posts/${document.id}?siteId=${siteId}`),
      );
      expect(found.status).toBe(200);

      const missing = await handler(
        new Request(`http://forge/api/db/posts/missing?siteId=${siteId}`),
      );
      expect(missing.status).toBe(404);

      const updateConflict = await handler(
        jsonRequest(`http://forge/api/db/posts/${document.id}`, "PUT", {
          siteId,
          data: { title: "edited" },
          expectedVersion: 99,
        }),
      );
      expect(updateConflict.status).toBe(409);

      const deleteConflict = await handler(
        new Request(
          `http://forge/api/db/posts/${document.id}?siteId=${siteId}&expectedVersion=99`,
          { method: "DELETE" },
        ),
      );
      expect(deleteConflict.status).toBe(409);

      const deleted = await handler(
        new Request(
          `http://forge/api/db/posts/${document.id}?siteId=${siteId}&expectedVersion=${document.version}`,
          { method: "DELETE" },
        ),
      );
      expect(deleted.status).toBe(200);
    }));

  it("returns 404 for missing sites and unknown directory deletes", () =>
    withServer(async (handler) => {
      const site = await handler(new Request("http://forge/sites/nope/index.html"));
      expect(site.status).toBe(404);

      const deletion = await handler(
        new Request("http://forge/directory/nope", { method: "DELETE" }),
      );
      expect(deletion.status).toBe(404);
    }));

  it("returns 400 for unknown tables", () =>
    withServer(async (handler) => {
      const unknown = await handler(
        new Request(`http://forge/api/tables/does_not_exist?siteId=${siteId}`),
      );
      expect(unknown.status).toBe(400);
    }));

  it("creates, lists, runs, and deletes scheduled jobs", () =>
    withServer(async (handler) => {
      const create = await handler(
        jsonRequest("http://forge/api/jobs", "POST", {
          siteId,
          name: "nightly-cleanup",
          schedule: "0 3 * * *",
          payload: { kind: "cleanup" },
        }),
      );
      expect(create.status).toBe(201);
      const created = Schema.decodeUnknownSync(JobResponseSchema)(await create.json());
      expect(created.job.name).toBe("nightly-cleanup");

      const list = await handler(new Request(`http://forge/api/jobs?siteId=${siteId}`));
      expect(list.status).toBe(200);
      const listed = Schema.decodeUnknownSync(JobListResponseSchema)(await list.json());
      expect(listed.jobs).toHaveLength(1);

      const run = await handler(
        new Request(`http://forge/api/jobs/${created.job.id}/run?siteId=${siteId}`, {
          method: "POST",
        }),
      );
      expect(run.status).toBe(200);
      const ran = Schema.decodeUnknownSync(JobResponseSchema)(await run.json());
      expect(ran.job.lastStatus).toBe("success");

      const removed = await handler(
        new Request(
          `http://forge/api/jobs/${created.job.id}?siteId=${siteId}&expectedVersion=${ran.job.version}`,
          { method: "DELETE" },
        ),
      );
      expect(removed.status).toBe(200);
    }));

  it("rejects invalid cron schedules and missing jobs", () =>
    withServer(async (handler) => {
      const invalid = await handler(
        jsonRequest("http://forge/api/jobs", "POST", {
          siteId,
          name: "broken",
          schedule: "not a cron",
        }),
      );
      expect(invalid.status).toBe(400);

      const missing = await handler(
        new Request(`http://forge/api/jobs/missing/run?siteId=${siteId}`, { method: "POST" }),
      );
      expect(missing.status).toBe(404);
    }));
});
