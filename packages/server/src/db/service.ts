import type {
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbUpdateInput,
} from "@ism0080/forge-core";
import { Context, Effect } from "effect";

export interface DbListResult {
  readonly documents: ReadonlyArray<DbDocument>;
  readonly nextCursor?: string;
}

export interface DatabaseApi {
  readonly createDocument: (
    siteId: string,
    collection: string,
    input: DbCreateInput,
  ) => Effect.Effect<DbDocument, Error>;
  readonly listDocuments: (
    siteId: string,
    collection: string,
    query?: DbListQuery,
  ) => Effect.Effect<DbListResult, Error>;
  readonly getDocument: (
    siteId: string,
    collection: string,
    id: string,
  ) => Effect.Effect<DbDocument, Error>;
  readonly updateDocument: (
    siteId: string,
    collection: string,
    id: string,
    input: DbUpdateInput,
  ) => Effect.Effect<DbDocument, Error>;
  readonly deleteDocument: (
    siteId: string,
    collection: string,
    id: string,
    input?: DbDeleteInput,
  ) => Effect.Effect<void, Error>;
}

export class DatabaseService extends Context.Service<DatabaseService, DatabaseApi>()(
  "forge/DatabaseService",
) {}
