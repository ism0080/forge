import { Config, Context, Effect, Layer, Schema } from "effect";

const PortSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
);

export const serverConfig = Config.all({
  port: Config.schema(PortSchema, "PORT").pipe(Config.withDefault(8787)),
  host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
});

export const DEFAULT_UPLOAD_MAX_BYTES = 10_000_000;

export class AppConfigService extends Context.Service<
  AppConfigService,
  {
    readonly siteBucket: string;
    readonly uploadMaxBytes: number;
  }
>()("forge/AppConfigService") {
  static readonly layer = Layer.effect(
    AppConfigService,
    Effect.gen(function* () {
      const siteBucket = yield* Config.string("SITE_BUCKET").pipe(
        Config.withDefault("forge-sites"),
      );
      const uploadMaxBytes = yield* Config.number("UPLOAD_MAX_BYTES").pipe(
        Config.withDefault(DEFAULT_UPLOAD_MAX_BYTES),
      );

      return {
        siteBucket,
        uploadMaxBytes,
      };
    }),
  );

  static readonly testLayer = Layer.succeed(AppConfigService, {
    siteBucket: "forge-sites-test",
    uploadMaxBytes: DEFAULT_UPLOAD_MAX_BYTES,
  });
}

export const AppConfigLayer = AppConfigService.layer;
