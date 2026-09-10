import { Buffer } from "node:buffer";
import type { DbListQuery, DbSortBy, DbSortDir } from "@ism0080/forge-core";
import { Clock, Context, Effect, Layer, Random, Ref } from "effect";

const SAFE_STORAGE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const siteStorageKey = (siteId: string): string =>
  SAFE_STORAGE_KEY_PATTERN.test(siteId)
    ? siteId
    : `encoded-${Buffer.from(siteId, "utf8").toString("base64url")}`;

export interface DbClockApi {
  readonly currentTimeMs: Effect.Effect<number>;
  readonly currentTimeIso: Effect.Effect<string>;
}

export class DbClockService extends Context.Service<DbClockService, DbClockApi>()(
  "forge/DbClockService",
) {}

export const DbClockLayer = Layer.effect(
  DbClockService,
  Effect.gen(function* () {
    const last = yield* Ref.make(0);
    const currentTimeMs = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const previous = yield* Ref.get(last);
      const next = now > previous ? now : previous + 1;
      yield* Ref.set(last, next);
      return next;
    });
    return {
      currentTimeMs,
      currentTimeIso: Effect.map(currentTimeMs, (ms) => new Date(ms).toISOString()),
    };
  }),
);

export const randomId: Effect.Effect<string> = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const random = yield* Random.next;
  return `${now.toString(36)}-${Math.floor(random * 0xffffffff)
    .toString(36)
    .padStart(8, "0")}`;
});

export const parseLimit = (query?: { readonly limit?: number | undefined }): number => {
  const raw = query?.limit;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 50;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > 200) return 200;
  return floored;
};

export const parseSortBy = (query?: DbListQuery): DbSortBy => {
  const raw = query?.sortBy;
  if (raw === "updatedAt" || raw === "id") {
    return raw;
  }
  return "createdAt";
};

export const parseSortDir = (query?: DbListQuery): DbSortDir => {
  return query?.sortDir === "asc" ? "asc" : "desc";
};
