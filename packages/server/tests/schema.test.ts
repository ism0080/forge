import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ConfigProvider,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Predicate,
  Schema,
  Stream,
} from "effect";
import * as Result from "effect/Result";
import { SiteId, type SchemaRowChangeEvent } from "@ism0080/forge-core";
import {
  SchemaInvalidInputError,
  SchemaMigrationError,
  SchemaRowConflictError,
  SchemaService,
  SchemaServiceLayer,
} from "../src/services/db/schema-service.js";
import {
  DbEventsInMemoryLayer,
  DbEventsService,
  type ForgeDbEvent,
} from "../src/services/db/events.js";
import { SiteConnectionsLayer } from "../src/services/db/sqlite-connection.js";

const siteId = SiteId.make("site-a");
const drizzleFixtureSql = readFileSync(
  new URL("./fixtures/drizzle/20260909130000_create_users/migration.sql", import.meta.url),
  "utf8",
);

const initialMigration = {
  id: "0001_initial",
  sql: `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    name TEXT NOT NULL,
    active INTEGER,
    profile TEXT
  ) STRICT
  --> statement-breakpoint
  CREATE UNIQUE INDEX users_name_unique ON users (name)`,
} as const;

const secondMigration = {
  id: "0002_email",
  sql: "ALTER TABLE users ADD COLUMN email TEXT",
} as const;

const ProfileFromJson = Schema.fromJsonString(Schema.Struct({ role: Schema.String }));

const withSchema = <A, E>(
  effect: Effect.Effect<A, E, SchemaService | DbEventsService>,
  options: {
    readonly migrate?: boolean;
    readonly config?: Record<string, string | number>;
  } = { migrate: true },
) =>
  Effect.gen(function* () {
    const fs = yield* Effect.service(FileSystem.FileSystem);
    const storageRoot = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const layer = Layer.merge(DbEventsInMemoryLayer, SchemaServiceLayer).pipe(
      Layer.provide([
        DbEventsInMemoryLayer,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DATABASE_ROOT: storageRoot, ...options.config }),
        ),
        SiteConnectionsLayer,
      ]),
    );
    return yield* Effect.gen(function* () {
      const schema = yield* SchemaService;
      if (options.migrate !== false) {
        yield* schema.applyMigrations(siteId, [initialMigration], "test-deployment");
      }
      return yield* effect;
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer));

const failureOf = <A>(effect: Effect.Effect<A, unknown, SchemaService>) =>
  Effect.map(Effect.result(effect), (result) => {
    expect(Result.isFailure(result)).toBe(true);
    return Result.isFailure(result) ? result.failure : undefined;
  });

