import type {
  CollectionId,
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbUpdateInput,
  DocumentId,
  SiteId,
} from "@ism0080/forge-core";
import { DocumentNotFoundError, DbOperationError, VersionConflictError } from "@ism0080/forge-core";
import { Context, Effect } from "effect";

export interface DbListResult {
  readonly documents: ReadonlyArray<DbDocument>;
  readonly nextCursor?: string;
}

export type DbError = DocumentNotFoundError | VersionConflictError | DbOperationError;

export interface DatabaseApi {
  readonly createDocument: (
    siteId: SiteId,
    collection: CollectionId,
    input: DbCreateInput,
  ) => Effect.Effect<DbDocument, DbOperationError>;
  readonly listDocuments: (
    siteId: SiteId,
    collection: CollectionId,
    query?: DbListQuery,
  ) => Effect.Effect<DbListResult, DbOperationError>;
  readonly getDocument: (
    siteId: SiteId,
    collection: CollectionId,
    id: DocumentId,
  ) => Effect.Effect<DbDocument, DocumentNotFoundError | DbOperationError>;
  readonly updateDocument: (
    siteId: SiteId,
    collection: CollectionId,
    id: DocumentId,
    input: DbUpdateInput,
  ) => Effect.Effect<DbDocument, DbError>;
  readonly deleteDocument: (
    siteId: SiteId,
    collection: CollectionId,
    id: DocumentId,
    input?: DbDeleteInput,
  ) => Effect.Effect<void, DbError>;
}

export class DatabaseService extends Context.Service<DatabaseService, DatabaseApi>()(
  "forge/DatabaseService",
) {}
