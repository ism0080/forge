import { Config, Context, Data, Effect, Layer, Match, Predicate, Schema, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  CollectionId,
  DbDocumentDataSchema,
  DbDocumentSchema,
  DbOperationError,
  DocumentId,
  DocumentNotFoundError,
  SiteId,
  VersionConflictError,
} from "@ism0080/forge-core";
import type {
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbSortBy,
  DbSortDir,
  DbUpdateInput,
} from "@ism0080/forge-core";
import { type DatabaseApi, DatabaseService } from "./service.js";
import { DbEventsService } from "./events.js";
import {
  DbClockLayer,
  DbClockService,
  parseLimit,
  parseSortBy,
  parseSortDir,
  randomId,
  siteStorageKey,
} from "./shared.js";
import { prepareStatement, runInTransaction, SiteConnectionsService } from "./sqlite-connection.js";
import type { SiteDb } from "./sqlite-connection.js";

export interface SqliteDatabaseConfig {
  readonly storageRoot: string;
}

class SqliteDatabaseConfigService extends Context.Service<
  SqliteDatabaseConfigService,
  SqliteDatabaseConfig
>()("forge/SqliteDatabaseConfigService") {}

const SqliteDatabaseConfigLayer = Layer.effect(
  SqliteDatabaseConfigService,
  Effect.gen(function* () {
    const storageRoot = yield* Config.string("DATABASE_ROOT").pipe(Config.withDefault("./data/db"));
    return { storageRoot };
  }),
);

const DocumentRowSchema = Schema.Struct({
  collection: Schema.String,
  id: Schema.String,
  data: Schema.String,
  version: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
});

type DocumentRow = Schema.Schema.Type<typeof DocumentRowSchema>;

const DocumentRowsSchema = Schema.Array(DocumentRowSchema);

type DocumentWriteOutcome = Data.TaggedEnum<{
  missing: {};
  conflict: { readonly actualVersion: number };
  written: { readonly createdAt: string; readonly version: number };
}>;

const {
  missing: documentMissing,
  conflict: documentConflict,
  written: documentWritten,
  $match: matchDocumentWriteOutcome,
} = Data.taggedEnum<DocumentWriteOutcome>();

type DocumentDeleteOutcome = Data.TaggedEnum<{
  missing: {};
  conflict: { readonly actualVersion: number };
  deleted: {};
}>;

const {
  missing: documentDeleteMissing,
  conflict: documentDeleteConflict,
  deleted: documentDeleted,
  $match: matchDocumentDeleteOutcome,
} = Data.taggedEnum<DocumentDeleteOutcome>();

interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

const decodeCursor = (cursor: string): Cursor | undefined => {
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) {
    return undefined;
  }
  return { createdAt, id };
};

const cursorForDocument = (row: DocumentRow): string => `${row.created_at}|${row.id}`;

const CREATE_DOCUMENTS_SQL = `
  CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  ) STRICT
`;

const CREATE_CREATED_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (collection, created_at, id)";

const CREATE_UPDATED_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents (collection, updated_at, id)";

const CREATE_META_SQL = `CREATE TABLE IF NOT EXISTS _forge_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT`;

const CREATE_DOCUMENTS_FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    collection UNINDEXED,
    id UNINDEXED,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  )
`;

const CREATE_DOCUMENTS_FTS_TRIGGERS_SQL = `
  CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts (collection, id, body) VALUES (new.collection, new.id, new.data);
  END;
  CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
    DELETE FROM documents_fts WHERE collection = old.collection AND id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE ON documents BEGIN
    DELETE FROM documents_fts WHERE collection = old.collection AND id = old.id;
    INSERT INTO documents_fts (collection, id, body) VALUES (new.collection, new.id, new.data);
  END;
