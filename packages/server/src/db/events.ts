import type { DbChangeEvent } from "@forge/core";
import { Context, Effect, Layer } from "effect";

export interface DbEventFilter {
  readonly siteId?: string;
  readonly collection?: string;
}

export type DbEventListener = (event: DbChangeEvent) => void;

export interface DbEventsApi {
  readonly publish: (event: DbChangeEvent) => Effect.Effect<void, never>;
  readonly subscribe: (
    listener: DbEventListener,
    filter?: DbEventFilter,
  ) => Effect.Effect<() => void, never>;
}

export class DbEventsService extends Context.Service<DbEventsService, DbEventsApi>()(
  "forge/DbEventsService",
) {}

const matchesFilter = (event: DbChangeEvent, filter?: DbEventFilter): boolean => {
  if (!filter) {
    return true;
  }
  if (filter.siteId && filter.siteId !== event.siteId) {
    return false;
  }
  if (filter.collection && filter.collection !== event.collection) {
    return false;
  }
  return true;
};

export const DbEventsInMemoryLayer = Layer.sync(DbEventsService, () => {
  const listeners = new Set<{ listener: DbEventListener; filter?: DbEventFilter }>();

  return {
    publish: (event) =>
      Effect.sync(() => {
        for (const entry of listeners) {
          if (!matchesFilter(event, entry.filter)) {
            continue;
          }
          try {
            entry.listener(event);
          } catch {
            // listener failures are isolated from publisher
          }
        }
      }),
    subscribe: (listener, filter) =>
      Effect.sync(() => {
        const entry = filter ? { listener, filter } : { listener };
        listeners.add(entry);
        return () => {
          listeners.delete(entry);
        };
      }),
  };
});

export const DbEventsConsoleTapLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* DbEventsService;
    yield* events.subscribe((event) => {
      Effect.log(`db event ${event.type} ${event.siteId}/${event.collection}/${event.id}`).pipe(
        Effect.runFork,
      );
    });
  }),
);
