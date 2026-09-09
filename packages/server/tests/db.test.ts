import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import * as Result from "effect/Result";
import {
  CollectionId,
  DocumentNotFoundError,
  DocumentId,
  SiteId,
  VersionConflictError,
} from "@ism0080/forge-core";
import { DatabaseService } from "../src/services/db/service.js";
import { LocalFileDatabaseLayer } from "../src/services/db/local-file.js";
import { DbEventsInMemoryLayer } from "../src/services/db/events.js";

const siteId = SiteId.make("site-a");
const collection = CollectionId.make("posts");

const withDatabase = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
  Effect.gen(function* () {
    const fs = yield* Effect.service(FileSystem.FileSystem);
    const storageRoot = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

    const layer = LocalFileDatabaseLayer.pipe(
      Layer.provide([
        DbEventsInMemoryLayer,
        ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_ROOT: storageRoot })),
      ]),
    );

    return yield* effect.pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer));

describe("LocalFileDatabaseLayer", () => {
  it.effect("creates and reads a document", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const created = yield* database.createDocument(siteId, collection, {
          data: { title: "Hello" },
        });
        expect(created.id).toBeTypeOf("string");
        expect(created.version).toBe(1);

        const found = yield* database.getDocument(siteId, collection, created.id);
        expect(found.data).toEqual({ title: "Hello" });
      }),
    ),
  );

  it.effect("lists documents with pagination", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        yield* database.createDocument(siteId, collection, {
          data: { title: "One" },
        });
        yield* database.createDocument(siteId, collection, {
          data: { title: "Two" },
        });

        const first = yield* database.listDocuments(siteId, collection, { limit: 1 });
        expect(first.documents).toHaveLength(1);
        expect(first.nextCursor).toBeTypeOf("string");

        const second = yield* database.listDocuments(siteId, collection, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(second.documents).toHaveLength(1);
        expect(second.documents[0]?.data).not.toEqual(first.documents[0]?.data);
      }),
    ),
  );

  it.effect("fails with DocumentNotFoundError for a missing document", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const missing = yield* database
          .getDocument(siteId, collection, DocumentId.make("missing"))
          .pipe(Effect.result);
        expect(Result.isFailure(missing)).toBe(true);
        if (Result.isFailure(missing)) {
          expect(missing.failure).toBeInstanceOf(DocumentNotFoundError);
        }
      }),
    ),
  );

  it.effect("detects version conflicts on update", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const created = yield* database.createDocument(siteId, collection, {
          data: { title: "Hello" },
        });
        expect(created.version).toBe(1);

        const result = yield* database
          .updateDocument(siteId, collection, created.id, {
            data: { title: "Edited" },
            expectedVersion: 99,
          })
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(VersionConflictError);
        }
      }),
    ),
  );

  it.effect("updates and deletes a document", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const created = yield* database.createDocument(siteId, collection, {
          data: { title: "Hello" },
        });

        const updated = yield* database.updateDocument(siteId, collection, created.id, {
          data: { title: "Edited" },
          expectedVersion: 1,
        });
        expect(updated.version).toBe(2);
        expect(updated.data).toEqual({ title: "Edited" });

        yield* database.deleteDocument(siteId, collection, created.id);

        const missing = yield* database
          .getDocument(siteId, collection, created.id)
          .pipe(Effect.result);
        expect(Result.isFailure(missing)).toBe(true);
        if (Result.isFailure(missing)) {
          expect(missing.failure).toBeInstanceOf(DocumentNotFoundError);
        }
      }),
    ),
  );
});
