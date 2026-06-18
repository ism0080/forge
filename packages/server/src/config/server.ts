import { Config, Context, Effect, Layer } from "effect";

export const serverConfig = Config.all({
  port: Config.number("PORT").pipe(Config.withDefault(8787)),
  host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
});

export class AppConfigService extends Context.Service<
  AppConfigService,
  {
    readonly siteBucket: string;
  }
>()("forge/AppConfigService") {}

export const AppConfigLayer = Layer.effect(
  AppConfigService,
  Effect.gen(function* () {
    const siteBucket = yield* Config.string("SITE_BUCKET").pipe(Config.withDefault("forge-sites"));

    return {
      siteBucket,
    };
  }),
);