`;

const FTS_BACKFILLED_KEY = "fts_backfilled";

const backfillDocumentsFts = (site: SiteDb): void => {
  const marker = site.db
    .prepare("SELECT value FROM _forge_meta WHERE key = ?")
    .get(FTS_BACKFILLED_KEY);
  if (marker !== undefined) {
    return;
  }
  site.db.exec(`
    INSERT INTO documents_fts (collection, id, body)
    SELECT collection, id, data FROM documents
    WHERE NOT EXISTS (
      SELECT 1 FROM documents_fts f
      WHERE f.collection = documents.collection AND f.id = documents.id
    )
  `);
  site.db
    .prepare("INSERT OR REPLACE INTO _forge_meta (key, value) VALUES (?, ?)")
    .run(FTS_BACKFILLED_KEY, "1");
};

const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const DbDocumentDataFromJson = Schema.fromJsonString(DbDocumentDataSchema);

const sortColumn = Match.type<DbSortBy>().pipe(
  Match.when("createdAt", () => "created_at"),
  Match.when("updatedAt", () => "updated_at"),
  Match.when("id", () => "id"),
  Match.exhaustive,
);

interface SqlClause {
  readonly sql: string;
  readonly params: Array<string | number>;
}

const buildFilterClause = (whereField: string, whereValue: string): SqlClause => {
  const jsonPath = `$.${whereField}`;
  return {
    sql: `AND (
      (json_type(data, ?) IN ('text', 'integer', 'real') AND CAST(json_extract(data, ?) AS TEXT) = ?)
      OR (json_type(data, ?) IN ('true', 'false') AND ((json_extract(data, ?) = 1 AND ? = 'true') OR (json_extract(data, ?) = 0 AND ? = 'false')))
    )`,
    params: [jsonPath, jsonPath, whereValue, jsonPath, jsonPath, whereValue, jsonPath, whereValue],
  };
};

const buildKeysetClause = (
  sortBy: DbSortBy,
  column: string,
  sortDir: DbSortDir,
  cursor: Cursor,
  cursorKey: string,
): SqlClause => {
  const comparator = sortDir === "asc" ? ">" : "<";
  if (sortBy === "id") {
    return { sql: `AND id ${comparator} ?`, params: [cursor.id] };
  }
  return {
    sql: `AND (${column} ${comparator} ? OR (${column} = ? AND id ${comparator} ?))`,
    params: [cursorKey, cursorKey, cursor.id],
  };
};

const toFtsMatch = (search: string): string | undefined => {
  const terms = search.split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) {
    return undefined;
  }
  // wrap each term in a quoted phrase so user input cannot inject FTS operators
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
};

const buildSearchClause = (collection: CollectionId, search: string): SqlClause | undefined => {
  const match = toFtsMatch(search);
  if (match === undefined) {
    return undefined;
  }
  return {
    sql: "AND id IN (SELECT id FROM documents_fts WHERE documents_fts MATCH ? AND collection = ?)",
    params: [match, collection],
  };
};

const make = Effect.gen(function* () {
  const config = yield* SqliteDatabaseConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const events = yield* DbEventsService;
  const clock = yield* DbClockService;

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  const connections = yield* SiteConnectionsService;

  const initDocuments = (site: SiteDb): void => {
    site.db.exec(CREATE_DOCUMENTS_SQL);
    site.db.exec(CREATE_CREATED_INDEX_SQL);
    site.db.exec(CREATE_UPDATED_INDEX_SQL);
    site.db.exec(CREATE_META_SQL);
    site.db.exec(CREATE_DOCUMENTS_FTS_SQL);
    site.db.exec(CREATE_DOCUMENTS_FTS_TRIGGERS_SQL);
    backfillDocumentsFts(site);
  };

  const openSite = (siteId: SiteId): Effect.Effect<SiteDb, DbOperationError, Scope.Scope> => {
    const storageKey = siteStorageKey(siteId);
    return connections.open(path.join(config.storageRoot, `${storageKey}.sqlite`), initDocuments);
  };

  const runSync = <A>(operation: string, f: () => A): Effect.Effect<A, DbOperationError> =>
    Effect.try({
      try: f,
      catch: (cause) => new DbOperationError({ operation, cause }),
    });

  const statement = prepareStatement;

  const parseRow = (
    siteId: SiteId,
    collection: CollectionId,
    row: DocumentRow,
  ): Effect.Effect<DbDocument, DbOperationError> =>
    Effect.gen(function* () {
      const data = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(DbDocumentDataFromJson)(row.data),
        catch: (cause) => new DbOperationError({ operation: "parseDocument", cause }),
      });
      return yield* Schema.decodeUnknownEffect(DbDocumentSchema)({
        id: row.id,
        siteId,
        collection,
        data,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }).pipe(
        Effect.mapError((cause) => new DbOperationError({ operation: "parseDocument", cause })),
      );
    });

  const createDocument = Effect.fn("Database.createDocument")(
    (
      siteId: SiteId,
      collection: CollectionId,
      input: DbCreateInput,
    ): Effect.Effect<DbDocument, DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const id = input.id ?? DocumentId.make(yield* randomId);
        const createdAt = yield* clock.currentTimeIso;
        const document: DbDocument = {
          id,
          siteId,
          collection,
          data: input.data,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        };

        yield* runSync("createDocument", () =>
          statement(
            site,
            `INSERT INTO documents (collection, id, data, version, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          ).run(
            collection,
            id,
            Schema.encodeSync(DbDocumentDataFromJson)(document.data),
            createdAt,
            createdAt,
          ),
        );

        yield* events.publish({
          type: "created",
          siteId,
          collection,
          id,
          document,
          at: createdAt,
        });

        return document;
      }).pipe(Effect.scoped),
  );

  const getDocument = Effect.fn("Database.getDocument")(
    (
      siteId: SiteId,
      collection: CollectionId,
      id: DocumentId,
    ): Effect.Effect<DbDocument, DocumentNotFoundError | DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const row = yield* runSync("getDocument", () => {
          const raw = statement(
            site,
            `SELECT collection, id, data, version, created_at, updated_at
             FROM documents
             WHERE collection = ? AND id = ?`,
          ).get(collection, id);
          return raw === undefined ? undefined : Schema.decodeUnknownSync(DocumentRowSchema)(raw);
        });
        if (row === undefined) {
          return yield* new DocumentNotFoundError({ siteId, collection, id });
        }
        return yield* parseRow(siteId, collection, row);
      }).pipe(Effect.scoped),
  );

  const updateDocument = Effect.fn("Database.updateDocument")(
    (
      siteId: SiteId,
      collection: CollectionId,
      id: DocumentId,
      input: DbUpdateInput,
    ): Effect.Effect<DbDocument, DbOperationError | VersionConflictError | DocumentNotFoundError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const updatedAt = yield* clock.currentTimeIso;
        const outcome = yield* runSync("updateDocument", () =>
          runInTransaction(site, () => {
            const raw = statement(
              site,
              `SELECT collection, id, data, version, created_at, updated_at
               FROM documents
               WHERE collection = ? AND id = ?`,
            ).get(collection, id);
            const row =
              raw === undefined ? undefined : Schema.decodeUnknownSync(DocumentRowSchema)(raw);
            if (row === undefined) {
              return documentMissing();
            }
            if (input.expectedVersion !== undefined && row.version !== input.expectedVersion) {
              return documentConflict({ actualVersion: row.version });
            }
            statement(
              site,
              `UPDATE documents
               SET data = ?, version = version + 1, updated_at = ?
               WHERE collection = ? AND id = ?`,
            ).run(Schema.encodeSync(DbDocumentDataFromJson)(input.data), updatedAt, collection, id);
            return documentWritten({ createdAt: row.created_at, version: row.version + 1 });
          }),
        );

        return yield* matchDocumentWriteOutcome(outcome, {
          missing: () => Effect.fail(new DocumentNotFoundError({ siteId, collection, id })),
          conflict: (value) =>
            Effect.fail(
              new VersionConflictError({
                id,
                expectedVersion: input.expectedVersion ?? 0,
                actualVersion: value.actualVersion,
              }),
            ),
          written: (value) =>
            Effect.gen(function* () {
              const updated: DbDocument = {
                id,
                siteId,
                collection,
                data: input.data,
                version: value.version,
                createdAt: value.createdAt,
                updatedAt,
              };

              yield* events.publish({
                type: "updated",
                siteId,
                collection,
                id,
                document: updated,
                at: updatedAt,
              });

              return updated;
            }),
        });
      }).pipe(Effect.scoped),
  );

  const deleteDocument = Effect.fn("Database.deleteDocument")(
    (
      siteId: SiteId,
      collection: CollectionId,
      id: DocumentId,
      input?: DbDeleteInput,
    ): Effect.Effect<void, DbOperationError | VersionConflictError | DocumentNotFoundError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const outcome = yield* runSync("deleteDocument", () =>
          runInTransaction(site, () => {
            const raw = statement(
              site,
              `SELECT collection, id, data, version, created_at, updated_at
               FROM documents
               WHERE collection = ? AND id = ?`,
            ).get(collection, id);
            const row =
              raw === undefined ? undefined : Schema.decodeUnknownSync(DocumentRowSchema)(raw);
            if (row === undefined) {
              return documentDeleteMissing();
            }
            if (input?.expectedVersion !== undefined && row.version !== input.expectedVersion) {
              return documentDeleteConflict({ actualVersion: row.version });
            }
            statement(site, "DELETE FROM documents WHERE collection = ? AND id = ?").run(
              collection,
              id,
            );
            return documentDeleted();
          }),
        );

        yield* matchDocumentDeleteOutcome(outcome, {
          missing: () => Effect.fail(new DocumentNotFoundError({ siteId, collection, id })),
          conflict: (value) =>
            Effect.fail(
              new VersionConflictError({
                id,
                expectedVersion: input?.expectedVersion ?? 0,
                actualVersion: value.actualVersion,
              }),
            ),
          deleted: () =>
            Effect.gen(function* () {
              const at = yield* clock.currentTimeIso;
              yield* events.publish({
                type: "deleted",
                siteId,
                collection,
                id,
                at,
              });
            }),
        });
      }).pipe(Effect.scoped),
  );

  const resolveCursor = (
    site: SiteDb,
    collection: CollectionId,
    query: DbListQuery | undefined,
    sortBy: DbSortBy,
  ): Effect.Effect<
    { cursor: Cursor | undefined; cursorKey: string | undefined },
    DbOperationError
  > =>
    Effect.gen(function* () {
      const cursor = query?.cursor !== undefined ? decodeCursor(query.cursor) : undefined;
      if (cursor === undefined) {
        return { cursor, cursorKey: undefined };
      }
      if (sortBy === "id") {
        return { cursor, cursorKey: cursor.id };
      }
      if (sortBy === "createdAt") {
        return { cursor, cursorKey: cursor.createdAt };
      }
      const row = yield* runSync("listDocuments", () =>
        statement(
          site,
          "SELECT updated_at FROM documents WHERE collection = ? AND id = ? AND created_at = ?",
        ).get(collection, cursor.id, cursor.createdAt),
      );
      const updatedAt = row?.["updated_at"];
      return Predicate.isString(updatedAt)
        ? { cursor, cursorKey: updatedAt }
        : { cursor: undefined, cursorKey: undefined };
    });

  const listDocuments = Effect.fn("Database.listDocuments")(
    (
      siteId: SiteId,
      collection: CollectionId,
      query?: DbListQuery,
    ): Effect.Effect<
      { documents: ReadonlyArray<DbDocument>; nextCursor?: string },
      DbOperationError
    > =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const limit = parseLimit(query);
        const sortBy = parseSortBy(query);
        const sortDir = parseSortDir(query);
        const column = sortColumn(sortBy);

        const { cursor, cursorKey } = yield* resolveCursor(site, collection, query, sortBy);

        const whereField = query?.whereField;
        const whereValue = query?.whereValue ?? "";
        if (whereField !== undefined && !FIELD_NAME_PATTERN.test(whereField)) {
          return { documents: [] };
        }

        const keyset: SqlClause =
          cursor !== undefined && cursorKey !== undefined
            ? buildKeysetClause(sortBy, column, sortDir, cursor, cursorKey)
            : { sql: "", params: [] };
        const filter =
          whereField !== undefined ? buildFilterClause(whereField, whereValue) : undefined;
        const search =
          query?.search !== undefined ? buildSearchClause(collection, query.search) : undefined;

        const orderDirection = sortDir === "asc" ? "ASC" : "DESC";
        const sql = `
          SELECT collection, id, data, version, created_at, updated_at
          FROM documents
          WHERE collection = ?
            ${keyset.sql}
            ${filter?.sql ?? ""}
            ${search?.sql ?? ""}
          ORDER BY ${column} ${orderDirection}, id ${orderDirection}
          LIMIT ?
        `;

        const rows = yield* runSync("listDocuments", () =>
          Schema.decodeUnknownSync(DocumentRowsSchema)(
            statement(site, sql).all(
              collection,
              ...keyset.params,
              ...(filter?.params ?? []),
              ...(search?.params ?? []),
              limit + 1,
            ),
          ),
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const documents = yield* Effect.forEach(page, (row) => parseRow(siteId, collection, row));
        const tail = page[page.length - 1];
        const nextCursor = hasMore && tail !== undefined ? cursorForDocument(tail) : undefined;

        return nextCursor !== undefined ? { documents, nextCursor } : { documents };
      }).pipe(Effect.scoped),
  );

  return {
    createDocument,
    listDocuments,
    getDocument,
    updateDocument,
    deleteDocument,
  } satisfies DatabaseApi;
});

export const SqliteDatabaseLayer = Layer.effect(DatabaseService, make).pipe(
  Layer.provide([SqliteDatabaseConfigLayer, DbClockLayer]),
);
