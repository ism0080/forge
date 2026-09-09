import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api.js";
import {
  SchemaInvalidInputError,
  SchemaMigrationError,
  SchemaRowConflictError,
  SchemaRowNotFoundError,
  SchemaService,
} from "../services/db/schema-service.js";

const isExpected = (error: unknown): boolean =>
  error instanceof SchemaRowNotFoundError ||
  error instanceof SchemaRowConflictError ||
  error instanceof SchemaMigrationError ||
  error instanceof SchemaInvalidInputError;

const mapSchemaError = (error: unknown): { error: string } => {
  if (error instanceof SchemaRowNotFoundError) {
    return { error: "row not found" };
  }
  if (error instanceof SchemaRowConflictError) {
    return { error: "version conflict" };
  }
  if (error instanceof SchemaMigrationError || error instanceof SchemaInvalidInputError) {
    return { error: error.message };
  }
  return { error: "internal error" };
};

const tapUnexpected = (error: unknown): Effect.Effect<void> =>
  isExpected(error) ? Effect.void : Effect.logError("Unexpected schema error", error);

export const SchemaHandler = HttpApiBuilder.group(Api, "server.schema", (handlers) =>
  handlers
    .handle("schema.migrations.apply", ({ payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema
          .applyMigrations(payload.siteId, payload.migrations, payload.deploymentId)
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapSchemaError),
            Effect.map((result) => ({ ok: true as const, applied: [...result.applied] })),
          );
      }),
    )
    .handle("schema.rows.get", ({ params, query }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema.getRow(query.siteId, params.table, params.id).pipe(
          Effect.tapError(tapUnexpected),
          Effect.mapError(mapSchemaError),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail({ error: "row not found" as const })
              : Effect.succeed({ row }),
          ),
        );
      }),
    )
    .handle("schema.rows.insert", ({ params, payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema.insertRow(payload.siteId, params.table, payload.data).pipe(
          Effect.tapError(tapUnexpected),
          Effect.mapError(mapSchemaError),
          Effect.map((row) => ({ row })),
        );
      }),
    )
    .handle("schema.rows.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        return yield* schema
          .updateRow(payload.siteId, params.table, params.id, {
            data: payload.data,
            ...(typeof payload.expectedVersion === "number"
              ? { expectedVersion: payload.expectedVersion }
              : {}),
          })
          .pipe(
            Effect.tapError(tapUnexpected),
            Effect.mapError(mapSchemaError),
            Effect.map((row) => ({ row })),
          );
      }),
    )
    .handle("schema.rows.delete", ({ params, query }) =>
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const input: { expectedVersion?: number } = {};
        if (typeof query.expectedVersion === "number") {
          input.expectedVersion = query.expectedVersion;
        }
        return yield* schema.deleteRow(query.siteId, params.table, params.id, input).pipe(
          Effect.tapError(tapUnexpected),
          Effect.mapError(mapSchemaError),
          Effect.map(() => ({ ok: true as const })),
        );
      }),
    ),
);
