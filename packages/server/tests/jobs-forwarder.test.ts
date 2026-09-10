import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { JobDefinitionSchema } from "@ism0080/forge-core";
import { WebhookConfigService } from "../src/config/webhook.js";
import { JobForwarderService, JobForwarderWebhookLayer } from "../src/services/jobs/forwarder.js";

const job = Schema.decodeUnknownSync(JobDefinitionSchema)({
  id: "job-1",
  siteId: "site-1",
  name: "cleanup",
  schedule: "0 3 * * *",
  enabled: true,
  nextRunAt: new Date(0).toISOString(),
  runCount: 0,
  version: 1,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

const forwardWith = (status: number, body: string) =>
  Effect.gen(function* () {
    const forwarder = yield* JobForwarderService;
    return yield* forwarder.forward(job);
  }).pipe(
    Effect.provide(
      JobForwarderWebhookLayer.pipe(
        Layer.provide(
          Layer.merge(
            WebhookConfigService.testLayer,
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(
                  HttpClientResponse.fromWeb(request, new Response(body, { status })),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

describe("JobForwarderWebhookLayer", () => {
  it.effect("reports success for 2xx responses", () =>
    Effect.gen(function* () {
      const outcome = yield* forwardWith(200, "{}");
      expect(outcome.ok).toBe(true);
    }),
  );

  it.effect("reports failure for non-2xx responses", () =>
    Effect.gen(function* () {
      const outcome = yield* forwardWith(500, "boom");
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain("500");
    }),
  );
});
