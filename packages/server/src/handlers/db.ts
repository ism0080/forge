import type { DbDeleteInput, DbDocumentData, DbListQuery } from "@ism0080/forge-core";
import { DbChangeEventSchema, SchemaRowChangeEventSchema } from "@ism0080/forge-core";
import { Effect, Schema, Stream } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { DbEventsService } from "../services/db/events.js";
import { DatabaseService } from "../services/db/service.js";
import { toInternalError } from "./errors.js";

const ForgeDbEventFromJson = Schema.fromJsonString(
  Schema.Union([DbChangeEventSchema, SchemaRowChangeEventSchema]),
);

const buildListQuery = (query: {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly whereField?: string | undefined;
  readonly whereValue?: string | undefined;
  readonly search?: string | undefined;
  readonly sortBy?: "createdAt" | "updatedAt" | "id" | undefined;
  readonly sortDir?: "asc" | "desc" | undefined;
}): DbListQuery => ({
  ...(query.limit !== undefined ? { limit: query.limit } : {}),
  ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
  ...(query.whereField !== undefined ? { whereField: query.whereField } : {}),
  ...(query.whereValue !== undefined ? { whereValue: query.whereValue } : {}),
  ...(query.search !== undefined ? { search: query.search } : {}),
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
        const encoder = new TextEncoder();

        const eventStream = events
          .stream({
            siteId: query.siteId,
            ...(query.collection !== undefined ? { collection: query.collection } : {}),
            ...(query.table !== undefined ? { table: query.table } : {}),
          })
          .pipe(
            Stream.map((event) => encoder.encode(Schema.encodeSync(ForgeDbEventFromJson)(event))),
            Stream.mapEffect((chunk) =>
              write(chunk).pipe(
                Effect.tapError((cause) => Effect.logError("socket write failed", cause)),
                Effect.orDie,
              ),
            ),
            Stream.runDrain,
          );

        yield* Effect.forkScoped(eventStream).pipe(Effect.orDie);

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
        return yield* database
          .listDocuments(query.siteId, params.collection, buildListQuery(query))
          .pipe(
            Effect.annotateLogs({ siteId: query.siteId, collection: params.collection }),
            Effect.catchTag("DbOperationError", toInternalError("database")),
          );
      }),
    )
    .handle("db.documents.get", ({ params, query }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        return yield* database.getDocument(query.siteId, params.collection, params.id).pipe(
          Effect.catchTag("DbOperationError", toInternalError("database")),
          Effect.map((document) => ({ document })),
        );
      }),
    )
    .handle("db.documents.create", ({ params, payload }) =>
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        const input = payload.id
          ? { data: payload.data as DbDocumentData, id: payload.id }
          : { data: payload.data as DbDocumentData };
        return yield* database.createDocument(payload.siteId, params.collection, input).pipe(
          Effect.catchTag("DbOperationError", toInternalError("database")),
          Effect.map((document) => ({ document })),
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
        return yield* database
          .updateDocument(payload.siteId, params.collection, params.id, input)
          .pipe(
            Effect.catchTag("DbOperationError", toInternalError("database")),
            Effect.map((document) => ({ document })),
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
        return yield* database
          .deleteDocument(query.siteId, params.collection, params.id, input)
          .pipe(
            Effect.catchTag("DbOperationError", toInternalError("database")),
            Effect.map(() => ({ ok: true as const })),
          );
      }),
    ),
);
