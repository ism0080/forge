import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export const WhoamiRoute = HttpRouter.add(
  "GET",
  "/api/whoami",
  Effect.gen(function* () {
    const headers = yield* HttpServerRequest.schemaHeaders(
      Schema.Struct({
        "x-forge-user-id": Schema.optional(Schema.String),
        "x-forge-user-email": Schema.optional(Schema.String),
        "x-forge-user-name": Schema.optional(Schema.String),
        "x-forge-user-team": Schema.optional(Schema.String),
      }),
    );

    return HttpServerResponse.jsonUnsafe({
      id: Option.getOrElse(Option.fromNullishOr(headers["x-forge-user-id"]), () => "dev-user"),
      email: Option.getOrElse(
        Option.fromNullishOr(headers["x-forge-user-email"]),
        () => "dev@forge.local",
      ),
      name: Option.getOrElse(Option.fromNullishOr(headers["x-forge-user-name"]), () => "Forge Dev"),
      team: Option.getOrElse(Option.fromNullishOr(headers["x-forge-user-team"]), () => "Platform"),
    });
  }),
);
