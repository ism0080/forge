import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

export const NotFoundRoute = HttpRouter.add(
  "*",
  "*",
  HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 }),
);
