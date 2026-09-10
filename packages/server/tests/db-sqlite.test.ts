import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import * as Result from "effect/Result";
import {
  CollectionId,
  DbOperationError,
  DocumentNotFoundError,
  DocumentId,
  SiteId,
  VersionConflictError,
} from "@ism0080/forge-core";
import type { DbDocument } from "@ism0080/forge-core";
import { DatabaseService } from "../src/services/db/service.js";
import { SqliteDatabaseLayer } from "../src/services/db/sqlite.js";
import { DbEventsInMemoryLayer } from "../src/services/db/events.js";
import { SiteConnectionsLayer } from "../src/services/db/sqlite-connection.js";

const siteId = SiteId.make("site-a");
const otherSiteId = SiteId.make("site-b");
const collection = CollectionId.make("posts");

const withDatabase = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
  Effect.gen(function* () {
    const fs = yield* Effect.service(FileSystem.FileSystem);
    const storageRoot = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

    const layer = SqliteDatabaseLayer.pipe(
      Layer.provide([
        DbEventsInMemoryLayer,
        ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_ROOT: storageRoot })),
        SiteConnectionsLayer,
      ]),
    );

    return yield* effect.pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer));

describe("SqliteDatabaseLayer", () => {
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
        expect(found.version).toBe(1);
      }),
    ),
  );

  it.effect("rejects duplicate explicit ids", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        yield* database.createDocument(siteId, collection, {
          data: { title: "First" },
          id: DocumentId.make("fixed-id"),
        });

        const duplicate = yield* database
          .createDocument(siteId, collection, {
            data: { title: "Second" },
            id: DocumentId.make("fixed-id"),
          })
          .pipe(Effect.result);
        expect(Result.isFailure(duplicate)).toBe(true);
        if (Result.isFailure(duplicate)) {
          expect(duplicate.failure).toBeInstanceOf(DbOperationError);
        }
      }),
    ),
  );

  it.effect("lists documents with keyset pagination until exhausted", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const created: DbDocument[] = [];
        for (const title of ["One", "Two", "Three", "Four", "Five"]) {
          created.push(yield* database.createDocument(siteId, collection, { data: { title } }));
        }

        const pages: DbDocument[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
          const result = yield* database.listDocuments(siteId, collection, {
            limit: 2,
            cursor,
          });
          pages.push(...result.documents);
          cursor = result.nextCursor;
          if (cursor === undefined) {
            break;
          }
        }

        expect(cursor).toBeUndefined();
        expect(pages).toHaveLength(5);
        expect(pages.map((document) => document.data.title)).toEqual([
          "Five",
          "Four",
          "Three",
          "Two",
          "One",
        ]);
        expect(created).toHaveLength(5);
      }),
    ),
  );

  it.effect("sorts by updatedAt with pagination", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const first = yield* database.createDocument(siteId, collection, {
          data: { title: "First" },
        });
        const second = yield* database.createDocument(siteId, collection, {
          data: { title: "Second" },
        });
        const third = yield* database.createDocument(siteId, collection, {
          data: { title: "Third" },
        });

        yield* database.updateDocument(siteId, collection, first.id, {
          data: { title: "First edited" },
        });

        const page = yield* database.listDocuments(siteId, collection, {
          sortBy: "updatedAt",
          sortDir: "desc",
          limit: 2,
        });
        expect(page.documents.map((document) => document.id)).toEqual([first.id, third.id]);
        expect(page.nextCursor).toBeDefined();

        const secondPage = yield* database.listDocuments(siteId, collection, {
          sortBy: "updatedAt",
          sortDir: "desc",
          limit: 2,
          cursor: page.nextCursor,
        });
        expect(secondPage.documents.map((document) => document.id)).toEqual([second.id]);
        expect(secondPage.nextCursor).toBeUndefined();
      }),
    ),
  );

  it.effect("sorts by id with pagination", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        for (const id of ["a", "b", "c"]) {
          yield* database.createDocument(siteId, collection, {
            id: DocumentId.make(id),
            data: { id },
          });
        }

        const firstPage = yield* database.listDocuments(siteId, collection, {
          sortBy: "id",
          sortDir: "asc",
          limit: 2,
        });
        expect(firstPage.documents.map((document) => document.id)).toEqual(["a", "b"]);

        const secondPage = yield* database.listDocuments(siteId, collection, {
          sortBy: "id",
          sortDir: "asc",
          limit: 2,
          cursor: firstPage.nextCursor,
        });
        expect(secondPage.documents.map((document) => document.id)).toEqual(["c"]);
      }),
    ),
  );

  it.effect("filters by field value", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        yield* database.createDocument(siteId, collection, {
          data: { author: "amy", views: 3 },
        });
        yield* database.createDocument(siteId, collection, {
          data: { author: "bob", views: 5 },
        });
        yield* database.createDocument(siteId, collection, {
          data: { author: "amy", views: 11 },
        });

        const filtered = yield* database.listDocuments(siteId, collection, {
          whereField: "author",
          whereValue: "amy",
        });
        expect(filtered.documents).toHaveLength(2);
        expect(filtered.documents.every((document) => document.data.author === "amy")).toBe(true);

        const numeric = yield* database.listDocuments(siteId, collection, {
          whereField: "views",
          whereValue: "5",
        });
        expect(numeric.documents).toHaveLength(1);
        expect(numeric.documents[0]?.data.author).toBe("bob");

        const none = yield* database.listDocuments(siteId, collection, {
          whereField: "author",
          whereValue: "zed",
        });
        expect(none.documents).toEqual([]);
      }),
    ),
  );

  it.effect("searches documents with full-text search and keeps the index in sync", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const alpha = yield* database.createDocument(siteId, collection, {
          data: { title: "Alpha release notes", body: "shipped the alpha" },
        });
        yield* database.createDocument(siteId, collection, {
          data: { title: "Beta release notes", body: "shipped the beta" },
        });

        const alphaMatches = yield* database.listDocuments(siteId, collection, {
          search: "alpha",
        });
        expect(alphaMatches.documents.map((document) => document.id)).toEqual([alpha.id]);

        const none = yield* database.listDocuments(siteId, collection, { search: "gamma" });
        expect(none.documents).toEqual([]);

        yield* database.updateDocument(siteId, collection, alpha.id, {
          data: { title: "Alpha release notes", body: "renamed to gamma" },
        });
        const afterUpdate = yield* database.listDocuments(siteId, collection, {
          search: "gamma",
        });
        expect(afterUpdate.documents.map((document) => document.id)).toEqual([alpha.id]);
        const betaOnly = yield* database.listDocuments(siteId, collection, {
          search: "shipped",
        });
        expect(betaOnly.documents).toHaveLength(1);

        yield* database.deleteDocument(siteId, collection, alpha.id);
        const afterDelete = yield* database.listDocuments(siteId, collection, {
          search: "gamma",
        });
        expect(afterDelete.documents).toEqual([]);
      }),
    ),
  );

  it.effect("keeps sites isolated", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;

        const inSiteA = yield* database.createDocument(siteId, collection, {
          data: { site: "a" },
        });
        const inSiteB = yield* database.createDocument(otherSiteId, collection, {
          data: { site: "b" },
        });

        const fromA = yield* database.getDocument(siteId, collection, inSiteA.id);
        expect(fromA.data).toEqual({ site: "a" });

        const fromB = yield* database
          .getDocument(otherSiteId, collection, inSiteA.id)
          .pipe(Effect.result);
        expect(Result.isFailure(fromB)).toBe(true);

        const inSiteBList = yield* database.listDocuments(otherSiteId, collection, {});
        expect(inSiteBList.documents.map((document) => document.id)).toEqual([inSiteB.id]);
      }),
    ),
  );

  it.effect("keeps colliding path-like site ids isolated", () =>
    withDatabase(
      Effect.gen(function* () {
        const database = yield* DatabaseService;
        const pathSite = SiteId.make("tenant/a");
        const dashedSite = SiteId.make("tenant-a");

        const pathDocument = yield* database.createDocument(pathSite, collection, {
          id: DocumentId.make("shared"),
          data: { site: "path" },
        });
        const dashedDocument = yield* database.createDocument(dashedSite, collection, {
          id: DocumentId.make("shared"),
          data: { site: "dashed" },
        });

        expect((yield* database.getDocument(pathSite, collection, pathDocument.id)).data).toEqual({
          site: "path",
        });
        expect(
          (yield* database.getDocument(dashedSite, collection, dashedDocument.id)).data,
        ).toEqual({ site: "dashed" });
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

        const untouched = yield* database.getDocument(siteId, collection, created.id);
        expect(untouched.data).toEqual({ title: "Hello" });
        expect(untouched.version).toBe(1);
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

        const conflict = yield* database
          .deleteDocument(siteId, collection, created.id, { expectedVersion: 1 })
          .pipe(Effect.result);
        expect(Result.isFailure(conflict)).toBe(true);

        yield* database.deleteDocument(siteId, collection, created.id, { expectedVersion: 2 });

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
