import { Config, Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { StorageError, StorageNotFoundError } from "@ism0080/forge-core";
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
    const storageRoot = yield* Config.String("STORAGE_ROOT").pipe(Config.withDefault("./data"));

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

const StorageMetadataFromJson = Schema.fromJsonString(
  Schema.Struct({ contentType: Schema.String }),
);

const toStorageError =
  (operation: string, bucket: string, key: string) =>
  (cause: unknown): StorageError =>
    new StorageError({
      operation,
      bucket,
      key,
      cause,
    });

const make = Effect.gen(function* () {
  const config = yield* LocalFileStorageConfigService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const objectPath = (bucket: string, key: string): string =>
    path.join(config.storageRoot, bucket, ...cleanKey(key).split("/"));

  const bucketPath = (bucket: string): string => path.join(config.storageRoot, bucket);

  yield* fs.makeDirectory(config.storageRoot, { recursive: true });

  const putObject = Effect.fn("Storage.putObject")(
    (
      bucket: string,
      key: string,
      body: Uint8Array,
      contentType?: string,
    ): Effect.Effect<void, StorageError> =>
      Effect.gen(function* () {
        const fullPath = objectPath(bucket, key);
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true });
        yield* fs.writeFile(fullPath, body);

        if (contentType) {
          const metadataPath = `${fullPath}.meta.json`;
          yield* fs.writeFileString(
            metadataPath,
            Schema.encodeSync(StorageMetadataFromJson)({ contentType }),
          );
        }
      }).pipe(Effect.mapError(toStorageError("putObject", bucket, key))),
  );

  const getObject = Effect.fn("Storage.getObject")(
    (bucket: string, key: string): Effect.Effect<Uint8Array, StorageError | StorageNotFoundError> =>
      fs
        .readFile(objectPath(bucket, key))
        .pipe(
          Effect.catchTag(
            "PlatformError",
            (error): Effect.Effect<never, StorageError | StorageNotFoundError> =>
              Predicate.isTagged(error.reason, "NotFound")
                ? Effect.fail(new StorageNotFoundError({ bucket, key }))
                : Effect.fail(toStorageError("getObject", bucket, key)(error)),
          ),
        ),
  );

  const listKeys = Effect.fn("Storage.listKeys")(
    (bucket: string, prefix: string): Effect.Effect<ReadonlyArray<string>, StorageError> =>
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
      }).pipe(Effect.mapError(toStorageError("listKeys", bucket, prefix))),
  );

  const deletePrefix = Effect.fn("Storage.deletePrefix")(
    (bucket: string, prefix: string): Effect.Effect<void, StorageError> =>
      Effect.gen(function* () {
        const targetPath = objectPath(bucket, prefix);
        const exists = yield* fs.exists(targetPath).pipe(Effect.orElseSucceed(() => false));
        if (exists) {
          yield* fs.remove(targetPath, { recursive: true });
        }
      }).pipe(Effect.mapError(toStorageError("deletePrefix", bucket, prefix))),
  );

  return {
    putObject,
    getObject,
    listKeys,
    deletePrefix,
  } satisfies StorageApi;
});

export const LocalFileStorageLayer = Layer.effect(StorageService, make).pipe(
  Layer.provide(LocalFileStorageConfigLayer),
);
