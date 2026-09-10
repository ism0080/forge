import { Effect } from "effect";
import type { Mutable } from "effect/Types";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { SchemaRowNotFoundError } from "@ism0080/forge-core";
import type { SchemaListQuery } from "@ism0080/forge-core";
import { SchemaService } from "../services/db/schema-service.js";
import type { SchemaRowDeleteInput, SchemaRowUpdateInput } from "../services/db/schema-service.js";
import { toInternalError } from "./errors.js";

export const SchemaHandler = HttpApiBuilder.group(Api, "server.schema", (handlers) =>
  handlers
    .handle("schema.migrations.apply", ({ payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema
          .applyMigrations(payload.siteId, payload.migrations, payload.deploymentId)
          .pipe(
            Effect.catchTag("DbOperationError", toInternalError("schema")),
            Effect.map((result) => ({ ok: true as const, applied: [...result.applied] })),
          );
      }),
    )
    .handle("schema.rows.list", ({ params, query }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const listQuery: Mutable<SchemaListQuery> = {};
        if (query.limit !== undefined) listQuery.limit = query.limit;
        if (query.cursor !== undefined) listQuery.cursor = query.cursor;
        if (query.sortDir !== undefined) listQuery.sortDir = query.sortDir;
        return yield* schema.listRows(query.siteId, params.table, listQuery).pipe(
          Effect.catchTag("DbOperationError", toInternalError("schema")),
          Effect.map(({ rows, nextCursor }) =>
            nextCursor !== undefined ? { rows: [...rows], nextCursor } : { rows: [...rows] },
          ),
        );
      }),
    )
    .handle("schema.rows.get", ({ params, query }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema.getRow(query.siteId, params.table, params.id).pipe(
          Effect.catchTag("DbOperationError", toInternalError("schema")),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(
                  new SchemaRowNotFoundError({
                    siteId: query.siteId,
                    table: params.table,
                    id: params.id,
                  }),
                )
              : Effect.succeed({ row }),
          ),
        );
      }),
    )
    .handle("schema.rows.insert", ({ params, payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema.insertRow(payload.siteId, params.table, payload.data).pipe(
          Effect.catchTag("DbOperationError", toInternalError("schema")),
          Effect.map((row) => ({ row })),
        );
      }),
    )
    .handle("schema.rows.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const input: Mutable<SchemaRowUpdateInput> = {
          data: payload.data,
        };
        if (payload.expectedVersion !== undefined) {
          input.expectedVersion = payload.expectedVersion;
        }
        return yield* schema.updateRow(payload.siteId, params.table, params.id, input).pipe(
          Effect.catchTag("DbOperationError", toInternalError("schema")),
          Effect.map((row) => ({ row })),
        );
      }),
    )
    .handle("schema.rows.delete", ({ params, query }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const input: Mutable<SchemaRowDeleteInput> = {};
        if (query.expectedVersion !== undefined) {
          input.expectedVersion = query.expectedVersion;
        }
        return yield* schema.deleteRow(query.siteId, params.table, params.id, input).pipe(
          Effect.catchTag("DbOperationError", toInternalError("schema")),
          Effect.map(() => ({ ok: true as const })),
        );
      }),
    ),
);