describe("SchemaService.applyMigrations", () => {
  it.effect("applies ordered Drizzle migrations split at statement breakpoints", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const result = yield* schema.applyMigrations(
          siteId,
          [initialMigration, secondMigration],
          "deploy-2",
        );
        expect(result.applied).toEqual(["0002_email"]);

        const row = yield* schema.insertRow(siteId, "users", {
          name: "Amy",
          email: "amy@example.test",
        });
        expect(row.email).toBe("amy@example.test");
      }),
    ),
  );

  it.effect("applies a Drizzle Kit migration fixture", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const result = yield* schema.applyMigrations(
          siteId,
          [{ id: "20260909130000_create_users", sql: drizzleFixtureSql }],
          "fixture-deployment",
        );
        expect(result.applied).toEqual(["20260909130000_create_users"]);
        const row = yield* schema.insertRow(siteId, "users", { name: "Amy" });
        expect(row).toMatchObject({ name: "Amy", active: 0, version: 1 });
      }),
      { migrate: false },
    ),
  );

  it.effect("is idempotent for an unchanged migration list", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const result = yield* schema.applyMigrations(siteId, [initialMigration], "deploy-2");
        expect(result.applied).toEqual([]);
      }),
    ),
  );

  it.effect("rejects a changed hash for an applied migration", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const error = yield* failureOf(
          schema.applyMigrations(
            siteId,
            [{ ...initialMigration, sql: `${initialMigration.sql}\n-- changed` }],
            "deploy-2",
          ),
        );
        expect(error).toBeInstanceOf(SchemaMigrationError);
        expect((error as SchemaMigrationError).message).toContain("hash changed");
      }),
    ),
  );

  it.effect("rejects a missing previously applied migration", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        yield* schema.applyMigrations(siteId, [initialMigration, secondMigration], "deploy-2");
        const error = yield* failureOf(
          schema.applyMigrations(siteId, [secondMigration], "deploy-3"),
        );
        expect(error).toBeInstanceOf(SchemaMigrationError);
        expect((error as SchemaMigrationError).message).toContain("missing or out of order");
      }),
    ),
  );

  it.effect("rolls back all pending migrations when a statement fails", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const failed = yield* failureOf(
          schema.applyMigrations(
            siteId,
            [
              {
                id: "0001_broken",
                sql: "CREATE TABLE rolled_back (id TEXT)--> statement-breakpoint\nINVALID SQL",
              },
            ],
            "deploy-broken",
          ),
        );
        expect(failed).toBeInstanceOf(SchemaMigrationError);

        const retry = yield* schema.applyMigrations(
          siteId,
          [
            {
              id: "0001_broken",
              sql: "CREATE TABLE rolled_back (id TEXT)",
            },
          ],
          "deploy-retry",
        );
        expect(retry.applied).toEqual(["0001_broken"]);
      }),
      { migrate: false },
    ),
  );

  it.effect("enforces migration count and byte limits", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const tooMany = yield* failureOf(
          schema.applyMigrations(
            siteId,
            [
              { id: "one", sql: "SELECT 1" },
              { id: "two", sql: "SELECT 2" },
            ],
            "limited-deployment",
          ),
        );
        expect((tooMany as SchemaMigrationError).message).toContain("count exceeds");

        const tooLarge = yield* failureOf(
          schema.applyMigrations(
            siteId,
            [{ id: "large", sql: "SELECT 123456789" }],
            "limited-deployment",
          ),
        );
        expect((tooLarge as SchemaMigrationError).message).toContain("exceeds 10 bytes");
      }),
      {
        migrate: false,
        config: {
          DB_MIGRATION_MAX_COUNT: 1,
          DB_MIGRATION_MAX_BYTES: 10,
          DB_MIGRATION_MAX_BUNDLE_BYTES: 20,
        },
      },
    ),
  );

  it.effect("enforces the migration execution budget between statements", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const error = yield* failureOf(
          schema.applyMigrations(siteId, [{ id: "slow", sql: "SELECT 1" }], "timed-deployment"),
        );
        expect((error as SchemaMigrationError).message).toContain("execution exceeded 0ms");
      }),
      { migrate: false, config: { DB_MIGRATION_TIMEOUT_MS: 0 } },
    ),
  );
});

