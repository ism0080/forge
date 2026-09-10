import {
  InternalError,
  UploadQuerySchema,
  UploadResponseSchema,
  UploadTooLargeError,
} from "../index.js";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const UploadGroup = HttpApiGroup.make("server.upload").add(
  HttpApiEndpoint.post("upload.create", "/api/upload", {
    success: UploadResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: [InternalError, UploadTooLargeError],
    query: UploadQuerySchema,
    payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  }),
);
