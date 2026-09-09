import { Config, Context, Effect, Layer, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  CollectionId,
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

interface DocumentRow {
  readonly collection: string;
  readonly id: string;
  readonly data: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

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

const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

const sortColumn = (sortBy: DbSortBy): string => {
  switch (sortBy) {
    case "createdAt":
      return "created_at";
    case "updatedAt":
      return "updated_at";
    case "id":
      return "id";
  }
};

const buildFilterClause = (
  whereField: string,
  whereValue: string,
): { sql: string; params: Array<string | number> } => {
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
): { sql: string; params: Array<string | number> } => {
  const comparator = sortDir === "asc" ? ">" : "<";
  if (sortBy === "id") {
    return { sql: `AND id ${comparator} ?`, params: [cursor.id] };
  }
  return {
    sql: `AND (${column} ${comparator} ? OR (${column} = ? AND id ${comparator} ?))`,
    params: [cursorKey, cursorKey, cursor.id],
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

  const openSite = (siteId: SiteId): Effect.Effect<SiteDb, DbOperationError> =>
    Effect.try({
      try: () => {
        const storageKey = siteStorageKey(siteId);
        return connections.open(
          storageKey,
          path.join(config.storageRoot, `${storageKey}.sqlite`),
          (site) => {
            site.db.exec(CREATE_DOCUMENTS_SQL);
            site.db.exec(CREATE_CREATED_INDEX_SQL);
            site.db.exec(CREATE_UPDATED_INDEX_SQL);
          },
        );
      },
      catch: (cause) => new DbOperationError({ operation: "openDatabase", cause }),
    });

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
        try: () => JSON.parse(row.data) as unknown,
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
          ).run(collection, id, JSON.stringify(document.data), createdAt, createdAt),
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
      }),
  );

  const getDocument = Effect.fn("Database.getDocument")(
    (
      siteId: SiteId,
      collection: CollectionId,
      id: DocumentId,
    ): Effect.Effect<DbDocument, DocumentNotFoundError | DbOperationError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const row = yield* runSync("getDocument", () =>
          statement(
            site,
            `SELECT collection, id, data, version, created_at, updated_at
             FROM documents
             WHERE collection = ? AND id = ?`,
          ).get(collection, id),
        ) as Effect.Effect<DocumentRow | undefined, DbOperationError>;
        if (row === undefined) {
          return yield* new DocumentNotFoundError({ siteId, collection, id });
        }
        return yield* parseRow(siteId, collection, row);
      }),
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
            const row = statement(
              site,
              `SELECT collection, id, data, version, created_at, updated_at
               FROM documents
               WHERE collection = ? AND id = ?`,
            ).get(collection, id) as DocumentRow | undefined;
            if (row === undefined) {
              return { _tag: "missing" } as const;
            }
            if (
              typeof input.expectedVersion === "number" &&
              row.version !== input.expectedVersion
            ) {
              return {
                _tag: "conflict",
                actualVersion: row.version,
              } as const;
            }
            statement(
              site,
              `UPDATE documents
               SET data = ?, version = version + 1, updated_at = ?
               WHERE collection = ? AND id = ?`,
            ).run(JSON.stringify(input.data), updatedAt, collection, id);
            return {
              _tag: "written",
              createdAt: row.created_at,
              version: row.version + 1,
            } as const;
          }),
        );

        if (outcome._tag === "missing") {
          return yield* new DocumentNotFoundError({ siteId, collection, id });
        }
        if (outcome._tag === "conflict") {
          return yield* new VersionConflictError({
            id,
            expectedVersion: input.expectedVersion ?? 0,
            actualVersion: outcome.actualVersion,
          });
        }

        const updated: DbDocument = {
          id,
          siteId,
          collection,
          data: input.data,
          version: outcome.version,
          createdAt: outcome.createdAt,
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
            const row = statement(
              site,
              `SELECT collection, id, data, version, created_at, updated_at
               FROM documents
               WHERE collection = ? AND id = ?`,
            ).get(collection, id) as DocumentRow | undefined;
            if (row === undefined) {
              return { _tag: "missing" } as const;
            }
            if (
              typeof input?.expectedVersion === "number" &&
              row.version !== input.expectedVersion
            ) {
              return {
                _tag: "conflict",
                actualVersion: row.version,
              } as const;
            }
            statement(site, "DELETE FROM documents WHERE collection = ? AND id = ?").run(
              collection,
              id,
            );
            return { _tag: "deleted" } as const;
          }),
        );

        if (outcome._tag === "missing") {
          return yield* new DocumentNotFoundError({ siteId, collection, id });
        }
        if (outcome._tag === "conflict") {
          return yield* new VersionConflictError({
            id,
            expectedVersion: input?.expectedVersion ?? 0,
            actualVersion: outcome.actualVersion,
          });
        }

        const at = yield* clock.currentTimeIso;
        yield* events.publish({
          type: "deleted",
          siteId,
          collection,
          id,
          at,
        });
      }),
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
      const row = (yield* runSync("listDocuments", () =>
        statement(
          site,
          "SELECT updated_at FROM documents WHERE collection = ? AND id = ? AND created_at = ?",
        ).get(collection, cursor.id, cursor.createdAt),
      )) as { updated_at?: string } | undefined;
      return row?.updated_at !== undefined
        ? { cursor, cursorKey: row.updated_at }
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

        const keyset =
          cursor !== undefined && cursorKey !== undefined
            ? buildKeysetClause(sortBy, column, sortDir, cursor, cursorKey)
            : { sql: "", params: [] as Array<string | number> };
        const filter =
          whereField !== undefined ? buildFilterClause(whereField, whereValue) : undefined;

        const orderDirection = sortDir === "asc" ? "ASC" : "DESC";
        const sql = `
          SELECT collection, id, data, version, created_at, updated_at
          FROM documents
          WHERE collection = ?
            ${keyset.sql}
            ${filter?.sql ?? ""}
          ORDER BY ${column} ${orderDirection}, id ${orderDirection}
          LIMIT ?
        `;

        const rows = yield* runSync(
          "listDocuments",
          () =>
            statement(site, sql).all(
              collection,
              ...keyset.params,
              ...(filter?.params ?? []),
              limit + 1,
            ) as unknown as DocumentRow[],
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const documents = yield* Effect.forEach(page, (row) => parseRow(siteId, collection, row));
        const tail = page[page.length - 1];
        const nextCursor = hasMore && tail !== undefined ? cursorForDocument(tail) : undefined;

        return nextCursor !== undefined ? { documents, nextCursor } : { documents };
      }),
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
  Layer.provide(SqliteDatabaseConfigLayer),
  Layer.provide(DbClockLayer),
);
