import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "../api";
import { AppConfigService } from "../config/server.js";
import { StorageService } from "../services/storage/service.js";

const buildDirectoryHtml = (keys: ReadonlyArray<string>): string => {
  const siteIds = Array.from(
    new Set(
      keys.flatMap((key) => {
        const match = /^sites\/([^/]+)\//.exec(key);
        return match && match[1] ? [match[1]] : [];
      }),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const escapeHtml = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const items =
    siteIds.length === 0
      ? "<li>No deployed sites yet.</li>"
      : siteIds
          .map((siteId) => {
            const safe = escapeHtml(siteId);
            return `<li><a href="/s/${safe}/">${safe}</a></li>`;
          })
          .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forge Sites</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 760px; padding: 0 1rem; }
      h1 { margin-bottom: 0.5rem; }
      p { color: #444; }
      ul { line-height: 1.8; }
      a { color: #0b63f6; text-decoration: none; }
      a:hover { text-decoration: underline; }
      code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Deployed Forge Sites</h1>
    <p>Open any site via <code>/s/&lt;siteId&gt;/</code></p>
    <ul>${items}</ul>
  </body>
</html>`;
};

const contentTypeFromKey = (resolvedKey: string): string => {
  const ext = (resolvedKey.split(".").pop() ?? "").toLowerCase();
  if (ext === "html") return "text/html";
  if (ext === "js" || ext === "mjs") return "application/javascript";
  if (ext === "css") return "text/css";
  if (ext === "json") return "application/json";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "ico") return "image/x-icon";
  if (ext === "woff") return "font/woff";
  if (ext === "woff2") return "font/woff2";
  return "text/html";
};

export const SitesHandler = HttpApiBuilder.group(Api, "server.sites", (handlers) =>
  handlers
    .handle("sites.list", () =>
      Effect.gen(function* () {
        const { siteBucket } = yield* AppConfigService;
        const storage = yield* StorageService;

        return yield* Effect.matchEffect(storage.listKeys(siteBucket, "sites/"), {
          onSuccess: (keys) => Effect.succeed(buildDirectoryHtml(keys)),
          onFailure: (error) =>
            Effect.fail({
              error: error instanceof Error ? error.message : String(error),
            }),
        });
      }),
    )
    .handle("sites.get", ({ request }) =>
      Effect.gen(function* () {
        const { siteBucket } = yield* AppConfigService;
        const storage = yield* StorageService;

        const key = request.url.startsWith("/") ? request.url.slice(1) : request.url;

        const extractSiteId = (value: string): string | undefined => {
          const match = /^sites\/([^/]+)\//.exec(value);
          return match && match[1] ? match[1] : undefined;
        };

        const hostFallbackKey = (() => {
          const match = /^sites\/(.+)\.localhost\/(.+)$/.exec(key);
          if (!match || !match[1] || !match[2]) {
            return undefined;
          }
          return `sites/${match[1]}/${match[2]}`;
        })();

        const pathWithoutQuery = key.split("?")[0] ?? key;
        const lastSegment = pathWithoutQuery.split("/").pop() ?? "";
        const isAssetPath = lastSegment.includes(".");

        const baseKeys = hostFallbackKey ? [key, hostFallbackKey] : [key];
        const siteIds = Array.from(
          new Set(
            baseKeys.flatMap((candidate) => {
              const siteId = extractSiteId(candidate);
              return siteId ? [siteId] : [];
            }),
          ),
        );

        const primarySiteId = siteIds[0];

        const isSpaSite = primarySiteId
          ? yield* Effect.matchEffect(
              storage.getObject(siteBucket, `sites/${primarySiteId}/forge.json`),
              {
                onSuccess: (data) =>
                  Effect.try({
                    try: () => {
                      const parsed = JSON.parse(new TextDecoder().decode(data)) as unknown;
                      if (typeof parsed !== "object" || parsed === null) {
                        return false;
                      }
                      const config = parsed as { spa?: unknown };
                      return config.spa === true;
                    },
                    catch: () => false,
                  }).pipe(Effect.orElseSucceed(() => false)),
                onFailure: () => Effect.succeed(false),
              },
            )
          : false;

        const indexKeys =
          !isAssetPath && isSpaSite ? siteIds.map((siteId) => `sites/${siteId}/index.html`) : [];
        const keysToTry = Array.from(new Set([...baseKeys, ...indexKeys]));

        const readFirst = (
          candidates: ReadonlyArray<string>,
        ): Effect.Effect<{ key: string; bytes: Uint8Array }, Error> => {
          const [head, ...tail] = candidates;
          if (!head) {
            return Effect.fail(new Error("site asset not found"));
          }
          return Effect.matchEffect(storage.getObject(siteBucket, head), {
            onSuccess: (bytes) => Effect.succeed({ key: head, bytes }),
            onFailure: () => readFirst(tail),
          });
        };

        return yield* Effect.matchEffect(readFirst(keysToTry), {
          onSuccess: ({ key: resolvedKey, bytes }) =>
            Effect.succeed(
              HttpServerResponse.uint8Array(bytes, {
                contentType: contentTypeFromKey(resolvedKey),
              }),
            ),
          onFailure: () => Effect.fail({ error: "not found" as const }),
        });
      }),
    ),
);
