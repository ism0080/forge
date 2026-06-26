import type {
  DbChangeEvent,
  DbCreateInput,
  DbDeleteInput,
  DbDocument,
  DbListQuery,
  DbUpdateInput,
  WebhookSendInput,
} from "@ism0080/forge-core";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Api } from "@ism0080/forge-server/api";

export interface ForgeClientOptions {
  readonly baseUrl: string;
  readonly siteId: string;
}

const ensureNoLeadingSlash = (value: string): string => value.replace(/^\/+/, "");

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const buildEventsUrl = (baseUrl: string, siteId: string, collection: string): string => {
  const url = new URL(`${baseUrl}/api/db/events`);
  url.searchParams.set("siteId", siteId);
  url.searchParams.set("collection", collection);
  return url.toString();
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
  const wsUrl = buildEventsUrl(baseUrl, siteId, collection).replace(/^http/i, "ws");
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
};

export async function createClient({ baseUrl, siteId }: ForgeClientOptions) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const client = await Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl: normalizedBaseUrl }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );

  return {
    webhook: (input: WebhookSendInput) =>
      Effect.runPromise(client["server.webhook.gateway"]["webhook.forward"]({ payload: input })),
    db: {
      collection: (name: string) => {
        const collection = ensureNoLeadingSlash(name);
        return {
          list: (query?: DbListQuery) =>
            Effect.runPromise(
              client["server.db"]["db.documents.list"]({
                params: { collection },
                query: { ...query, siteId },
              }),
            ),
          create: (input: DbCreateInput) =>
            Effect.runPromise(
              client["server.db"]["db.documents.create"]({
                params: { collection },
                payload: { siteId, data: input.data, id: input.id },
              }),
            ),
          get: (id: string) =>
            Effect.runPromise(
              client["server.db"]["db.documents.get"]({
                params: { collection, id },
                query: { siteId },
              }),
            ),
          update: (id: string, input: DbUpdateInput) =>
            Effect.runPromise(
              client["server.db"]["db.documents.update"]({
                params: { collection, id },
                payload: { siteId, data: input.data, expectedVersion: input.expectedVersion },
              }),
            ),
          delete: (id: string, input?: DbDeleteInput) =>
            Effect.runPromise(
              client["server.db"]["db.documents.delete"]({
                params: { collection, id },
                query: {
                  siteId,
                  expectedVersion: input?.expectedVersion,
                },
              }),
            ),
          subscribe: (handlers: Parameters<typeof createDbSubscription>[3]) =>
            createDbSubscription(normalizedBaseUrl, siteId, collection, handlers),
        };
      },
    },
  };
}
