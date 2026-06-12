import { Config, Context, Effect, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { type StorageApi, StorageService } from "./service.js";

export interface LocalFileStorageConfig {
  readonly storageRoot: string;
}

class LocalFileStorageConfigService extends Context.Service<
  LocalFileStorageConfigService,
  LocalFileStorageConfig
>()("forge/LocalFileStorageConfigService") {}

const LocalFileStorageConfigLayer = Layer.effect(
  LocalFileStorageConfigService,
  Effect.gen(function* () {
    const storageRoot = yield* Config.string("STORAGE_ROOT").pipe(Config.withDefault("./data"));

    return {
      storageRoot,
    };
  }),
);

const cleanKey = (key: string): string =>
  key
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");

const make = Effect.gen(function* () {
  const config = yield* LocalFileStorageConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const objectPath = (bucket: string, key: string): string =>
    path.join(config.storageRoot, bucket, ...cleanKey(key).split("/"));

  const bucketPath = (bucket: string): string => path.join(config.storageRoot, bucket);

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  return {
    putObject: (bucket, key, body, contentType) =>
      Effect.gen(function* () {
        const fullPath = objectPath(bucket, key);
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true });
        yield* fs.writeFile(fullPath, body);

        if (contentType) {
          const metadataPath = `${fullPath}.meta.json`;
          yield* fs.writeFileString(metadataPath, JSON.stringify({ contentType }));
        }
      }).pipe(Effect.mapError((error) => new Error(`putObject failed: ${String(error)}`))),
    getObject: (bucket, key) =>
      fs
        .readFile(objectPath(bucket, key))
        .pipe(Effect.mapError((error) => new Error(`getObject failed: ${String(error)}`))),
    listKeys: (bucket, prefix) =>
      Effect.gen(function* () {
        const basePath = bucketPath(bucket);
        const searchRoot = path.join(basePath, ...cleanKey(prefix).split("/"));
        const exists = yield* fs.exists(searchRoot).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return [];
        }

        const entries = yield* fs.readDirectory(searchRoot, { recursive: true });
        const files = yield* Effect.forEach(entries, (entry) =>
          Effect.gen(function* () {
            const fullPath = path.join(searchRoot, entry);
            const info = yield* fs.stat(fullPath);
            if (info.type !== "File" || entry.endsWith(".meta.json")) {
              return Option.none<string>();
            }
            const key = path.relative(basePath, fullPath).replaceAll("\\", "/");
            return Option.some(key);
          }),
        );

        return files.flatMap((file) => (Option.isSome(file) ? [file.value] : []));
      }).pipe(Effect.mapError((error) => new Error(`listKeys failed: ${String(error)}`))),
  } satisfies StorageApi;
});

export const LocalFileStorageLayer = Layer.effect(StorageService, make).pipe(
  Layer.provide(LocalFileStorageConfigLayer),
);
