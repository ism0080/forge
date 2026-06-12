import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { plugins } from "../plugins.js";

export const PluginsRoute = HttpRouter.add(
  "GET",
  "/api/plugins",
  HttpServerResponse.jsonUnsafe({ plugins }),
);
