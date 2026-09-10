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
  DocumentNotFoundError,
  InternalError,
  SiteId,
  VersionConflictError,
} from "../index.js";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

const DbErrors = [DocumentNotFoundError, VersionConflictError, InternalError];

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
