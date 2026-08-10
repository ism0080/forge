import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { AppConfigService, AppConfigLayer } from "../src/config/server.js";

describe("AppConfigService", () => {
  it.effect("reads SITE_BUCKET from config with default", () =>
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      expect(config.siteBucket).toBe("forge-sites");
    }).pipe(
      Effect.provide(
        AppConfigLayer.pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ SITE_BUCKET: "forge-sites" }),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("honors a provided SITE_BUCKET", () =>
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      expect(config.siteBucket).toBe("my-bucket");
    }).pipe(
      Effect.provide(
        AppConfigLayer.pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ SITE_BUCKET: "my-bucket" }),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("testLayer provides fixed values", () =>
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      expect(config.siteBucket).toBe("forge-sites-test");
    }).pipe(Effect.provide(AppConfigService.testLayer)),
  );
});
