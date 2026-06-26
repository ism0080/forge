import {
  DbCreateRequestSchema,
  DbCreateResponseSchema,
  DbDeleteRequestSchema,
  DbDeleteResponseSchema,
  DbGetResponseSchema,
  DbListQuerySchema,
  DbListResponseSchema,
  DbUpdateRequestSchema,
  DbUpdateResponseSchema,
} from "@ism0080/forge-core";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const DbNotFoundError = Schema.Struct({
  error: Schema.Literal("document not found"),
}).pipe(HttpApiSchema.status("NotFound"));

const DbConflictError = Schema.Struct({
  error: Schema.Literal("version conflict"),
}).pipe(HttpApiSchema.status("Conflict"));

const DbBadRequestError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("BadRequest"));

const DbInternalError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status("InternalServerError"));

const DbError = Schema.Union([
  DbNotFoundError,
  DbConflictError,
  DbBadRequestError,
  DbInternalError,
]);

export const DbGroup = HttpApiGroup.make("server.db").add(
  HttpApiEndpoint.get("db.events.get", "/api/db/events", {
    success: HttpApiSchema.NoContent,
    query: Schema.Struct({
      siteId: Schema.String,
      collection: Schema.optional(Schema.String),
    }),
  }),
  HttpApiEndpoint.get("db.documents.list", "/api/db/:collection", {
    success: DbListResponseSchema,
    error: DbError,
    params: Schema.Struct({ collection: Schema.String }),
    query: DbListQuerySchema,
  }),
  HttpApiEndpoint.get("db.documents.get", "/api/db/:collection/:id", {
    success: DbGetResponseSchema,
    error: DbError,
    params: Schema.Struct({ collection: Schema.String, id: Schema.String }),
    query: Schema.Struct({ siteId: Schema.String }),
  }),
  HttpApiEndpoint.post("db.documents.create", "/api/db/:collection", {
    success: DbCreateResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: DbError,
    params: Schema.Struct({ collection: Schema.String }),
    payload: DbCreateRequestSchema,
  }),
  HttpApiEndpoint.put("db.documents.update", "/api/db/:collection/:id", {
    success: DbUpdateResponseSchema,
    error: DbError,
    params: Schema.Struct({ collection: Schema.String, id: Schema.String }),
    payload: DbUpdateRequestSchema,
  }),
  HttpApiEndpoint.delete("db.documents.delete", "/api/db/:collection/:id", {
    success: DbDeleteResponseSchema,
    error: DbError,
    params: Schema.Struct({ collection: Schema.String, id: Schema.String }),
    query: DbDeleteRequestSchema,
  }),
);
