import {
  WebhookSendErrorResponseSchema,
  WebhookSendInputSchema,
  WebhookSendSuccessResponseSchema,
} from "@ism0080/forge-core";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const WebhookGatewayGroup = HttpApiGroup.make("server.webhook.gateway")
  .prefix("/api")
  .add(
    HttpApiEndpoint.post("webhook.forward", "/webhook", {
      success: WebhookSendSuccessResponseSchema,
      error: WebhookSendErrorResponseSchema.pipe(HttpApiSchema.status("BadGateway")),
      payload: WebhookSendInputSchema,
    }),
  );
