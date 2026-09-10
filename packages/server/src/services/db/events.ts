import type { DbChangeEvent, SchemaRowChangeEvent } from "@ism0080/forge-core";
import { Context, Effect, Layer, Predicate, PubSub, Stream } from "effect";

export type ForgeDbEvent = DbChangeEvent | SchemaRowChangeEvent;

export interface DbEventFilter {
  readonly siteId?: string;
  readonly collection?: string;
  readonly table?: string;
}

const DB_EVENT_BACKLOG = 256;

export interface DbEventsApi {
  readonly publish: (event: ForgeDbEvent) => Effect.Effect<void>;
  readonly stream: (filter?: DbEventFilter) => Stream.Stream<ForgeDbEvent>;
}

export class DbEventsService extends Context.Service<DbEventsService, DbEventsApi>()(
  "forge/DbEventsService",
) {}

const isSchemaRowEvent = (event: ForgeDbEvent): event is SchemaRowChangeEvent =>
  Predicate.hasProperty(event, "table");

const matchesFilter = (event: ForgeDbEvent, filter?: DbEventFilter): boolean => {
  if (!filter) {
    return true;
  }
  if (filter.siteId !== undefined && filter.siteId !== event.siteId) {
    return false;
  }
  if (filter.collection !== undefined) {
    return !isSchemaRowEvent(event) && event.collection === filter.collection;
  }
  if (filter.table !== undefined) {
    return isSchemaRowEvent(event) && event.table === filter.table;
  }
  return true;
};

export const DbEventsInMemoryLayer = Layer.effect(
  DbEventsService,
  Effect.gen(function* () {
    // `sliding` keeps a bounded per-subscriber queue so a slow websocket
    // client cannot block database writers or grow memory without limit.
    const pubsub = yield* PubSub.sliding<ForgeDbEvent>(DB_EVENT_BACKLOG);
    return {
      publish: (event) => PubSub.publish(pubsub, event).pipe(Effect.ignore),
      stream: (filter) => {
        const source = Stream.fromPubSub(pubsub);
        return filter === undefined
          ? source
          : source.pipe(Stream.filter((event) => matchesFilter(event, filter)));
      },
    } satisfies DbEventsApi;
  }),
);

const eventScope = (event: ForgeDbEvent): string =>
  isSchemaRowEvent(event) ? `tables/${event.table}` : event.collection;

export const DbEventsConsoleTapLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* DbEventsService;
    yield* events.stream().pipe(
      Stream.runForEach((event) =>
        Effect.log(`db event ${event.type} ${event.siteId}/${eventScope(event)}/${event.id}`),
      ),
      Effect.forkScoped,
    );
  }),
);
