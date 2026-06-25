import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "./api.js";
import { handlers } from "./handlers.js";
import { Layer } from "effect";

export const routes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(handlers),
);
