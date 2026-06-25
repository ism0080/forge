import type { DbDeleteInput, DbDocumentData, DbListQuery } from "@ism0080/forge-core";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api.js";
import { DbEventsService } from "../services/db/events.js";
import { DatabaseService } from "../services/db/service.js";

const mapDbError = (error: unknown): Effect.Effect<never, { error: string }, never> => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("document not found")) {
    return Effect.fail({ error: "document not found" as const });
  }
  if (message.includes("version conflict")) {
    return Effect.fail({ error: "version conflict" as const });
  }
  return Effect.fail({ error: message });
};

const buildListQuery = (query: {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly whereField?: string | undefined;
  readonly whereValue?: string | undefined;
  readonly sortBy?: "createdAt" | "updatedAt" | "id" | undefined;
  readonly sortDir?: "asc" | "desc" | undefined;
}): DbListQuery => ({
  ...(query.limit !== undefined ? { limit: query.limit } : {}),
  ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
  ...(query.whereField !== undefined ? { whereField: query.whereField } : {}),
  ...(query.whereValue !== undefined ? { whereValue: query.whereValue } : {}),
  ...(query.sortBy !== undefined ? { sortBy: query.sortBy } : {}),
  ...(query.sortDir !== undefined ? { sortDir: query.sortDir } : {}),
});

export const DbHandler = HttpApiBuilder.group(Api, "server.db", (handlers) =>
  handlers
    .handle("db.events.get", ({ query, request }) =>
      Effect.gen(function* () {
        const events = yield* DbEventsService;
        const socket = yield* Effect.orDie(request.upgrade);
        const write = yield* socket.writer;

        const unsubscribe = yield* events.subscribe(
          (event) => {
            Effect.runFork(write(JSON.stringify(event)));
          },
          {
            siteId: query.siteId,
            ...(query.collection !== undefined ? { collection: query.collection } : {}),
          },
        );

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

        yield* Effect.orDie(
          socket.runRaw(() => {
            // server only pushes DB events; client messages are ignored
          }),
        );

        return HttpServerResponse.empty();
      }),
    )
    .handle("db.documents.list", ({ params, query }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        return yield* Effect.matchEffect(
          database.listDocuments(query.siteId, params.collection, buildListQuery(query)),
          {
            onSuccess: (result) => Effect.succeed(result),
            onFailure: mapDbError,
          },
        );
      }),
    )
    .handle("db.documents.get", ({ params, query }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        return yield* Effect.matchEffect(
          database.getDocument(query.siteId, params.collection, params.id),
          {
            onSuccess: (document) => Effect.succeed({ document }),
            onFailure: mapDbError,
          },
        );
      }),
    )
    .handle("db.documents.create", ({ params, payload }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        const input = payload.id
          ? { data: payload.data as DbDocumentData, id: payload.id }
          : { data: payload.data as DbDocumentData };
        return yield* Effect.matchEffect(
          database.createDocument(payload.siteId, params.collection, input),
          {
            onSuccess: (document) => Effect.succeed({ document }),
            onFailure: mapDbError,
          },
        );
      }),
    )
    .handle("db.documents.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        const input = {
          data: payload.data as DbDocumentData,
          ...(typeof payload.expectedVersion === "number"
            ? { expectedVersion: payload.expectedVersion }
            : {}),
        };
        return yield* Effect.matchEffect(
          database.updateDocument(payload.siteId, params.collection, params.id, input),
          {
            onSuccess: (document) => Effect.succeed({ document }),
            onFailure: mapDbError,
          },
        );
      }),
    )
    .handle("db.documents.delete", ({ params, query }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        const input: DbDeleteInput =
          typeof query.expectedVersion === "number" && Number.isFinite(query.expectedVersion)
            ? { expectedVersion: query.expectedVersion }
            : {};
        return yield* Effect.matchEffect(
          database.deleteDocument(query.siteId, params.collection, params.id, input),
          {
            onSuccess: () => Effect.succeed({ ok: true as const }),
            onFailure: mapDbError,
          },
        );
      }),
    ),
);
