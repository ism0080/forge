import { Config, Context, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type {
  DbDeleteInput,
  DbDocument,
  DbDocumentData,
  DbListQuery,
  DbSortBy,
  DbSortDir,
} from "@forge/core";
import { type DatabaseApi, DatabaseService } from "./service.js";
import { DbEventsService } from "./events.js";

export interface LocalFileDatabaseConfig {
  readonly storageRoot: string;
}

class LocalFileDatabaseConfigService extends Context.Service<
  LocalFileDatabaseConfigService,
  LocalFileDatabaseConfig
>()("forge/LocalFileDatabaseConfigService") {}

const LocalFileDatabaseConfigLayer = Layer.effect(
  LocalFileDatabaseConfigService,
  Effect.gen(function* () {
    const storageRoot = yield* Config.string("DATABASE_ROOT").pipe(Config.withDefault("./data/db"));
    return { storageRoot };
  }),
);

const cleanSegment = (value: string): string =>
  value.replaceAll("\\", "-").replaceAll("/", "-").trim().replaceAll("..", "-");

const nowIso = (): string => new Date().toISOString();

const randomId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const parseLimit = (query?: DbListQuery): number => {
  const raw = query?.limit;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 50;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > 200) return 200;
  return floored;
};

const cursorForDocument = (document: DbDocument): string => `${document.createdAt}|${document.id}`;

const decodeCursor = (cursor: string): { createdAt: string; id: string } | undefined => {
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) {
    return undefined;
  }
  return { createdAt, id };
};

const parseSortBy = (query?: DbListQuery): DbSortBy => {
  const raw = query?.sortBy;
  if (raw === "updatedAt" || raw === "id") {
    return raw;
  }
  return "createdAt";
};

const parseSortDir = (query?: DbListQuery): DbSortDir => {
  return query?.sortDir === "asc" ? "asc" : "desc";
};

const compareDocs = (
  a: DbDocument,
  b: DbDocument,
  sortBy: DbSortBy,
  sortDir: DbSortDir,
): number => {
  const direction = sortDir === "asc" ? 1 : -1;
  const left = sortBy === "id" ? a.id : sortBy === "updatedAt" ? a.updatedAt : a.createdAt;
  const right = sortBy === "id" ? b.id : sortBy === "updatedAt" ? b.updatedAt : b.createdAt;
  const cmp = left.localeCompare(right);
  if (cmp !== 0) {
    return cmp * direction;
  }
  return a.id.localeCompare(b.id) * direction;
};

const matchesWhere = (document: DbDocument, query?: DbListQuery): boolean => {
  const whereField = query?.whereField;
  if (!whereField) {
    return true;
  }
  const whereValue = query?.whereValue ?? "";
  const value = (document.data as Record<string, unknown>)[whereField];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value) === whereValue;
  }
  return false;
};

const parseDocument = (raw: string): Effect.Effect<DbDocument, Error> =>
  Effect.try({
    try: () => JSON.parse(raw) as DbDocument,
    catch: (error) => new Error(`invalid db document: ${String(error)}`),
  });

