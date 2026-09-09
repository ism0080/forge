import type { DbChangeEvent, SchemaRowChangeEvent } from "@ism0080/forge-core";
import { Context, Effect, Layer } from "effect";

export type ForgeDbEvent = DbChangeEvent | SchemaRowChangeEvent;

export interface DbEventFilter {
  readonly siteId?: string;
  readonly collection?: string;
  readonly table?: string;
}

export type DbEventListener = (event: ForgeDbEvent) => void;

export interface DbEventsApi {
  readonly publish: (event: ForgeDbEvent) => Effect.Effect<void, never>;
  readonly subscribe: (
    listener: DbEventListener,
    filter?: DbEventFilter,
  ) => Effect.Effect<() => void, never>;
}

export class DbEventsService extends Context.Service<DbEventsService, DbEventsApi>()(
  "forge/DbEventsService",
) {}

const matchesFilter = (event: ForgeDbEvent, filter?: DbEventFilter): boolean => {
  if (!filter) {
    return true;
  }
  if (filter.siteId !== undefined && filter.siteId !== event.siteId) {
    return false;
  }
  if (filter.collection !== undefined) {
    return "collection" in event && event.collection === filter.collection;
  }
  if (filter.table !== undefined) {
    return "table" in event && event.table === filter.table;
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

const eventScope = (event: ForgeDbEvent): string =>
  "collection" in event ? event.collection : `tables/${event.table}`;

export const DbEventsConsoleTapLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const events = yield* DbEventsService;
    yield* events.subscribe((event) => {
      Effect.log(`db event ${event.type} ${event.siteId}/${eventScope(event)}/${event.id}`).pipe(
        Effect.runForkWith(context),
      );
    });
  }),
);
