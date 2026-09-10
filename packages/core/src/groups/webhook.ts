import {
  WebhookSendErrorResponseSchema,
  WebhookSendInputSchema,
  WebhookSendSuccessResponseSchema,
} from "../index.js";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const WebhookGatewayGroup = HttpApiGroup.make("server.webhook.gateway").add(
  HttpApiEndpoint.post("webhook.forward", "/api/webhook", {
    success: WebhookSendSuccessResponseSchema,
    error: WebhookSendErrorResponseSchema.pipe(HttpApiSchema.status("BadGateway")),
    payload: WebhookSendInputSchema,
  }),
);
