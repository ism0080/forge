import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { UploadTooLargeError } from "@ism0080/forge-core";
import { AppConfigService } from "../config/server.js";
import { StorageService } from "../services/storage/service.js";
import { toInternalError } from "./errors.js";

export const UploadHandler = HttpApiBuilder.group(Api, "server.upload", (handlers) =>
  handlers.handle(
    "upload.create",
    Effect.fn("Upload.create")(({ payload, query }) =>
      Effect.gen(function* () {
        const { siteBucket, uploadMaxBytes } = yield* AppConfigService;
        const storage = yield* StorageService;

        const actualBytes = payload.byteLength;
        if (actualBytes > uploadMaxBytes) {
          return yield* new UploadTooLargeError({ maxBytes: uploadMaxBytes, actualBytes });
        }

        const key = `sites/${query.siteId}/${query.path.replaceAll("\\", "/")}`;
        const contentType = Option.getOrUndefined(Option.fromNullishOr(query.contentType));

        yield* storage
          .putObject(siteBucket, key, payload, contentType)
          .pipe(Effect.catchTag("StorageError", toInternalError("upload")));

        return { ok: true as const, key };
      }),
    ),
  ),
);
