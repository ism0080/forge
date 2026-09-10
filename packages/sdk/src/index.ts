import type {
  DbChangeEvent,
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbUpdateInput,
  JobDefinition,
  SchemaRowChangeEvent,
  UploadInput,
  WebhookSendInput,
} from "@ism0080/forge-core";
import { CollectionId, DocumentId, SiteId } from "@ism0080/forge-core";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

export interface ForgeClientOptions {
  readonly baseUrl: string;
  readonly siteId?: string;
}

const ensureNoLeadingSlash = (value: string): string => value.replace(/^\/+/, "");

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

interface SocketHandlers {
  readonly onOpen?: () => void;
  readonly onError?: (event: Event) => void;
  readonly onClose?: (event: CloseEvent) => void;
}

const buildEventsUrl = (
  baseUrl: string,
  siteId: string,
  scope: { readonly collection?: string; readonly table?: string },
): string => {
  const url = new URL(`${baseUrl}/api/db/events`);
  url.searchParams.set("siteId", siteId);
  if (scope.collection !== undefined) {
    url.searchParams.set("collection", scope.collection);
  }
  if (scope.table !== undefined) {
    url.searchParams.set("table", scope.table);
  }
  return url.toString();
};

const openEventSocket = (
  wsUrl: string,
  handlers: SocketHandlers,
  dispatch: (event: unknown) => void,
): (() => void) => {
  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    handlers.onOpen?.();
  };

  socket.onerror = (event) => {
    handlers.onError?.(event);
  };

  socket.onclose = (event) => {
    handlers.onClose?.(event);
  };

  socket.onmessage = (message) => {
    try {
      dispatch(JSON.parse(String(message.data)));
    } catch {
      // ignore malformed payloads
    }
  };

  return () => {
    socket.close();
  };
};

const createDbSubscription = (
  baseUrl: string,
  siteId: string,
  collection: string,
  handlers: {
    readonly onCreate?: (document: DbDocument) => void;
    readonly onUpdate?: (document: DbDocument) => void;
    readonly onDelete?: (id: string) => void;
    readonly onEvent?: (event: DbChangeEvent) => void;
    readonly onOpen?: () => void;
    readonly onError?: (event: Event) => void;
    readonly onClose?: (event: CloseEvent) => void;
  },
): (() => void) => {
  const wsUrl = buildEventsUrl(baseUrl, siteId, { collection }).replace(/^http/i, "ws");
  return openEventSocket(wsUrl, handlers, (raw) => {
    const event = raw as DbChangeEvent;
    handlers.onEvent?.(event);

    if (event.type === "created" && event.document) {
      handlers.onCreate?.(event.document);
      return;
    }

    if (event.type === "updated" && event.document) {
      handlers.onUpdate?.(event.document);
      return;
    }

    if (event.type === "deleted") {
      handlers.onDelete?.(event.id);
    }
  });
};

const createRowSubscription = (
  baseUrl: string,
  siteId: string,
  table: string,
  handlers: {
    readonly onCreate?: (row: Record<string, unknown>) => void;
    readonly onUpdate?: (row: Record<string, unknown>) => void;
    readonly onDelete?: (id: string) => void;
    readonly onEvent?: (event: SchemaRowChangeEvent) => void;
    readonly onOpen?: () => void;
    readonly onError?: (event: Event) => void;
    readonly onClose?: (event: CloseEvent) => void;
  },
): (() => void) => {
  const wsUrl = buildEventsUrl(baseUrl, siteId, { table }).replace(/^http/i, "ws");
  return openEventSocket(wsUrl, handlers, (raw) => {
    const event = raw as SchemaRowChangeEvent;
    handlers.onEvent?.(event);

    if (event.type === "created" && event.row) {
      handlers.onCreate?.(event.row);
      return;
    }

    if (event.type === "updated" && event.row) {
      handlers.onUpdate?.(event.row);
      return;
    }

    if (event.type === "deleted") {
      handlers.onDelete?.(event.id);
    }
  });
};

type DbManagedRowKeys = "id" | "version" | "createdAt" | "updatedAt";
type DefaultDbTableInsert<Row> = Omit<Row, DbManagedRowKeys>;

export interface ForgeMigration {
  readonly id: string;
  readonly sql: string;
}

type JobPayload = NonNullable<JobDefinition["payload"]>;

export interface ForgeJobInput {
  readonly name: string;
  readonly schedule: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
}

