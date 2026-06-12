import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

export const HealthRoute = HttpRouter.add(
  "GET",
  "/health",
  HttpServerResponse.jsonUnsafe({ ok: true }),
);
