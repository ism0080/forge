import { Config, Context, Effect, Layer } from "effect";

export class WebhookConfigService extends Context.Service<
  WebhookConfigService,
  {
    readonly externalApiUrl: string;
    readonly externalApiKey: string;
  }
>()("forge/WebhookConfigService") {}

export const WebhookConfigLayer = Layer.effect(
  WebhookConfigService,
  Effect.gen(function* () {
    const externalApiUrl = yield* Config.string("EXTERNAL_API_URL");
    const externalApiKey = yield* Config.string("EXTERNAL_API_KEY");
    return {
      externalApiUrl,
      externalApiKey,
    };
  }),
);
