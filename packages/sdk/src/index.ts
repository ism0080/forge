import type {
  DbChangeEvent,
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbUpdateInput,
  JobDefinition,
  SchemaRowChangeEvent,
  SchemaRowData,
  UploadInput,
  WebhookSendInput,
} from "@ism0080/forge-core";
import {
  CollectionId,
  DbChangeEventSchema,
  DocumentId,
  SchemaRowChangeEventSchema,
  SiteId,
} from "@ism0080/forge-core";
import { Effect, Option, Predicate, Schema } from "effect";
import type { Mutable } from "effect/Types";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-core/api";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

export interface ForgeClientOptions {
  readonly baseUrl: string;
  readonly siteId?: string;
}

const DbChangeEventFromJson = Schema.fromJsonString(DbChangeEventSchema);
const SchemaRowChangeEventFromJson = Schema.fromJsonString(SchemaRowChangeEventSchema);

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
  dispatch: (raw: string) => void,
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
    dispatch(String(message.data));
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
    const decoded = Schema.decodeUnknownOption(DbChangeEventFromJson)(raw);
    if (Option.isNone(decoded)) {
      return;
    }
    const event = decoded.value;
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
    readonly onCreate?: (row: SchemaRowData) => void;
    readonly onUpdate?: (row: SchemaRowData) => void;
    readonly onDelete?: (id: string) => void;
    readonly onEvent?: (event: SchemaRowChangeEvent) => void;
    readonly onOpen?: () => void;
    readonly onError?: (event: Event) => void;
    readonly onClose?: (event: CloseEvent) => void;
  },
): (() => void) => {
  const wsUrl = buildEventsUrl(baseUrl, siteId, { table }).replace(/^http/i, "ws");
  return openEventSocket(wsUrl, handlers, (raw) => {
    const decoded = Schema.decodeUnknownOption(SchemaRowChangeEventFromJson)(raw);
    if (Option.isNone(decoded)) {
      return;
    }
    const event = decoded.value;
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
  Row extends SchemaRowData,
  Insert extends SchemaRowData,
  Patch extends SchemaRowData,
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
  readonly encode: (value: SchemaRowData) => SchemaRowData;
  readonly decode: (value: SchemaRowData) => SchemaRowData;
}

interface ErrorCodeByTag {
  readonly [tag: string]: string;
}

interface SchemaRowsListQuery {
  readonly siteId: SiteId;
  readonly limit?: number;
  readonly cursor?: string;
  readonly sortDir?: "asc" | "desc";
}

interface SchemaRowsPage {
  readonly rows: Array<SchemaRowData>;
  readonly nextCursor?: string;
}

interface SchemaRowUpdatePayload {
  readonly siteId: SiteId;
  readonly data: SchemaRowData;
  readonly expectedVersion?: number;
}

interface SchemaRowDeleteQuery {
  readonly siteId: SiteId;
  readonly expectedVersion?: number;
}

interface RowSubscriptionHandlers {
  readonly onCreate?: (row: SchemaRowData) => void;
  readonly onUpdate?: (row: SchemaRowData) => void;
  readonly onDelete?: (id: string) => void;
  readonly onEvent?: (event: SchemaRowChangeEvent) => void;
  readonly onOpen?: () => void;
  readonly onError?: (event: Event) => void;
  readonly onClose?: (event: CloseEvent) => void;
}

interface JobCreatePayload {
  readonly siteId: SiteId;
  readonly name: string;
  readonly schedule: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
}

interface JobUpdatePayload {
  readonly siteId: SiteId;
  readonly name?: string;
  readonly schedule?: string;
  readonly payload?: JobPayload;
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

interface JobDeleteQuery {
  readonly siteId: SiteId;
  readonly expectedVersion?: number;
}

interface UploadQuery {
  readonly siteId: SiteId;
  readonly path: string;
  readonly contentType?: string;
}

const stringTableMapping = (name: string): TableMapping => ({
  name,
  encode: (value) => value,
  decode: (value) => value,
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
    decode: (value) =>
      Object.fromEntries(
        columns.flatMap(([property, column]) => {
          const driverValue = value[column.name];
          return driverValue === undefined
            ? []
            : [[property, driverValue === null ? null : column.mapFromDriverValue(driverValue)]];
        }),
      ),
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

const ERROR_CODE_BY_TAG: ErrorCodeByTag = {
  DocumentNotFoundError: "document not found",
  VersionConflictError: "version conflict",
  JobNotFoundError: "job not found",
  JobConflictError: "version conflict",
  SchemaRowNotFoundError: "row not found",
  SchemaRowConflictError: "version conflict",
  SiteNotFoundError: "not found",
  UploadTooLargeError: "upload too large",
};

const errorCode = (cause: unknown): string => {
  if (Predicate.isObject(cause)) {
    if (Predicate.isString(cause._tag)) {
      const mapped = ERROR_CODE_BY_TAG[cause._tag];
      if (mapped !== undefined) {
        return mapped;
      }
      const message = cause.message;
      if (Predicate.isString(message) && message.length > 0) {
        return message;
      }
      return cause._tag;
    }
    if (Predicate.isString(cause.error)) {
      return cause.error;
    }
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown error";
};

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const toForgeApiError = (cause: unknown): ForgeApiError =>
  cause instanceof ForgeApiError ? cause : new ForgeApiError(errorCode(cause), { cause });

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
    Row extends SchemaRowData = SchemaRowData,
    Insert extends SchemaRowData = DefaultDbTableInsert<Row>,
    Patch extends SchemaRowData = Partial<Insert>,
  >(name: string): ForgeTableClient<Row, Insert, Patch>;
  function tableClient(
    table: string | AnySQLiteTable,
  ): ForgeTableClient<SchemaRowData, SchemaRowData, SchemaRowData> {
    const mapping = Predicate.isString(table)
      ? stringTableMapping(table)
      : drizzleTableMapping(table);
    return {
      list: (query) => {
        const listQuery: Mutable<SchemaRowsListQuery> = { siteId: site };
        if (query?.limit !== undefined) listQuery.limit = query.limit;
        if (query?.cursor !== undefined) listQuery.cursor = query.cursor;
        if (query?.sortDir !== undefined) listQuery.sortDir = query.sortDir;
        return run(
          client["server.schema"]["schema.rows.list"]({
            params: { table: mapping.name },
            query: listQuery,
          }),
        ).then(({ rows, nextCursor }) => {
          const page: Mutable<SchemaRowsPage> = {
            rows: rows.map((row) => mapping.decode(row)),
          };
          if (nextCursor !== undefined) page.nextCursor = nextCursor;
          return page;
        });
      },
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
      update: (id, data, expectedVersion) => {
        const payload: Mutable<SchemaRowUpdatePayload> = {
          siteId: site,
          data: mapping.encode(data),
        };
        if (expectedVersion !== undefined) payload.expectedVersion = expectedVersion;
        return run(
          client["server.schema"]["schema.rows.update"]({
            params: { table: mapping.name, id },
            payload,
          }),
        ).then(({ row }) => ({ row: mapping.decode(row) }));
      },
      delete: (id, expectedVersion) => {
        const query: Mutable<SchemaRowDeleteQuery> = { siteId: site };
        if (expectedVersion !== undefined) query.expectedVersion = expectedVersion;
        return run(
          client["server.schema"]["schema.rows.delete"]({
            params: { table: mapping.name, id },
            query,
          }),
        );
      },
      subscribe: (handlers) => {
        const subscriptionHandlers: Mutable<RowSubscriptionHandlers> = {};
        if (handlers.onCreate !== undefined) {
          subscriptionHandlers.onCreate = (row) => handlers.onCreate?.(mapping.decode(row));
        }
        if (handlers.onUpdate !== undefined) {
          subscriptionHandlers.onUpdate = (row) => handlers.onUpdate?.(mapping.decode(row));
        }
        if (handlers.onDelete !== undefined) {
          subscriptionHandlers.onDelete = handlers.onDelete;
        }
        if (handlers.onEvent !== undefined) {
          subscriptionHandlers.onEvent = handlers.onEvent;
        }
        if (handlers.onOpen !== undefined) subscriptionHandlers.onOpen = handlers.onOpen;
        if (handlers.onError !== undefined) subscriptionHandlers.onError = handlers.onError;
        if (handlers.onClose !== undefined) subscriptionHandlers.onClose = handlers.onClose;
        return createRowSubscription(normalizedBaseUrl, siteId, mapping.name, subscriptionHandlers);
      },
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
        run(client["server.jobs"]["jobs.list"]({ query: { siteId: site } })).then(({ jobs }) => [
          ...jobs,
        ]),
      get: (id: string) =>
        run(
          client["server.jobs"]["jobs.get"]({
            params: { id: DocumentId.make(id) },
            query: { siteId: site },
          }),
        ).then(({ job }) => job),
      create: (input: ForgeJobInput) => {
        const payload: Mutable<JobCreatePayload> = {
          siteId: site,
          name: input.name,
          schedule: input.schedule,
        };
        if (input.payload !== undefined) payload.payload = input.payload;
        if (input.enabled !== undefined) payload.enabled = input.enabled;
        return run(client["server.jobs"]["jobs.create"]({ payload })).then(({ job }) => job);
      },
      update: (id: string, input: ForgeJobUpdateInput) => {
        const payload: Mutable<JobUpdatePayload> = { siteId: site };
        if (input.name !== undefined) payload.name = input.name;
        if (input.schedule !== undefined) payload.schedule = input.schedule;
        if (input.payload !== undefined) payload.payload = input.payload;
        if (input.enabled !== undefined) payload.enabled = input.enabled;
        if (input.expectedVersion !== undefined) payload.expectedVersion = input.expectedVersion;
        return run(
          client["server.jobs"]["jobs.update"]({
            params: { id: DocumentId.make(id) },
            payload,
          }),
        ).then(({ job }) => job);
      },
      delete: (id: string, expectedVersion?: number) => {
        const query: Mutable<JobDeleteQuery> = { siteId: site };
        if (expectedVersion !== undefined) query.expectedVersion = expectedVersion;
        return run(
          client["server.jobs"]["jobs.delete"]({
            params: { id: DocumentId.make(id) },
            query,
          }),
        );
      },
      run: (id: string) =>
        run(
          client["server.jobs"]["jobs.run"]({
            params: { id: DocumentId.make(id) },
            query: { siteId: site },
          }),
        ).then(({ job }) => job),
    } satisfies ForgeJobsClient,
    upload: (input: UploadInput) => {
      const query: Mutable<UploadQuery> = {
        siteId: site,
        path: input.path,
      };
      if (input.contentType) query.contentType = input.contentType;
      return run(
        client["server.upload"]["upload.create"]({
          query,
          payload: decodeBase64(input.contentBase64),
        }),
      );
    },
    plugins: {
      list: () => run(client["server.plugins"]["plugins.list"]({})),
    },
  };
};
