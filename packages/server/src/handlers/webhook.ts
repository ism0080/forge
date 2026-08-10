import { Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api.js";
import { Effect, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { WebhookConfigService } from "../config/webhook.js";

export const WebhookGatewayHandler = HttpApiBuilder.group(
  Api,
  "server.webhook.gateway",
  (handlers) =>
    Effect.gen(function* () {
      const { externalApiUrl, externalApiKey } = yield* WebhookConfigService;
      const client = yield* HttpClient.HttpClient;

      return handlers.handle(
        "webhook.forward",
        Effect.fn("Webhook.forward")(({ payload }) => {
          const requestBody = {
            title: payload.title,
            message: payload.message,
            payload: payload.payload ?? null,
          };

          const apiUrl = Option.getOrNull(externalApiUrl);
          const apiKey = Redacted.value(Option.getOrElse(() => Redacted.make(null))(externalApiKey));

          if (!apiKey || !apiUrl) {
            return Effect.fail({
              forwarded: false as const,
              error: "External API key or URL is not configured",
            });
          }

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
            Effect.flatMap((response) =>
              HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
                Effect.map((body) => ({
                  forwarded: true as const,
                  externalStatus: response.status,
                  externalBody: body,
                })),
              ),
            ),
            // Timeout each individual attempt
            Effect.timeout("2 seconds"),
            // Retry failed attempts with exponential backoff
            Effect.retry(retryPolicy),
            // Overall timeout for all attempts
            Effect.timeout("10 seconds"),
            Effect.withSpan("Webhook.forward"),
          );

          return Effect.matchEffect(program, {
            onSuccess: (result) => Effect.succeed(result),
            onFailure: (error) =>
              Effect.fail({
                forwarded: false as const,
                error: error instanceof Error ? error.message : String(error),
              }),
          });
        }),
      );
    }),
);
