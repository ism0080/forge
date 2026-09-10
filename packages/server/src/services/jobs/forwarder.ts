import type { JobDefinition } from "@ism0080/forge-core";
import { Context, Effect, Layer, Option, Redacted, Schedule } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { WebhookConfigService } from "../../config/webhook.js";

export interface JobRunOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

export interface JobForwarderApi {
  readonly forward: (job: JobDefinition) => Effect.Effect<JobRunOutcome>;
}

export class JobForwarderService extends Context.Service<
  JobForwarderService,
  JobForwarderApi
>()("forge/JobForwarderService") {}

export const JobForwarderWebhookLayer = Layer.effect(
  JobForwarderService,
  Effect.gen(function* () {
    const { externalApiUrl, externalApiKey } = yield* WebhookConfigService;
    const client = yield* HttpClient.HttpClient;

    const forward = (job: JobDefinition): Effect.Effect<JobRunOutcome> =>
      Effect.gen(function* () {
        const apiUrl = Option.getOrNull(externalApiUrl);
        const apiKey = Option.match(externalApiKey, {
          onNone: () => "",
          onSome: (value) => Redacted.value(value),
        });
        if (apiUrl === null || apiUrl === "" || apiKey === "") {
          return { ok: false, error: "External API key or URL is not configured" };
        }

        const requestBody = {
          title: `Forge job: ${job.name}`,
          message: `Scheduled job "${job.name}" ran`,
          payload: job.payload ?? null,
        };

        const retryPolicy = Schedule.exponential("100 millis").pipe(
          Schedule.both(Schedule.recurs(3)),
        );

        const program = HttpClientRequest.post(apiUrl).pipe(
          HttpClientRequest.bodyJsonUnsafe(requestBody),
          HttpClientRequest.setHeaders({
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          }),
          client.execute,
          Effect.timeout("2 seconds"),
          Effect.retry(retryPolicy),
          Effect.timeout("10 seconds"),
        );

        return yield* program.pipe(
          Effect.flatMap((response): Effect.Effect<JobRunOutcome> =>
            response.status >= 200 && response.status < 300
              ? Effect.succeed({ ok: true })
              : response.text.pipe(
                  Effect.orElseSucceed(() => ""),
                  Effect.map((body) => ({
                    ok: false,
                    error: `external API responded with status ${response.status}${
                      body === "" ? "" : `: ${body}`
                    }`,
                  })),
                ),
          ),
          Effect.match({
            onFailure: (error) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
            onSuccess: (outcome) => outcome,
          }),
        );
      });

    return { forward };
  }),
);
