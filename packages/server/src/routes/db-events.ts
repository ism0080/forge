import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { DbEventsService } from "../db/events.js";

export const DbEventsRoute = HttpRouter.add(
  "GET",
  "/api/db/events",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const events = yield* DbEventsService;

    const url = new URL(request.url, "http://forge.local");
    const siteId = url.searchParams.get("siteId");
    const collection = url.searchParams.get("collection") ?? undefined;

    if (!siteId) {
      return HttpServerResponse.jsonUnsafe({ error: "siteId is required" }, { status: 400 });
    }

    const socket = yield* Effect.orDie(request.upgrade);
    const write = yield* socket.writer;

    const unsubscribe = yield* events.subscribe(
      (event) => {
        Effect.runFork(write(JSON.stringify(event)));
      },
      { siteId, ...(collection ? { collection } : {}) },
    );

    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    yield* socket.runRaw(() => {
      // server only pushes DB events; client messages are ignored
    });

    return HttpServerResponse.empty();
  }),
);
