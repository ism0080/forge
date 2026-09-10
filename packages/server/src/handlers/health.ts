import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { Effect } from "effect";

export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  handlers.handle("health.get", () => Effect.succeed({ healthy: true as const })),
);
