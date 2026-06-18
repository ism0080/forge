import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api";
import { plugins } from "../plugins.js";

export const PluginsHandler = HttpApiBuilder.group(
  Api,
  "server.plugins",
  (handlers) =>
    handlers.handle("plugins.list", () =>
      Effect.succeed({ plugins }),
    ),
);
