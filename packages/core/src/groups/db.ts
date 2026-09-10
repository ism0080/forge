import {
  CollectionId,
  DbCreateRequestSchema,
  DbCreateResponseSchema,
  DbDeleteRequestSchema,
  DbDeleteResponseSchema,
  DbGetResponseSchema,
  DbListQuerySchema,
  DbListResponseSchema,
  DbUpdateRequestSchema,
  DbUpdateResponseSchema,
  DocumentId,
  SiteId,
} from "../index.js";
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
  error: Schema.Literal("internal error"),
}).pipe(HttpApiSchema.status("InternalServerError"));

const DbErrors = [DbNotFoundError, DbConflictError, DbInternalError, DbBadRequestError];

export const DbGroup = HttpApiGroup.make("server.db").add(
  HttpApiEndpoint.get("db.events.get", "/api/db/events", {
    success: HttpApiSchema.NoContent,
    query: Schema.Struct({
      siteId: Schema.String,
      collection: Schema.optional(Schema.String),
      table: Schema.optional(Schema.String),
    }),
  }),
  HttpApiEndpoint.get("db.documents.list", "/api/db/:collection", {
    success: DbListResponseSchema,
    error: DbErrors,
    params: Schema.Struct({ collection: CollectionId }),
    query: DbListQuerySchema,
  }),
  HttpApiEndpoint.get("db.documents.get", "/api/db/:collection/:id", {
    success: DbGetResponseSchema,
    error: DbErrors,
    params: Schema.Struct({ collection: CollectionId, id: DocumentId }),
    query: Schema.Struct({ siteId: SiteId }),
  }),
  HttpApiEndpoint.post("db.documents.create", "/api/db/:collection", {
    success: DbCreateResponseSchema.pipe(HttpApiSchema.status("Created")),
    error: DbErrors,
    params: Schema.Struct({ collection: CollectionId }),
    payload: DbCreateRequestSchema,
  }),
  HttpApiEndpoint.put("db.documents.update", "/api/db/:collection/:id", {
    success: DbUpdateResponseSchema,
    error: DbErrors,
    params: Schema.Struct({ collection: CollectionId, id: DocumentId }),
    payload: DbUpdateRequestSchema,
  }),
  HttpApiEndpoint.delete("db.documents.delete", "/api/db/:collection/:id", {
    success: DbDeleteResponseSchema,
    error: DbErrors,
    params: Schema.Struct({ collection: CollectionId, id: DocumentId }),
    query: DbDeleteRequestSchema,
  }),
);
