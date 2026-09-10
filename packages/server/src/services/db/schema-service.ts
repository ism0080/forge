import { createHash } from "node:crypto";
import { Config, Context, Data, Effect, Layer, Schema, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  DbOperationError,
  DocumentId,
  SchemaInvalidInputError,
  SchemaMigrationError,
  SchemaRowConflictError,
  SchemaRowNotFoundError,
  SiteId,
} from "@ism0080/forge-core";
import { DbClockLayer, DbClockService, parseLimit, randomId, siteStorageKey } from "./shared.js";
import { prepareStatement, runInTransaction, SiteConnectionsService } from "./sqlite-connection.js";
import type { SiteDb } from "./sqlite-connection.js";
import { DbEventsService } from "./events.js";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTERNAL_TABLE_PREFIX = "_forge_";
const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const MANAGED_FIELDS = new Set([
  "id",
  "version",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
]);

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _forge_migrations (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  deployment_id TEXT NOT NULL
) STRICT`;
const SELECT_MIGRATIONS_SQL =
  "SELECT id, hash FROM _forge_migrations ORDER BY applied_at ASC, rowid ASC";
const INSERT_MIGRATION_SQL =
  "INSERT INTO _forge_migrations (id, hash, applied_at, duration_ms, deployment_id) VALUES (?, ?, ?, ?, ?)";

type SqliteValue = string | number | bigint | Uint8Array | null;

interface StoredMigration {
  readonly id: string;
  readonly hash: string;
}

type RowWriteOutcome = Data.TaggedEnum<{
  missing: {};
  conflict: { readonly actualVersion: number };
  updated: {};
}>;

const {
  missing: rowWriteMissing,
  conflict: rowWriteConflict,
  updated: rowWritten,
  $match: matchRowWriteOutcome,
} = Data.taggedEnum<RowWriteOutcome>();

type RowDeleteOutcome = Data.TaggedEnum<{
  missing: {};
  conflict: { readonly actualVersion: number };
  deleted: {};
}>;

const {
  missing: rowDeleteMissing,
  conflict: rowDeleteConflict,
  deleted: rowDeleted,
  $match: matchRowDeleteOutcome,
} = Data.taggedEnum<RowDeleteOutcome>();

export interface SchemaMigration {
  readonly id: string;
  readonly sql: string;
}

export interface SchemaMigrationResult {
  readonly applied: ReadonlyArray<string>;
}

export {
  SchemaInvalidInputError,
  SchemaMigrationError,
  SchemaRowConflictError,
  SchemaRowNotFoundError,
};

export type SchemaRowError =
  | SchemaInvalidInputError
  | SchemaRowNotFoundError
  | SchemaRowConflictError
  | DbOperationError;

export interface SchemaApi {
  readonly applyMigrations: (
    siteId: SiteId,
    migrations: ReadonlyArray<SchemaMigration>,
    deploymentId: string,
  ) => Effect.Effect<SchemaMigrationResult, SchemaMigrationError | DbOperationError>;
  readonly getRow: (
    siteId: SiteId,
    table: string,
    id: string,
  ) => Effect.Effect<
    Record<string, unknown> | undefined,
    SchemaInvalidInputError | DbOperationError
  >;
  readonly listRows: (
    siteId: SiteId,
    table: string,
    query?: {
      readonly limit?: number | undefined;
      readonly cursor?: string | undefined;
      readonly sortDir?: "asc" | "desc" | undefined;
    },
  ) => Effect.Effect<
    { rows: ReadonlyArray<Record<string, unknown>>; nextCursor?: string },
    SchemaInvalidInputError | DbOperationError
  >;
  readonly insertRow: (
    siteId: SiteId,
    table: string,
    data: Record<string, unknown>,
  ) => Effect.Effect<Record<string, unknown>, SchemaRowError>;
  readonly updateRow: (
    siteId: SiteId,
    table: string,
    id: string,
    input: {
      readonly data: Record<string, unknown>;
      readonly expectedVersion?: number | undefined;
    },
  ) => Effect.Effect<Record<string, unknown>, SchemaRowError>;
  readonly deleteRow: (
    siteId: SiteId,
    table: string,
    id: string,
    input?: { readonly expectedVersion?: number | undefined },
  ) => Effect.Effect<void, SchemaRowError>;
}

export class SchemaService extends Context.Service<SchemaService, SchemaApi>()(
  "forge/SchemaService",
) {}

interface SchemaConfig {
  readonly storageRoot: string;
  readonly maxMigrationCount: number;
  readonly maxMigrationBytes: number;
  readonly maxMigrationBundleBytes: number;
  readonly migrationTimeoutMs: number;
}

class SchemaConfigService extends Context.Service<SchemaConfigService, SchemaConfig>()(
  "forge/SchemaConfigService",
) {}

const SchemaConfigLayer = Layer.effect(
  SchemaConfigService,
  Effect.gen(function* () {
    const storageRoot = yield* Config.string("DATABASE_ROOT").pipe(Config.withDefault("./data/db"));
    const maxMigrationCount = yield* Config.number("DB_MIGRATION_MAX_COUNT").pipe(
      Config.withDefault(100),
    );
    const maxMigrationBytes = yield* Config.number("DB_MIGRATION_MAX_BYTES").pipe(
      Config.withDefault(1_000_000),
    );
    const maxMigrationBundleBytes = yield* Config.number("DB_MIGRATION_MAX_BUNDLE_BYTES").pipe(
      Config.withDefault(5_000_000),
    );
    const migrationTimeoutMs = yield* Config.number("DB_MIGRATION_TIMEOUT_MS").pipe(
      Config.withDefault(30_000),
    );
    return {
      storageRoot,
      maxMigrationCount,
      maxMigrationBytes,
      maxMigrationBundleBytes,
      migrationTimeoutMs,
    };
  }),
);

const quoteIdentifier = (identifier: string): string => `"${identifier}"`;

const ListCursorFromJson = Schema.fromJsonString(
  Schema.Struct({
    created: Schema.String,
    id: Schema.String,
  }),
);

const makeListCursor = (created: unknown, id: unknown): string | undefined => {
  if (created === undefined || created === null || id === undefined || id === null) {
    return undefined;
  }
  return Schema.encodeSync(ListCursorFromJson)({
    created: String(created),
    id: String(id),
  });
};

const parseListCursor = (
  cursor: string | undefined,
  createdColumn: string,
  comparator: ">" | "<",
): Effect.Effect<{ readonly sql: string; readonly params: Array<string> }> =>
  cursor === undefined
    ? Effect.succeed({ sql: "", params: [] })
    : Schema.decodeUnknownEffect(ListCursorFromJson)(cursor).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed({ sql: "", params: [] }),
          onSuccess: ({ created, id }) =>
            Effect.succeed({
              sql: `AND (${quoteIdentifier(createdColumn)} ${comparator} ? OR (${quoteIdentifier(createdColumn)} = ? AND ${quoteIdentifier("id")} ${comparator} ?))`,
              params: [created, created, id],
            }),
        }),
      );

const validateTableIdentifier = (table: string): void => {
  if (!SAFE_IDENTIFIER_PATTERN.test(table) || table.startsWith(INTERNAL_TABLE_PREFIX)) {
    throw new SchemaInvalidInputError({ message: `invalid table name "${table}"` });
  }
};

const validateColumnIdentifier = (column: string): void => {
  if (!SAFE_IDENTIFIER_PATTERN.test(column)) {
    throw new SchemaInvalidInputError({ message: `invalid column name "${column}"` });
  }
};

const toSqliteValue = (column: string, value: unknown): SqliteValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new SchemaInvalidInputError({
    message: `column "${column}" must be a SQLite string, number, bigint, byte array, or null`,
  });
};

const make = Effect.gen(function* () {
  const config = yield* SchemaConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const events = yield* DbEventsService;
  const clock = yield* DbClockService;
  const connections = yield* SiteConnectionsService;

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  const initSchema = (site: SiteDb): void => {
    site.db.exec(MIGRATIONS_TABLE_SQL);
  };

  const openSite = (siteId: SiteId): Effect.Effect<SiteDb, DbOperationError, Scope.Scope> => {
    const storageKey = siteStorageKey(siteId);
    return connections.open(path.join(config.storageRoot, `${storageKey}.sqlite`), initSchema);
  };

  const runSync = <A>(operation: string, f: () => A): Effect.Effect<A, DbOperationError> =>
    Effect.try({
      try: f,
      catch: (cause) => new DbOperationError({ operation, cause }),
    });

  const getTableColumns = (
    site: SiteDb,
    table: string,
  ): Effect.Effect<ReadonlySet<string>, SchemaInvalidInputError | DbOperationError> =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => validateTableIdentifier(table),
        catch: (error) => error as SchemaInvalidInputError,
      });
      const rows = yield* runSync("inspectTable", () =>
        site.db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all(),
      );
      if (rows.length === 0) {
        return yield* new SchemaInvalidInputError({ message: `unknown table "${table}"` });
      }
      const columns = new Set(
        rows.map((row) => row.name).filter((name): name is string => typeof name === "string"),
      );
      if (!columns.has("id") || !columns.has("version")) {
        return yield* new SchemaInvalidInputError({
          message: `table "${table}" must have id and version columns for row CRUD`,
        });
      }
      return columns;
    });

  const validateDataColumns = (
    columns: ReadonlySet<string>,
    data: Record<string, unknown>,
  ): ReadonlyArray<string> => {
    const names = Object.keys(data);
    for (const name of names) {
      validateColumnIdentifier(name);
      if (MANAGED_FIELDS.has(name)) {
        throw new SchemaInvalidInputError({ message: `"${name}" is a managed column` });
      }
      if (!columns.has(name)) {
        throw new SchemaInvalidInputError({ message: `unknown column "${name}"` });
      }
    }
    return names;
  };

  const selectRow = (
    site: SiteDb,
    table: string,
    id: string,
  ): Record<string, unknown> | undefined =>
    prepareStatement(
      site,
      `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("id")} = ?`,
    ).get(id) as Record<string, unknown> | undefined;

  const applyMigrations = Effect.fn("Schema.applyMigrations")(
    (
      siteId: SiteId,
      migrations: ReadonlyArray<SchemaMigration>,
      deploymentId: string,
    ): Effect.Effect<SchemaMigrationResult, SchemaMigrationError | DbOperationError> =>
      Effect.gen(function* () {
        if (deploymentId.trim() === "") {
          return yield* new SchemaMigrationError({ message: "deployment id must not be empty" });
        }
        if (migrations.length > config.maxMigrationCount) {
          return yield* new SchemaMigrationError({
            message: `migration count exceeds limit of ${config.maxMigrationCount}`,
          });
        }
        const seenIds = new Set<string>();
        let bundleBytes = 0;
        for (const migration of migrations) {
          if (migration.id.trim() === "") {
            return yield* new SchemaMigrationError({ message: "migration id must not be empty" });
          }
          if (seenIds.has(migration.id)) {
            return yield* new SchemaMigrationError({
              message: `duplicate migration id "${migration.id}"`,
            });
          }
          seenIds.add(migration.id);
          const migrationBytes = Buffer.byteLength(migration.sql, "utf8");
          if (migrationBytes > config.maxMigrationBytes) {
            return yield* new SchemaMigrationError({
              message: `migration "${migration.id}" exceeds ${config.maxMigrationBytes} bytes`,
            });
          }
          bundleBytes += migrationBytes;
        }
        if (bundleBytes > config.maxMigrationBundleBytes) {
          return yield* new SchemaMigrationError({
            message: `migration bundle exceeds ${config.maxMigrationBundleBytes} bytes`,
          });
        }

        const site = yield* openSite(siteId);
        const appliedAt = yield* clock.currentTimeMs;
        const result = yield* Effect.try({
          try: () =>
            runInTransaction(site, () => {
              const stored = prepareStatement(
                site,
                SELECT_MIGRATIONS_SQL,
              ).all() as unknown as StoredMigration[];
              const submitted = migrations.map((migration) => ({
                ...migration,
                hash: createHash("sha256").update(migration.sql).digest("hex"),
              }));
              for (let index = 0; index < stored.length; index += 1) {
                const applied = stored[index];
                const candidate = submitted[index];
                if (applied === undefined) continue;
                if (candidate === undefined || candidate.id !== applied.id) {
                  throw new SchemaMigrationError({
                    message: `previously applied migration "${applied.id}" is missing or out of order`,
                  });
                }
                if (candidate.hash !== applied.hash) {
                  throw new SchemaMigrationError({
                    message: `migration "${applied.id}" hash changed after it was applied`,
                  });
                }
              }

              const pending = submitted.slice(stored.length);
              const bundleStartedAt = performance.now();
              for (const migration of pending) {
                const migrationStartedAt = performance.now();
                const statements = migration.sql
                  .split(MIGRATION_BREAKPOINT)
                  .map((statement) => statement.trim())
                  .filter((statement) => statement.length > 0);
                for (const statement of statements) {
                  if (performance.now() - bundleStartedAt > config.migrationTimeoutMs) {
                    throw new SchemaMigrationError({
                      message: `migration execution exceeded ${config.migrationTimeoutMs}ms`,
                    });
                  }
                  site.db.exec(statement);
                }
                if (performance.now() - bundleStartedAt > config.migrationTimeoutMs) {
                  throw new SchemaMigrationError({
                    message: `migration execution exceeded ${config.migrationTimeoutMs}ms`,
                  });
                }
                prepareStatement(site, INSERT_MIGRATION_SQL).run(
                  migration.id,
                  migration.hash,
                  appliedAt,
                  Math.ceil(performance.now() - migrationStartedAt),
                  deploymentId,
                );
              }
              return { applied: pending.map((migration) => migration.id) };
            }),
          catch: (cause) =>
            cause instanceof SchemaMigrationError
              ? cause
              : new SchemaMigrationError({
                  message: `failed to apply migrations: ${cause instanceof Error ? cause.message : String(cause)}`,
                }),
        });
        return result;
      }).pipe(Effect.scoped),
  );

  const getRow = Effect.fn("Schema.getRow")(
    (
      siteId: SiteId,
      table: string,
      id: string,
    ): Effect.Effect<
      Record<string, unknown> | undefined,
      SchemaInvalidInputError | DbOperationError
    > =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        yield* getTableColumns(site, table);
        return yield* runSync("getRow", () => selectRow(site, table, id));
      }).pipe(Effect.scoped),
  );

  const listRows = Effect.fn("Schema.listRows")(
    (
      siteId: SiteId,
      table: string,
      query?: {
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
        readonly sortDir?: "asc" | "desc" | undefined;
      },
    ): Effect.Effect<
      { rows: ReadonlyArray<Record<string, unknown>>; nextCursor?: string },
      SchemaInvalidInputError | DbOperationError
    > =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const columns = yield* getTableColumns(site, table);
        const createdColumn = columns.has("created_at")
          ? "created_at"
          : columns.has("createdAt")
            ? "createdAt"
            : undefined;
        if (createdColumn === undefined) {
          return yield* new SchemaInvalidInputError({
            message: `table "${table}" must have a created_at or createdAt column to list rows`,
          });
        }

        const limit = parseLimit(query);
        const sortDir = query?.sortDir === "asc" ? "ASC" : "DESC";
        const comparator = query?.sortDir === "asc" ? ">" : "<";

        const keyset = yield* parseListCursor(query?.cursor, createdColumn, comparator);

        const sql = `SELECT * FROM ${quoteIdentifier(table)}
          WHERE 1 = 1 ${keyset.sql}
          ORDER BY ${quoteIdentifier(createdColumn)} ${sortDir}, ${quoteIdentifier("id")} ${sortDir}
          LIMIT ?`;

        const rows = yield* runSync(
          "listRows",
          () =>
            prepareStatement(site, sql).all(...keyset.params, limit + 1) as ReadonlyArray<
              Record<string, unknown>
            >,
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const tail = page[page.length - 1];
        const nextCursor =
          hasMore && tail !== undefined ? makeListCursor(tail[createdColumn], tail.id) : undefined;

        return nextCursor !== undefined ? { rows: page, nextCursor } : { rows: page };
      }).pipe(Effect.scoped),
  );

  const insertRow = Effect.fn("Schema.insertRow")(
    (
      siteId: SiteId,
      table: string,
      data: Record<string, unknown>,
    ): Effect.Effect<Record<string, unknown>, SchemaRowError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const columns = yield* getTableColumns(site, table);
        const dataColumns = yield* Effect.try({
          try: () => validateDataColumns(columns, data),
          catch: (error) => error as SchemaInvalidInputError,
        });
        const id = DocumentId.make(yield* randomId);
        const createdAt = yield* clock.currentTimeMs;
        const values: Record<string, SqliteValue> = { id, version: 1 };
        if (columns.has("created_at")) values.created_at = createdAt;
        else if (columns.has("createdAt")) values.createdAt = createdAt;
        if (columns.has("updated_at")) values.updated_at = createdAt;
        else if (columns.has("updatedAt")) values.updatedAt = createdAt;
        for (const column of dataColumns) {
          values[column] = yield* Effect.try({
            try: () => toSqliteValue(column, data[column]),
            catch: (error) => error as SchemaInvalidInputError,
          });
        }
        const insertColumns = Object.keys(values);
        const sql = `INSERT INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`;
        yield* runSync("insertRow", () =>
          prepareStatement(site, sql).run(...insertColumns.map((column) => values[column]!)),
        );
        const row = yield* runSync("insertRow", () => selectRow(site, table, id));
        if (row === undefined) {
          return yield* new SchemaRowNotFoundError({ siteId, table, id });
        }
        yield* events.publish({
          type: "created",
          siteId,
          table,
          id,
          row,
          at: new Date(createdAt).toISOString(),
        });
        return row;
      }).pipe(Effect.scoped),
  );

  const updateRow = Effect.fn("Schema.updateRow")(
    (
      siteId: SiteId,
      table: string,
      id: string,
      input: {
        readonly data: Record<string, unknown>;
        readonly expectedVersion?: number | undefined;
      },
    ): Effect.Effect<Record<string, unknown>, SchemaRowError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        const columns = yield* getTableColumns(site, table);
        const dataColumns = yield* Effect.try({
          try: () => validateDataColumns(columns, input.data),
          catch: (error) => error as SchemaInvalidInputError,
        });
        const updatedAt = yield* clock.currentTimeMs;
        const values = yield* Effect.forEach(dataColumns, (column) =>
          Effect.try({
            try: () => toSqliteValue(column, input.data[column]),
            catch: (error) => error as SchemaInvalidInputError,
          }),
        );
        const outcome = yield* runSync("updateRow", () =>
          runInTransaction(site, () => {
            const existing = selectRow(site, table, id);
            if (existing === undefined) return rowWriteMissing();
            if (
              typeof input.expectedVersion === "number" &&
              existing.version !== input.expectedVersion
            ) {
              return rowWriteConflict({
                actualVersion: typeof existing.version === "number" ? existing.version : Number.NaN,
              });
            }
            const sets = dataColumns.map((column) => `${quoteIdentifier(column)} = ?`);
            const params: SqliteValue[] = [...values];
            const updatedAtColumn = columns.has("updated_at")
              ? "updated_at"
              : columns.has("updatedAt")
                ? "updatedAt"
                : undefined;
            if (updatedAtColumn !== undefined) {
              sets.push(`${quoteIdentifier(updatedAtColumn)} = ?`);
              params.push(updatedAt);
            }
            sets.push(`${quoteIdentifier("version")} = ${quoteIdentifier("version")} + 1`);
            prepareStatement(
              site,
              `UPDATE ${quoteIdentifier(table)} SET ${sets.join(", ")} WHERE ${quoteIdentifier("id")} = ?`,
            ).run(...params, id);
            return rowWritten();
          }),
        );
        return yield* matchRowWriteOutcome(outcome, {
          missing: () => Effect.fail(new SchemaRowNotFoundError({ siteId, table, id })),
          conflict: (value) =>
            Effect.fail(
              new SchemaRowConflictError({
                table,
                id,
                expectedVersion: input.expectedVersion ?? 0,
                actualVersion: value.actualVersion,
              }),
            ),
          updated: () =>
            Effect.gen(function* () {
              const row = yield* runSync("updateRow", () => selectRow(site, table, id));
              if (row === undefined) {
                return yield* new SchemaRowNotFoundError({ siteId, table, id });
              }
              yield* events.publish({
                type: "updated",
                siteId,
                table,
                id: DocumentId.make(id),
                row,
                at: new Date(updatedAt).toISOString(),
              });
              return row;
            }),
        });
      }).pipe(Effect.scoped),
  );

  const deleteRow = Effect.fn("Schema.deleteRow")(
    (
      siteId: SiteId,
      table: string,
      id: string,
      input?: { readonly expectedVersion?: number | undefined },
    ): Effect.Effect<void, SchemaRowError> =>
      Effect.gen(function* () {
        const site = yield* openSite(siteId);
        yield* getTableColumns(site, table);
        const outcome = yield* runSync("deleteRow", () =>
          runInTransaction(site, () => {
            const existing = selectRow(site, table, id);
            if (existing === undefined) return rowDeleteMissing();
            if (
              typeof input?.expectedVersion === "number" &&
              existing.version !== input.expectedVersion
            ) {
              return rowDeleteConflict({
                actualVersion: typeof existing.version === "number" ? existing.version : Number.NaN,
              });
            }
            prepareStatement(
              site,
              `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("id")} = ?`,
            ).run(id);
            return rowDeleted();
          }),
        );
        yield* matchRowDeleteOutcome(outcome, {
          missing: () => Effect.fail(new SchemaRowNotFoundError({ siteId, table, id })),
          conflict: (value) =>
            Effect.fail(
              new SchemaRowConflictError({
                table,
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
                table,
                id: DocumentId.make(id),
                at,
              });
            }),
        });
      }).pipe(Effect.scoped),
  );

  return { applyMigrations, getRow, listRows, insertRow, updateRow, deleteRow } satisfies SchemaApi;
});

export const SchemaServiceLayer = Layer.effect(SchemaService, make).pipe(
  Layer.provide([SchemaConfigLayer, DbClockLayer]),
);
