import type {
  DbChangeEvent,
  DbCreateInput,
  DbCreateResponse,
  DbDeleteInput,
  DbDeleteResponse,
  DbDocument,
  DbDocumentData,
  DbSortBy,
  DbSortDir,
  DbGetResponse,
  DbListQuery,
  DbListResponse,
  DbUpdateInput,
  DbUpdateResponse,
  WebhookSendInput,
  WebhookSendResponse,
} from "@ism0080/forge-core";

export interface ForgeClientOptions {
  readonly baseUrl: string;
  readonly siteId: string;
}

export interface DbCollectionClient {
  readonly list: (query?: DbListQuery) => Promise<DbListResponse>;
  readonly create: (input: DbCreateInput) => Promise<DbDocument>;
  readonly get: (id: string) => Promise<DbDocument>;
  readonly update: (id: string, input: DbUpdateInput) => Promise<DbDocument>;
  readonly delete: (id: string, input?: DbDeleteInput) => Promise<void>;
  readonly subscribe: (handlers: {
    readonly onCreate?: (document: DbDocument) => void;
    readonly onUpdate?: (document: DbDocument) => void;
    readonly onDelete?: (id: string) => void;
    readonly onEvent?: (event: DbChangeEvent) => void;
    readonly onOpen?: () => void;
    readonly onError?: (event: Event) => void;
    readonly onClose?: (event: CloseEvent) => void;
  }) => () => void;
}

export interface ForgeClient {
  readonly db: {
    readonly collection: (name: string) => DbCollectionClient;
  };
  readonly webhook: (input: WebhookSendInput) => Promise<WebhookSendResponse>;
}

const ensureNoLeadingSlash = (value: string): string => value.replace(/^\/+/, "");

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const parseJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  return data as T;
};

const assertOk = async (response: Response): Promise<void> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`API request failed: ${response.status} ${body}`);
  }
};

const normalizeCreateInput = (input: DbCreateInput): DbCreateInput => {
  const data = input.data as DbDocumentData;
  return input.id ? { data, id: input.id } : { data };
};

const buildListUrl = (endpoint: string, siteId: string, query?: DbListQuery): string => {
  const url = new URL(endpoint);
  url.searchParams.set("siteId", siteId);
  if (query?.cursor) {
    url.searchParams.set("cursor", query.cursor);
  }
  if (typeof query?.limit === "number" && Number.isFinite(query.limit)) {
    url.searchParams.set("limit", String(query.limit));
  }
  if (query?.whereField) {
    url.searchParams.set("whereField", query.whereField);
  }
  if (typeof query?.whereValue === "string") {
    url.searchParams.set("whereValue", query.whereValue);
  }
  if (query?.sortBy) {
    url.searchParams.set("sortBy", query.sortBy);
  }
  if (query?.sortDir) {
    url.searchParams.set("sortDir", query.sortDir);
  }
  return url.toString();
};

const buildItemUrl = (
  endpoint: string,
  id: string,
  siteId: string,
  options?: { expectedVersion?: number },
): string => {
  const url = new URL(`${endpoint}/${encodeURIComponent(id)}`);
  url.searchParams.set("siteId", siteId);
  if (typeof options?.expectedVersion === "number" && Number.isFinite(options.expectedVersion)) {
    url.searchParams.set("expectedVersion", String(options.expectedVersion));
  }
  return url.toString();
};

const buildEventsUrl = (baseUrl: string, siteId: string, collection: string): string => {
  const url = new URL(`${baseUrl}/api/db/events`);
  url.searchParams.set("siteId", siteId);
  url.searchParams.set("collection", collection);
  return url.toString();
};

const parseSortBy = (value: unknown): DbSortBy | undefined => {
  if (value === "createdAt" || value === "updatedAt" || value === "id") {
    return value;
  }
  return undefined;
};

const parseSortDir = (value: unknown): DbSortDir | undefined => {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return undefined;
};

const normalizeListQuery = (query?: DbListQuery): DbListQuery | undefined => {
  if (!query) {
    return undefined;
  }
  const sortBy = parseSortBy(query.sortBy);
  const sortDir = parseSortDir(query.sortDir);
  return {
    ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.whereField ? { whereField: query.whereField } : {}),
    ...(typeof query.whereValue === "string" ? { whereValue: query.whereValue } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortDir ? { sortDir } : {}),
  };
};

export const createClient = (options: ForgeClientOptions): ForgeClient => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    webhook: async (input: WebhookSendInput) => {
      const response = await fetch(`${baseUrl}/api/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          message: input.message,
          payload: input.payload,
        }),
      });
      await assertOk(response);
      return parseJson<WebhookSendResponse>(response);
    },
    db: {
      collection: (name: string): DbCollectionClient => {
        const collection = ensureNoLeadingSlash(name);
        const endpoint = `${baseUrl}/api/db/${collection}`;

        return {
          list: async (query?: DbListQuery) => {
            const response = await fetch(
              buildListUrl(endpoint, options.siteId, normalizeListQuery(query)),
              {
                method: "GET",
              },
            );
            await assertOk(response);
            return parseJson<DbListResponse>(response);
          },
          create: async (input: DbCreateInput) => {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                siteId: options.siteId,
                ...normalizeCreateInput(input),
              }),
            });
            await assertOk(response);
            const payload = await parseJson<DbCreateResponse>(response);
            return payload.document;
          },
          get: async (id: string) => {
            const response = await fetch(buildItemUrl(endpoint, id, options.siteId), {
              method: "GET",
            });
            await assertOk(response);
            const payload = await parseJson<DbGetResponse>(response);
            return payload.document;
          },
          update: async (id: string, input: DbUpdateInput) => {
            const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
              method: "PUT",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                siteId: options.siteId,
                data: input.data,
                ...(typeof input.expectedVersion === "number"
                  ? { expectedVersion: input.expectedVersion }
                  : {}),
              }),
            });
            await assertOk(response);
            const payload = await parseJson<DbUpdateResponse>(response);
            return payload.document;
          },
          delete: async (id: string, input?: DbDeleteInput) => {
            const itemUrl =
              typeof input?.expectedVersion === "number"
                ? buildItemUrl(endpoint, id, options.siteId, {
                    expectedVersion: input.expectedVersion,
                  })
                : buildItemUrl(endpoint, id, options.siteId);

            const response = await fetch(itemUrl, {
              method: "DELETE",
            });
            await assertOk(response);
            await parseJson<DbDeleteResponse>(response);
          },
          subscribe: (handlers) => {
            const wsUrl = buildEventsUrl(baseUrl, options.siteId, collection).replace(
              /^http/i,
              "ws",
            );
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

            socket.onmessage = (event) => {
              try {
                const parsed = JSON.parse(String(event.data)) as DbChangeEvent;
                handlers.onEvent?.(parsed);

                if (parsed.type === "created" && parsed.document) {
                  handlers.onCreate?.(parsed.document);
                  return;
                }

                if (parsed.type === "updated" && parsed.document) {
                  handlers.onUpdate?.(parsed.document);
                  return;
                }

                if (parsed.type === "deleted") {
                  handlers.onDelete?.(parsed.id);
                }
              } catch {
                // ignore malformed payloads
              }
            };

            return () => {
              socket.close();
            };
          },
        };
      },
    },
  };
};
