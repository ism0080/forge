import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { WebhookConfigService } from "../config/webhook.js";

const WebhookBodySchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  payload: Schema.optional(Schema.Unknown),
});

export const WebhookRoute = HttpRouter.add(
  "POST",
  "/api/webhook",
  Effect.gen(function* () {
    const { externalApiUrl, externalApiKey } = yield* WebhookConfigService;
    const client = yield* HttpClient.HttpClient;

    const body = yield* HttpServerRequest.schemaBodyJson(WebhookBodySchema);

    const externalBody = {
      title: body.title,
      message: body.message,
      payload: body.payload ?? null,
    };

    const externalRequest = HttpClientRequest.post(externalApiUrl, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${externalApiKey}`,
      },
    }).pipe(HttpClientRequest.bodyJsonUnsafe(externalBody));

    const response = yield* Effect.matchEffect(client.execute(externalRequest), {
      onSuccess: (res) =>
        Effect.gen(function* () {
          const status = res.status;
          const externalBody = yield* res.json.pipe(
            Effect.orElseSucceed(() => null)
          );
          return HttpServerResponse.jsonUnsafe({
            forwarded: true,
            externalStatus: status,
            externalBody,
          });
        }),
      onFailure: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { forwarded: false, error: message },
            { status: 502 }
          )
        );
      },
    });

    return response;
  }),
);
