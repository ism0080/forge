import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const UploadInternalError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("InternalServerError"));

const UploadPayloadSchema = Schema.Struct({
  siteId: Schema.String,
  path: Schema.String,
  contentBase64: Schema.String,
  contentType: Schema.optional(Schema.String),
});

const UploadResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  key: Schema.String,
}).pipe(HttpApiSchema.status("Created"));

export const UploadGroup = HttpApiGroup.make("server.upload").add(
  HttpApiEndpoint.post("upload.create", "/api/upload", {
    success: UploadResponseSchema,
    error: UploadInternalError,
    payload: UploadPayloadSchema,
  }),
);