const make = Effect.gen(function* () {
  const config = yield* LocalFileDatabaseConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const events = yield* DbEventsService;

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  const collectionPath = (siteId: string, collection: string): string =>
    path.join(config.storageRoot, cleanSegment(siteId), cleanSegment(collection));

  const documentPath = (siteId: string, collection: string, id: string): string =>
    path.join(collectionPath(siteId, collection), `${cleanSegment(id)}.json`);

  const readDocument = (
    siteId: string,
    collection: string,
    id: string,
  ): Effect.Effect<DbDocument, Error> =>
    Effect.gen(function* () {
      const fullPath = documentPath(siteId, collection, id);
      const exists = yield* fs.exists(fullPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return yield* Effect.fail(new Error("document not found"));
      }
      const raw = yield* fs.readFileString(fullPath);
      return yield* parseDocument(raw);
    });

  const writeDocument = (
    siteId: string,
    collection: string,
    document: DbDocument,
  ): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const fullPath = documentPath(siteId, collection, document.id);
      yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true });
      yield* fs.writeFileString(fullPath, `${JSON.stringify(document)}\n`);
    });

  return {
    createDocument: (siteId, collection, input) =>
      Effect.gen(function* () {
        const id = input.id ? cleanSegment(input.id) : randomId();
        const createdAt = nowIso();
        const document: DbDocument = {
          id,
          siteId,
          collection,
          data: input.data as DbDocumentData,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        };

        const fullPath = documentPath(siteId, collection, id);
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true });
        yield* fs.writeFileString(fullPath, `${JSON.stringify(document)}\n`);
        yield* events.publish({
          type: "created",
          siteId,
          collection,
          id,
          document,
          at: nowIso(),
        });

        return document;
      }).pipe(Effect.mapError((error) => new Error(`createDocument failed: ${String(error)}`))),
    listDocuments: (siteId, collection, query) =>
      Effect.gen(function* () {
        const dir = collectionPath(siteId, collection);
        const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return { documents: [] };
        }

        const entries = yield* fs.readDirectory(dir);
        const files = entries
          .filter((entry) => entry.endsWith(".json"))
          .sort((a, b) => a.localeCompare(b));

        const docs = yield* Effect.forEach(files, (entry) =>
          Effect.gen(function* () {
            const fullPath = path.join(dir, entry);
            const raw = yield* fs.readFileString(fullPath);
            return yield* parseDocument(raw);
          }),
        );

        const sortBy = parseSortBy(query);
        const sortDir = parseSortDir(query);
        const sorted = docs
          .filter((doc) => matchesWhere(doc, query))
          .sort((a, b) => compareDocs(a, b, sortBy, sortDir));

        const cursorMarker = query?.cursor ? decodeCursor(query.cursor) : undefined;
        const startIndex = cursorMarker
          ? sorted.findIndex(
              (doc) => doc.createdAt === cursorMarker.createdAt && doc.id === cursorMarker.id,
            ) + 1
          : 0;

        const limit = parseLimit(query);
        const documents = sorted.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
        const tail = sorted.slice(Math.max(0, startIndex) + limit);
        const nextCursor =
          tail.length > 0 && documents.length > 0
            ? cursorForDocument(documents[documents.length - 1] as DbDocument)
            : undefined;

        return nextCursor ? { documents, nextCursor } : { documents };
      }).pipe(Effect.mapError((error) => new Error(`listDocuments failed: ${String(error)}`))),
    getDocument: (siteId, collection, id) =>
      readDocument(siteId, collection, cleanSegment(id)).pipe(
        Effect.mapError((error) => new Error(`getDocument failed: ${String(error)}`)),
      ),
    updateDocument: (siteId, collection, id, input) =>
      Effect.gen(function* () {
        const cleanId = cleanSegment(id);
        const existing = yield* readDocument(siteId, collection, cleanId);
        if (
          typeof input.expectedVersion === "number" &&
          existing.version !== input.expectedVersion
        ) {
          return yield* Effect.fail(new Error("version conflict"));
        }
        const updated: DbDocument = {
          ...existing,
          data: input.data as DbDocumentData,
          version: existing.version + 1,
          updatedAt: nowIso(),
        };
        yield* writeDocument(siteId, collection, updated);
        yield* events.publish({
          type: "updated",
          siteId,
          collection,
          id: updated.id,
          document: updated,
          at: nowIso(),
        });
        return updated;
      }).pipe(Effect.mapError((error) => new Error(`updateDocument failed: ${String(error)}`))),
    deleteDocument: (siteId, collection, id, input?: DbDeleteInput) =>
      Effect.gen(function* () {
        const cleanId = cleanSegment(id);
        const existing = yield* readDocument(siteId, collection, cleanId);
        if (
          typeof input?.expectedVersion === "number" &&
          existing.version !== input.expectedVersion
        ) {
          return yield* Effect.fail(new Error("version conflict"));
        }
        const fullPath = documentPath(siteId, collection, cleanId);
        const exists = yield* fs.exists(fullPath).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return yield* Effect.fail(new Error("document not found"));
        }
        yield* fs.remove(fullPath);
        yield* events.publish({
          type: "deleted",
          siteId,
          collection,
          id: existing.id,
          at: nowIso(),
        });
      }).pipe(Effect.mapError((error) => new Error(`deleteDocument failed: ${String(error)}`))),
  } satisfies DatabaseApi;
});

export const LocalFileDatabaseLayer = Layer.effect(DatabaseService, make).pipe(
  Layer.provide(LocalFileDatabaseConfigLayer),
);
