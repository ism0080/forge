import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const WhoamiHeadersSchema = Schema.Struct({
  "x-forge-user-id": Schema.optional(Schema.String),
  "x-forge-user-email": Schema.optional(Schema.String),
  "x-forge-user-name": Schema.optional(Schema.String),
  "x-forge-user-team": Schema.optional(Schema.String),
});

const WhoamiResponseSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  team: Schema.String,
});

export const IdentityGroup = HttpApiGroup.make("server.identity").add(
  HttpApiEndpoint.get("identity.whoami", "/api/whoami", {
    success: WhoamiResponseSchema,
    headers: WhoamiHeadersSchema,
  }),
);
