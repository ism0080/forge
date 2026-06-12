import { Buffer } from "node:buffer";
import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerConfigService } from "../config/server.js";
import { StorageService } from "../storage/service.js";

const UploadPayload = Schema.Struct({
  siteId: Schema.String,
  path: Schema.String,
  contentBase64: Schema.String,
  contentType: Schema.optional(Schema.String),
});

export const UploadRoute = HttpRouter.add(
  "POST",
  "/api/upload",
  Effect.gen(function* () {
    const payload = yield* HttpServerRequest.schemaBodyJson(UploadPayload);
    const { siteBucket } = yield* ServerConfigService;
    const storage = yield* StorageService;

    const key = `sites/${payload.siteId}/${payload.path.replaceAll("\\", "/")}`;
    const body = Buffer.from(payload.contentBase64, "base64");
    const contentType = Option.getOrUndefined(Option.fromNullishOr(payload.contentType));

    yield* storage.putObject(siteBucket, key, body, contentType);

    return HttpServerResponse.jsonUnsafe({ ok: true, key }, { status: 201 });
  }),
);
