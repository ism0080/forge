import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { InternalError, SiteNotFoundError } from "../index.js";

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
    error: InternalError,
  }),
  HttpApiEndpoint.get("sites.get", "/sites/*", {
    success: Schema.Uint8Array,
    error: [SiteNotFoundError, InternalError],
  }),
  HttpApiEndpoint.delete("sites.delete", "/directory/:siteId", {
    success: SiteDeletedResponse,
    error: [SiteNotFoundError, InternalError],
    params: Schema.Struct({ siteId: SiteId }),
  }),
);
