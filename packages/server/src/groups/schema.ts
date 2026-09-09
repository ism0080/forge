import { SchemaListQuerySchema, SchemaListResponseSchema, SiteId } from "@ism0080/forge-core";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const RowSchema = Schema.Record(Schema.String, Schema.Unknown);

const RowResponseSchema = Schema.Struct({
  row: RowSchema,
});

const MigrationSchema = Schema.Struct({
  id: Schema.String,
  sql: Schema.String,
});

const ApplyMigrationsResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  applied: Schema.Array(Schema.String),
});

const RowNotFoundError = Schema.Struct({
  error: Schema.Literal("row not found"),
}).pipe(HttpApiSchema.status("NotFound"));

const RowConflictError = Schema.Struct({
  error: Schema.Literal("version conflict"),
}).pipe(HttpApiSchema.status("Conflict"));

const BadRequestError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("BadRequest"));

const InternalError = Schema.Struct({
  error: Schema.Literal("internal error"),
}).pipe(HttpApiSchema.status("InternalServerError"));

const SchemaError = Schema.Union([
  RowNotFoundError,
  RowConflictError,
  InternalError,
  BadRequestError,
]);

export const SchemaGroup = HttpApiGroup.make("server.schema").add(
  HttpApiEndpoint.post("schema.migrations.apply", "/api/db/migrations", {
    success: ApplyMigrationsResponseSchema,
    error: SchemaError,
    payload: Schema.Struct({
      siteId: SiteId,
      deploymentId: Schema.String,
      migrations: Schema.Array(MigrationSchema),
    }),
  }),
  HttpApiEndpoint.get("schema.rows.list", "/api/tables/:table", {
    success: SchemaListResponseSchema,
    error: SchemaError,
    params: Schema.Struct({ table: Schema.String }),
    query: SchemaListQuerySchema,
  }),
  HttpApiEndpoint.get("schema.rows.get", "/api/tables/:table/:id", {
    success: RowResponseSchema,
    error: SchemaError,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    query: Schema.Struct({ siteId: SiteId }),
  }),
  HttpApiEndpoint.post("schema.rows.insert", "/api/tables/:table", {
    success: RowResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: SchemaError,
    params: Schema.Struct({ table: Schema.String }),
    payload: Schema.Struct({
      siteId: SiteId,
      data: RowSchema,
    }),
  }),
  HttpApiEndpoint.put("schema.rows.update", "/api/tables/:table/:id", {
    success: RowResponseSchema,
    error: SchemaError,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    payload: Schema.Struct({
      siteId: SiteId,
      data: RowSchema,
      expectedVersion: Schema.optional(Schema.Number),
    }),
  }),
  HttpApiEndpoint.delete("schema.rows.delete", "/api/tables/:table/:id", {
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: SchemaError,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    query: Schema.Struct({
      siteId: SiteId,
      expectedVersion: Schema.optional(Schema.Number),
    }),
  }),
);
