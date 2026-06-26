import { UploadRequestSchema, UploadResponseSchema } from "@ism0080/forge-core";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const UploadInternalError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("InternalServerError"));

export const UploadGroup = HttpApiGroup.make("server.upload").add(
  HttpApiEndpoint.post("upload.create", "/api/upload", {
    success: UploadResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: UploadInternalError,
    payload: UploadRequestSchema,
  }),
);
