import { Buffer } from "node:buffer";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api";
import { AppConfigService } from "../config/server.js";
import { StorageService } from "../services/storage/service.js";

export const UploadHandler = HttpApiBuilder.group(Api, "server.upload", (handlers) =>
  handlers.handle("upload.create", ({ payload }) =>
    Effect.gen(function* () {
      const { siteBucket } = yield* AppConfigService;
      const storage = yield* StorageService;

      const key = `sites/${payload.siteId}/${payload.path.replaceAll("\\", "/")}`;
      const body = Buffer.from(payload.contentBase64, "base64");
      const contentType = Option.getOrUndefined(Option.fromNullishOr(payload.contentType));

      return yield* Effect.matchEffect(storage.putObject(siteBucket, key, body, contentType), {
        onSuccess: () => Effect.succeed({ ok: true as const, key }),
        onFailure: (error) =>
          Effect.fail({
            error: error instanceof Error ? error.message : String(error),
          }),
      });
    }),
  ),
);
