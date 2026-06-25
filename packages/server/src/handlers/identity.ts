import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api.js";

export const IdentityHandler = HttpApiBuilder.group(
  Api,
  "server.identity",
  (handlers) =>
    handlers.handle("identity.whoami", ({ headers }) =>
      Effect.succeed({
        id: headers["x-forge-user-id"] ?? "dev-user",
        email: headers["x-forge-user-email"] ?? "dev@forge.local",
        name: headers["x-forge-user-name"] ?? "Forge Dev",
        team: headers["x-forge-user-team"] ?? "Platform",
      }),
    ),
);