describe("SchemaService rows", () => {
  it.effect("round-trips SQLite values without descriptor coercion", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const inserted = yield* schema.insertRow(siteId, "users", {
          name: "Amy",
          active: 1,
          profile: Schema.encodeSync(ProfileFromJson)({ role: "admin" }),
        });
        expect(inserted.version).toBe(1);
        expect(inserted.active).toBe(1);
        expect(inserted.profile).toBe('{"role":"admin"}');

        const fetched = yield* schema.getRow(siteId, "users", inserted.id as string);
        expect(fetched).toEqual(inserted);
      }),
    ),
  );

  it.effect("validates table and column identifiers against SQLite metadata", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        expect(
          yield* failureOf(schema.getRow(siteId, 'users"; DROP TABLE users;--', "x")),
        ).toBeInstanceOf(SchemaInvalidInputError);
        expect(
          yield* failureOf(schema.insertRow(siteId, "users", { name: "Amy", unknown: 1 })),
        ).toBeInstanceOf(SchemaInvalidInputError);
        expect(
          yield* failureOf(schema.insertRow(siteId, "users", { name: "Amy", active: true })),
        ).toBeInstanceOf(SchemaInvalidInputError);
      }),
    ),
  );

  it.effect("updates and deletes with optimistic concurrency", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const inserted = yield* schema.insertRow(siteId, "users", { name: "Amy" });
        const id = inserted.id as string;
        expect(
          yield* failureOf(
            schema.updateRow(siteId, "users", id, {
              data: { name: "Amelia" },
              expectedVersion: 9,
            }),
          ),
        ).toBeInstanceOf(SchemaRowConflictError);

        const updated = yield* schema.updateRow(siteId, "users", id, {
          data: { name: "Amelia", active: null },
          expectedVersion: 1,
        });
        expect(updated.version).toBe(2);
        expect(updated.name).toBe("Amelia");
        expect(updated.active).toBeNull();

        expect(
          yield* failureOf(schema.deleteRow(siteId, "users", id, { expectedVersion: 1 })),
        ).toBeInstanceOf(SchemaRowConflictError);
        yield* schema.deleteRow(siteId, "users", id, { expectedVersion: 2 });
        expect(yield* schema.getRow(siteId, "users", id)).toBeUndefined();
      }),
    ),
  );

  it.effect("lists rows ordered by created_at with keyset pagination", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        const rows: Array<Record<string, unknown>> = [];
        for (let index = 0; index < 5; index += 1) {
          rows.push(yield* schema.insertRow(siteId, "users", { name: `User ${index}` }));
        }

        const first = yield* schema.listRows(siteId, "users", { limit: 2, sortDir: "asc" });
        expect(first.rows.map((row) => row.name)).toEqual(["User 0", "User 1"]);
        expect(first.nextCursor).toBeTypeOf("string");

        const second = yield* schema.listRows(siteId, "users", {
          limit: 2,
          sortDir: "asc",
          cursor: first.nextCursor,
        });
        expect(second.rows.map((row) => row.name)).toEqual(["User 2", "User 3"]);

        const third = yield* schema.listRows(siteId, "users", {
          limit: 2,
          sortDir: "asc",
          cursor: second.nextCursor,
        });
        expect(third.rows.map((row) => row.name)).toEqual(["User 4"]);
        expect(third.nextCursor).toBeUndefined();
      }),
    ),
  );

  it.effect("lists rows in descending order by default", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        for (let index = 0; index < 3; index += 1) {
          yield* schema.insertRow(siteId, "users", { name: `User ${index}` });
        }
        const result = yield* schema.listRows(siteId, "users");
        expect(result.rows.map((row) => row.name)).toEqual(["User 2", "User 1", "User 0"]);
      }),
    ),
  );

  it.effect("keyset pagination does not duplicate or skip rows with tied created_at", () =>
    withSchema(
      Effect.gen(function* () {
        const schema = yield* SchemaService;
        yield* schema.applyMigrations(
          siteId,
          [
            initialMigration,
            {
              id: "0003_seed",
              sql: `INSERT INTO users (id, version, createdAt, updatedAt, name) VALUES
                ('seed-1', 1, 100, 100, 'A'),
                ('seed-2', 1, 100, 100, 'B'),
                ('seed-3', 1, 100, 100, 'C'),
                ('seed-4', 1, 100, 100, 'D'),
                ('seed-5', 1, 100, 100, 'E')`,
            },
          ],
          "seed-deployment",
        );

        const first = yield* schema.listRows(siteId, "users", { limit: 2, sortDir: "asc" });
        expect(first.rows.map((row) => row.name)).toEqual(["A", "B"]);

        const second = yield* schema.listRows(siteId, "users", {
          limit: 2,
          sortDir: "asc",
          cursor: first.nextCursor,
        });
        expect(second.rows.map((row) => row.name)).toEqual(["C", "D"]);

        const third = yield* schema.listRows(siteId, "users", {
          limit: 2,
          sortDir: "asc",
          cursor: second.nextCursor,
        });
        expect(third.rows.map((row) => row.name)).toEqual(["E"]);
        expect(third.nextCursor).toBeUndefined();
      }),
    ),
  );
});

describe("SchemaService events", () => {
  it.effect("publishes created, updated, and deleted row events", () =>
    withSchema(
      Effect.gen(function* () {
        const events = yield* DbEventsService;
        const schema = yield* SchemaService;

        const isRowEvent = (event: ForgeDbEvent): event is SchemaRowChangeEvent =>
          Predicate.hasProperty(event, "table");

        const receivedFiber = yield* events
          .stream({ siteId, table: "users" })
          .pipe(Stream.filter(isRowEvent), Stream.take(3), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;

        const inserted = yield* schema.insertRow(siteId, "users", { name: "Amy" });
        const id = inserted.id as string;
        yield* schema.updateRow(siteId, "users", id, { data: { name: "Amelia" } });
        yield* schema.deleteRow(siteId, "users", id);

        const received = [...(yield* Fiber.join(receivedFiber))];

        expect(received.map((event) => event.type)).toEqual(["created", "updated", "deleted"]);
        expect(received.map((event) => event.table)).toEqual(["users", "users", "users"]);
        expect(received[0]?.row?.name).toBe("Amy");
        expect(received[1]?.row?.name).toBe("Amelia");
        expect(received[2]?.row).toBeUndefined();
      }),
    ),
  );
});