export interface ForgeJobUpdateInput {
  readonly name?: string;
  readonly schedule?: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

export interface ForgeJobsClient {
  readonly list: () => Promise<JobDefinition[]>;
  readonly get: (id: string) => Promise<JobDefinition>;
  readonly create: (input: ForgeJobInput) => Promise<JobDefinition>;
  readonly update: (id: string, input: ForgeJobUpdateInput) => Promise<JobDefinition>;
  readonly delete: (id: string, expectedVersion?: number) => Promise<{ ok: true }>;
  readonly run: (id: string) => Promise<JobDefinition>;
}

export interface ForgeTableClient<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Patch extends Record<string, unknown>,
> {
  readonly list: (query?: {
    readonly limit?: number;
    readonly cursor?: string;
    readonly sortDir?: "asc" | "desc";
  }) => Promise<{ rows: Row[]; nextCursor?: string }>;
  readonly get: (id: string) => Promise<{ row: Row }>;
  readonly insert: (data: Insert) => Promise<{ row: Row }>;
  readonly update: (id: string, data: Patch, expectedVersion?: number) => Promise<{ row: Row }>;
  readonly delete: (id: string, expectedVersion?: number) => Promise<{ ok: true }>;
  readonly subscribe: (handlers: {
    readonly onCreate?: (row: Row) => void;
    readonly onUpdate?: (row: Row) => void;
    readonly onDelete?: (id: string) => void;
    readonly onEvent?: (event: SchemaRowChangeEvent) => void;
    readonly onOpen?: () => void;
    readonly onError?: (event: Event) => void;
    readonly onClose?: (event: CloseEvent) => void;
  }) => () => void;
}

interface TableMapping {
  readonly name: string;
  readonly encode: (value: Record<string, unknown>) => Record<string, unknown>;
  readonly decode: <Row extends Record<string, unknown>>(value: Record<string, unknown>) => Row;
}

const stringTableMapping = (name: string): TableMapping => ({
  name,
  encode: (value) => value,
  decode: (value) => value as never,
});

const drizzleTableMapping = (table: AnySQLiteTable): TableMapping => {
  const columns = Object.entries(getTableColumns(table));
  return {
    name: getTableName(table),
    encode: (value) =>
      Object.fromEntries(
        columns.flatMap(([property, column]) =>
          value[property] === undefined
            ? []
            : [[column.name, column.mapToDriverValue(value[property])]],
        ),
      ),
    decode: <Row extends Record<string, unknown>>(value: Record<string, unknown>): Row =>
      Object.fromEntries(
        columns.flatMap(([property, column]) => {
          const driverValue = value[column.name];
          return driverValue === undefined
            ? []
            : [[property, driverValue === null ? null : column.mapFromDriverValue(driverValue)]];
        }),
      ) as Row,
  };
};

export class ForgeApiError extends Error {
  readonly code: string;

