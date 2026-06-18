import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

const SiteInternalError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("InternalServerError"));

const SiteNotFoundError = Schema.Struct({
  error: Schema.Literal("not found"),
}).pipe(HttpApiSchema.status("NotFound"));

export const SitesGroup = HttpApiGroup.make("server.sites").add(
  HttpApiEndpoint.get("sites.list", "/directory", {
    success: Schema.String.pipe(
      HttpApiSchema.asText({ contentType: "text/html" }),
    ),
    error: SiteInternalError,
  }),
  HttpApiEndpoint.get("sites.get", "/sites/*", {
    success: Schema.Uint8Array,
    error: SiteNotFoundError,
  }),
);
