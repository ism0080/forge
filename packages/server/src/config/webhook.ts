import { Config, Context, Effect, Layer, Redacted, Option } from "effect";

export class WebhookConfigService extends Context.Service<
  WebhookConfigService,
  {
    readonly externalApiUrl: Option.Option<string>;
    readonly externalApiKey: Option.Option<Redacted.Redacted<string>>;
  }
>()("forge/WebhookConfigService") {}

export const WebhookConfigLayer = Layer.effect(
  WebhookConfigService,
  Effect.gen(function* () {
    const externalApiUrl = yield* Config.option(Config.string("EXTERNAL_API_URL"));
    const externalApiKey = yield* Config.option(Config.redacted("EXTERNAL_API_KEY"));
    return {
      externalApiUrl,
      externalApiKey,
    };
  }),
);