  constructor(code: string, options?: { readonly cause?: unknown }) {
    super(code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ForgeApiError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorCode = (error: unknown): string => {
  if (isRecord(error) && typeof error.error === "string") {
    return error.error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
};

const toForgeApiError = (error: unknown): ForgeApiError =>
  error instanceof ForgeApiError ? error : new ForgeApiError(errorCode(error), { cause: error });

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.mapError(toForgeApiError)));

export const createClient = ({ baseUrl, siteId = "" }: ForgeClientOptions) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const client = Effect.runSync(
    HttpApiClient.make(Api, { baseUrl: normalizedBaseUrl }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );

  const site = SiteId.make(siteId);

  function tableClient<Table extends AnySQLiteTable>(
    table: Table,
  ): ForgeTableClient<
    Table["$inferSelect"],
    Omit<Table["$inferInsert"], DbManagedRowKeys>,
    Partial<Omit<Table["$inferInsert"], DbManagedRowKeys>>
  >;
  function tableClient<
    Row extends Record<string, unknown> = Record<string, unknown>,
    Insert extends Record<string, unknown> = DefaultDbTableInsert<Row>,
    Patch extends Record<string, unknown> = Partial<Insert>,
  >(name: string): ForgeTableClient<Row, Insert, Patch>;
  function tableClient(
    table: string | AnySQLiteTable,
  ): ForgeTableClient<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> {
    const mapping =
      typeof table === "string" ? stringTableMapping(table) : drizzleTableMapping(table);
    return {
      list: (query) =>
        run(
          client["server.schema"]["schema.rows.list"]({
            params: { table: mapping.name },
            query: {
              siteId: site,
              ...(query?.limit !== undefined ? { limit: query.limit } : {}),
              ...(query?.cursor !== undefined ? { cursor: query.cursor } : {}),
              ...(query?.sortDir !== undefined ? { sortDir: query.sortDir } : {}),
            },
          }),
        ).then(({ rows, nextCursor }) => ({
          rows: rows.map((row) => mapping.decode(row)),
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        })),
      get: (id) =>
        run(
          client["server.schema"]["schema.rows.get"]({
            params: { table: mapping.name, id },
            query: { siteId: site },
          }),
        ).then(({ row }) => ({ row: mapping.decode(row) })),
      insert: (data) =>
        run(
          client["server.schema"]["schema.rows.insert"]({
            params: { table: mapping.name },
            payload: { siteId: site, data: mapping.encode(data) },
          }),
        ).then(({ row }) => ({ row: mapping.decode(row) })),
      update: (id, data, expectedVersion) =>
        run(
          client["server.schema"]["schema.rows.update"]({
            params: { table: mapping.name, id },
            payload: {
              siteId: site,
              data: mapping.encode(data),
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            },
          }),
        ).then(({ row }) => ({ row: mapping.decode(row) })),
      delete: (id, expectedVersion) =>
        run(
          client["server.schema"]["schema.rows.delete"]({
            params: { table: mapping.name, id },
            query: {
              siteId: site,
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            },
          }),
        ),
      subscribe: (handlers) =>
        createRowSubscription(normalizedBaseUrl, siteId, mapping.name, {
          ...(handlers.onCreate !== undefined
            ? { onCreate: (row) => handlers.onCreate?.(mapping.decode(row)) }
            : {}),
          ...(handlers.onUpdate !== undefined
            ? { onUpdate: (row) => handlers.onUpdate?.(mapping.decode(row)) }
            : {}),
          ...(handlers.onDelete !== undefined ? { onDelete: handlers.onDelete } : {}),
          ...(handlers.onEvent !== undefined ? { onEvent: handlers.onEvent } : {}),
          ...(handlers.onOpen !== undefined ? { onOpen: handlers.onOpen } : {}),
          ...(handlers.onError !== undefined ? { onError: handlers.onError } : {}),
          ...(handlers.onClose !== undefined ? { onClose: handlers.onClose } : {}),
        }),
    };
  }

  return {
    webhook: (input: WebhookSendInput) =>
      run(client["server.webhook.gateway"]["webhook.forward"]({ payload: input })),
    db: {
      collection: (name: string) => {
        const collection = CollectionId.make(ensureNoLeadingSlash(name));
        return {
          list: (query?: DbListQuery) =>
            run(
              client["server.db"]["db.documents.list"]({
                params: { collection },
                query: { ...query, siteId: site },
              }),
            ),
          create: (input: DbCreateInput) =>
            run(
              client["server.db"]["db.documents.create"]({
                params: { collection },
                payload: { siteId: site, data: input.data, id: input.id },
              }),
            ),
          get: (id: string) =>
            run(
              client["server.db"]["db.documents.get"]({
                params: { collection, id: DocumentId.make(id) },
                query: { siteId: site },
              }),
            ),
          update: (id: string, input: DbUpdateInput) =>
            run(
              client["server.db"]["db.documents.update"]({
                params: { collection, id: DocumentId.make(id) },
                payload: { siteId: site, data: input.data, expectedVersion: input.expectedVersion },
              }),
            ),
          delete: (id: string, input?: DbDeleteInput) =>
            run(
              client["server.db"]["db.documents.delete"]({
                params: { collection, id: DocumentId.make(id) },
                query: {
                  siteId: site,
                  expectedVersion: input?.expectedVersion,
                },
              }),
            ),
          subscribe: (handlers: Parameters<typeof createDbSubscription>[3]) =>
            createDbSubscription(normalizedBaseUrl, siteId, collection, handlers),
        };
      },
      applyMigrations: (deploymentId: string, migrations: ReadonlyArray<ForgeMigration>) =>
        run(
          client["server.schema"]["schema.migrations.apply"]({
            payload: { siteId: site, deploymentId, migrations: [...migrations] },
          }),
        ),
      table: tableClient,
    },
    jobs: {
      list: () =>
        run(client["server.jobs"]["jobs.list"]({ query: { siteId: site } })).then(
          ({ jobs }) => [...jobs],
        ),
      get: (id: string) =>
        run(
          client["server.jobs"]["jobs.get"]({
            params: { id: DocumentId.make(id) },
            query: { siteId: site },
          }),
        ).then(({ job }) => job),
      create: (input: ForgeJobInput) =>
        run(
          client["server.jobs"]["jobs.create"]({
            payload: {
              siteId: site,
              name: input.name,
              schedule: input.schedule,
              ...(input.payload !== undefined ? { payload: input.payload } : {}),
              ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            },
          }),
        ).then(({ job }) => job),
      update: (id: string, input: ForgeJobUpdateInput) =>
        run(
          client["server.jobs"]["jobs.update"]({
            params: { id: DocumentId.make(id) },
            payload: {
              siteId: site,
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
              ...(input.payload !== undefined ? { payload: input.payload } : {}),
              ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
              ...(input.expectedVersion !== undefined
                ? { expectedVersion: input.expectedVersion }
                : {}),
            },
          }),
        ).then(({ job }) => job),
      delete: (id: string, expectedVersion?: number) =>
        run(
          client["server.jobs"]["jobs.delete"]({
            params: { id: DocumentId.make(id) },
            query: {
              siteId: site,
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            },
          }),
        ),
      run: (id: string) =>
        run(
          client["server.jobs"]["jobs.run"]({
            params: { id: DocumentId.make(id) },
            query: { siteId: site },
          }),
        ).then(({ job }) => job),
    } satisfies ForgeJobsClient,
    upload: (input: UploadInput) =>
      run(
        client["server.upload"]["upload.create"]({
          payload: {
            siteId: site,
            path: input.path,
            contentBase64: input.contentBase64,
            ...(input.contentType ? { contentType: input.contentType } : {}),
          },
        }),
      ),
    plugins: {
      list: () => run(client["server.plugins"]["plugins.list"]({})),
    },
  };
};
