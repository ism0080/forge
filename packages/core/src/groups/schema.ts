import {
  InternalError,
  SchemaInvalidInputError,
  SchemaListQuerySchema,
  SchemaListResponseSchema,
  SchemaMigrationError,
  SchemaRowConflictError,
  SchemaRowNotFoundError,
  SiteId,
} from "../index.js";
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

const SchemaErrors = [
  SchemaRowNotFoundError,
  SchemaRowConflictError,
  SchemaMigrationError,
  SchemaInvalidInputError,
  InternalError,
];

export const SchemaGroup = HttpApiGroup.make("server.schema").add(
  HttpApiEndpoint.post("schema.migrations.apply", "/api/db/migrations", {
    success: ApplyMigrationsResponseSchema,
    error: SchemaErrors,
    payload: Schema.Struct({
      siteId: SiteId,
      deploymentId: Schema.String,
      migrations: Schema.Array(MigrationSchema),
    }),
  }),
  HttpApiEndpoint.get("schema.rows.list", "/api/tables/:table", {
    success: SchemaListResponseSchema,
    error: SchemaErrors,
    params: Schema.Struct({ table: Schema.String }),
    query: SchemaListQuerySchema,
  }),
  HttpApiEndpoint.get("schema.rows.get", "/api/tables/:table/:id", {
    success: RowResponseSchema,
    error: SchemaErrors,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    query: Schema.Struct({ siteId: SiteId }),
  }),
  HttpApiEndpoint.post("schema.rows.insert", "/api/tables/:table", {
    success: RowResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: SchemaErrors,
    params: Schema.Struct({ table: Schema.String }),
    payload: Schema.Struct({
      siteId: SiteId,
      data: RowSchema,
    }),
  }),
  HttpApiEndpoint.put("schema.rows.update", "/api/tables/:table/:id", {
    success: RowResponseSchema,
    error: SchemaErrors,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    payload: Schema.Struct({
      siteId: SiteId,
      data: RowSchema,
      expectedVersion: Schema.optional(Schema.Number),
    }),
  }),
  HttpApiEndpoint.delete("schema.rows.delete", "/api/tables/:table/:id", {
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: SchemaErrors,
    params: Schema.Struct({ table: Schema.String, id: Schema.String }),
    query: Schema.Struct({
      siteId: SiteId,
      expectedVersion: Schema.optional(Schema.Number),
    }),
  }),
);
