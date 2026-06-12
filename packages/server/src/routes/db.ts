import {
  DbCreateRequestSchema,
  type DbDeleteInput,
  DbUpdateRequestSchema,
  type DbDocumentData,
  type DbListQuery,
} from "@forge/core";
import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { DatabaseService } from "../db/service.js";

const parseCollectionAndId = (pathname: string): { collection: string; id?: string } => {
  const suffix = pathname.replace(/^\/api\/db\//, "");
  const segments = suffix.split("/").filter((segment) => segment.length > 0);
  const [collection, ...rest] = segments;
  const id = rest.length > 0 ? rest.join("/") : undefined;
  if (!collection) {
    return { collection: "" };
  }
  return id ? { collection, id } : { collection };
};

const parseListQuery = (url: URL): DbListQuery => {
  const limitRaw = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const whereField = url.searchParams.get("whereField") ?? undefined;
  const whereValue = url.searchParams.get("whereValue") ?? undefined;
  const sortByRaw = url.searchParams.get("sortBy") ?? undefined;
  const sortDirRaw = url.searchParams.get("sortDir") ?? undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const sortBy =
    sortByRaw === "createdAt" || sortByRaw === "updatedAt" || sortByRaw === "id"
      ? sortByRaw
      : undefined;
  const sortDir = sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined;

  return {
    ...(typeof limit === "number" && Number.isFinite(limit) ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
    ...(whereField ? { whereField } : {}),
    ...(typeof whereValue === "string" ? { whereValue } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortDir ? { sortDir } : {}),
  };
};

const notFoundOrInternal = (error: unknown): { status: number; body: { error: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("document not found")) {
    return { status: 404, body: { error: "document not found" } };
  }
  if (message.includes("version conflict")) {
    return { status: 409, body: { error: "version conflict" } };
  }
  return { status: 500, body: { error: message } };
};

export const DbListRoute = HttpRouter.add(
  "GET",
  "/api/db/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const database = yield* DatabaseService;

    const parsedUrl = new URL(request.url, "http://forge.local");
    const { collection, id } = parseCollectionAndId(parsedUrl.pathname);
    const siteId = parsedUrl.searchParams.get("siteId");

    if (!collection) {
      return HttpServerResponse.jsonUnsafe({ error: "collection is required" }, { status: 400 });
    }
    if (!siteId) {
      return HttpServerResponse.jsonUnsafe({ error: "siteId is required" }, { status: 400 });
    }

    if (id) {
      return yield* Effect.matchEffect(database.getDocument(siteId, collection, id), {
        onSuccess: (document) => Effect.succeed(HttpServerResponse.jsonUnsafe({ document })),
        onFailure: (error) => {
          const { status, body } = notFoundOrInternal(error);
          return Effect.succeed(HttpServerResponse.jsonUnsafe(body, { status }));
        },
      });
    }

    return yield* Effect.matchEffect(
      database.listDocuments(siteId, collection, parseListQuery(parsedUrl)),
      {
        onSuccess: (result) => Effect.succeed(HttpServerResponse.jsonUnsafe(result)),
        onFailure: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: 500 }));
        },
      },
    );
  }),
);

export const DbCreateRoute = HttpRouter.add(
  "POST",
  "/api/db/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const database = yield* DatabaseService;
    const payload = yield* HttpServerRequest.schemaBodyJson(DbCreateRequestSchema);

    const parsedUrl = new URL(request.url, "http://forge.local");
    const { collection, id } = parseCollectionAndId(parsedUrl.pathname);

    if (!collection) {
      return HttpServerResponse.jsonUnsafe({ error: "collection is required" }, { status: 400 });
    }
    if (id) {
      return HttpServerResponse.jsonUnsafe(
        { error: "create does not accept document id in path" },
        { status: 400 },
      );
    }

    const maybeId = Option.getOrUndefined(Option.fromNullishOr(payload.id));
    const createInput = maybeId
      ? { data: payload.data as DbDocumentData, id: maybeId }
      : { data: payload.data as DbDocumentData };

    return yield* Effect.matchEffect(
      database.createDocument(payload.siteId, collection, createInput),
      {
        onSuccess: (document) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ document }, { status: 201 })),
        onFailure: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: 500 }));
        },
      },
    );
  }),
);

export const DbUpdateRoute = HttpRouter.add(
  "PUT",
  "/api/db/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const database = yield* DatabaseService;
    const payload = yield* HttpServerRequest.schemaBodyJson(DbUpdateRequestSchema);

    const parsedUrl = new URL(request.url, "http://forge.local");
    const { collection, id } = parseCollectionAndId(parsedUrl.pathname);

    if (!collection || !id) {
      return HttpServerResponse.jsonUnsafe(
        { error: "collection and id are required" },
        { status: 400 },
      );
    }

    return yield* Effect.matchEffect(
      database.updateDocument(payload.siteId, collection, id, {
        data: payload.data as DbDocumentData,
      }),
      {
        onSuccess: (document) => Effect.succeed(HttpServerResponse.jsonUnsafe({ document })),
        onFailure: (error) => {
          const { status, body } = notFoundOrInternal(error);
          return Effect.succeed(HttpServerResponse.jsonUnsafe(body, { status }));
        },
      },
    );
  }),
);

export const DbDeleteRoute = HttpRouter.add(
  "DELETE",
  "/api/db/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const database = yield* DatabaseService;

    const parsedUrl = new URL(request.url, "http://forge.local");
    const { collection, id } = parseCollectionAndId(parsedUrl.pathname);
    const siteId = parsedUrl.searchParams.get("siteId");
    const expectedVersionRaw = parsedUrl.searchParams.get("expectedVersion");
    const expectedVersion = expectedVersionRaw
      ? Number.parseInt(expectedVersionRaw, 10)
      : undefined;

    if (!collection || !id) {
      return HttpServerResponse.jsonUnsafe(
        { error: "collection and id are required" },
        { status: 400 },
      );
    }
    if (!siteId) {
      return HttpServerResponse.jsonUnsafe({ error: "siteId is required" }, { status: 400 });
    }

    const input: DbDeleteInput =
      typeof expectedVersion === "number" && Number.isFinite(expectedVersion)
        ? { expectedVersion }
        : {};

    return yield* Effect.matchEffect(database.deleteDocument(siteId, collection, id, input), {
      onSuccess: () => Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true })),
      onFailure: (error) => {
        const { status, body } = notFoundOrInternal(error);
        return Effect.succeed(HttpServerResponse.jsonUnsafe(body, { status }));
      },
    });
  }),
);
