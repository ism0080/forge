import { Config, Context, Effect, Layer } from "effect";

export class ServerConfigService extends Context.Service<
  ServerConfigService,
  {
    readonly port: number;
    readonly siteBucket: string;
  }
>()("forge/ServerConfigService") {}

export const ServerConfigLayer = Layer.effect(
  ServerConfigService,
  Effect.gen(function* () {
    const port = yield* Config.number("PORT").pipe(Config.withDefault(8787));
    const siteBucket = yield* Config.string("SITE_BUCKET").pipe(Config.withDefault("forge-sites"));
    return {
      port,
      siteBucket,
    };
  }),
);
