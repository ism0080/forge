import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "./api";
import { handlers } from "./handlers";
import { Layer } from "effect";

export const routes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(handlers),
);
