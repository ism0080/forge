import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const WebhookGatewayGroup = HttpApiGroup.make("server.webhook.gateway")
  .prefix("/api")
  .add(
    HttpApiEndpoint.post("webhook.forward", "/webhook", {
      success: Schema.Struct({
        forwarded: Schema.Literal(true),
        externalStatus: Schema.Number,
        externalBody: Schema.Json,
      }),
      error: Schema.Struct({
        forwarded: Schema.Literal(false),
        error: Schema.String,
      }).pipe(HttpApiSchema.status("BadGateway")),
      payload: Schema.Struct({
        title: Schema.NonEmptyString,
        message: Schema.NonEmptyString,
        payload: Schema.optional(Schema.Unknown),
      }),
    }),
  );
