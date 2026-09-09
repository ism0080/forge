import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const SiteInternalError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("InternalServerError"));

const SiteNotFoundError = Schema.Struct({
  error: Schema.Literal("not found"),
}).pipe(HttpApiSchema.status("NotFound"));

const SiteDeletedResponse = Schema.Struct({
  ok: Schema.Literal(true),
});

const SiteId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^(?!\.{1,2}$)[^/\\]+$/, {
      message: "invalid site id",
    }),
  ),
);

export const SitesGroup = HttpApiGroup.make("server.sites").add(
  HttpApiEndpoint.get("sites.list", "/directory", {
    success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html" })),
    error: SiteInternalError,
  }),
  HttpApiEndpoint.get("sites.get", "/sites/*", {
    success: Schema.Uint8Array,
    error: SiteNotFoundError,
  }),
  HttpApiEndpoint.delete("sites.delete", "/directory/:siteId", {
    success: SiteDeletedResponse,
    error: Schema.Union([SiteNotFoundError, SiteInternalError]),
    params: Schema.Struct({ siteId: SiteId }),
  }),
);
